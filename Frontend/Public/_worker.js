import { Hono } from 'hono'
import { decimalToMicro, spoofAppleIosPinResponse } from '../../Worker/Src/Proto/Apple-ios-pin'

const VERSION = '2026.07.19'
const APPLE_NETWORK_LOCATION_PATH = '/clls/wloc'
const APPLE_HOST_DEFAULT = 'gs-loc.apple.com'
const APPLE_HOST_CN = 'gs-loc-cn.apple.com'
const RESPONSE_HEADERS_TO_FORWARD = ['content-type', 'cache-control', 'expires', 'last-modified', 'etag', 'date', 'server']

const app = new Hono()

function noStoreHeaders(extra = {}) {
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
    pragma: 'no-cache',
    expires: '0'
  })
  for (const [k, v] of Object.entries(extra)) headers.set(k, v)
  return headers
}

function textNoStoreResponse(body, contentType = 'text/plain; charset=utf-8') {
  return new Response(body, {
    headers: {
      'content-type': contentType,
      'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
      pragma: 'no-cache',
      expires: '0'
    }
  })
}

function normalizeToken(token) { return String(token || '').trim() }
function isValidToken(token) { return /^[a-zA-Z0-9_-]{1,64}$/.test(token) }
function areValidCoordinates(lat, lng) { return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 }
function isTokenAllowed(env, token) {
  if (!env.ALLOWED_TOKENS) return true
  const allowed = env.ALLOWED_TOKENS.split(',').map(t => t.trim()).filter(Boolean)
  if (allowed.length === 0) return true
  return allowed.includes(token)
}
function normalizeAppleHost(input) {
  if (!input) return APPLE_HOST_DEFAULT
  const lowered = String(input).toLowerCase()
  if (lowered.includes(APPLE_HOST_CN)) return APPLE_HOST_CN
  return APPLE_HOST_DEFAULT
}
function buildAppleUpstreamUrl(requestedHost) { return `https://${normalizeAppleHost(requestedHost)}${APPLE_NETWORK_LOCATION_PATH}` }
function copyUpstreamRequestHeaders(source) {
  const headers = new Headers()
  for (const [key, value] of source.entries()) {
    const lowered = key.toLowerCase()
    if (lowered === 'host' || lowered === 'content-length' || lowered.startsWith('cf-') || lowered === 'x-forwarded-for' || lowered === 'x-forwarded-proto' || lowered === 'x-real-ip' || lowered === 'x-ios-pin-upstream-host' || lowered === 'x-ios-pin-original-url') continue
    headers.set(key, value)
  }
  if (!headers.has('content-type')) headers.set('content-type', 'application/x-www-form-urlencoded')
  if (!headers.has('user-agent')) headers.set('user-agent', 'locationd/1.0')
  return headers
}
function buildRelayResponseHeaders(upstream, spoofed) {
  const headers = new Headers()
  for (const key of RESPONSE_HEADERS_TO_FORWARD) {
    const value = upstream.headers.get(key)
    if (value) headers.set(key, value)
  }
  headers.set('x-ios-pin-relay', '1')
  headers.set('x-ios-pin-spoofed', spoofed ? '1' : '0')
  return headers
}
async function requireWriteAuth(c, next) {
  const token = normalizeToken(c.req.param('token'))
  if (token && !isTokenAllowed(c.env, token)) return c.json({ error: 'token not allowed' }, 403)
  if (c.env.API_KEY) {
    const provided = c.req.header('x-ios-pin-key')
    if (provided !== c.env.API_KEY) return c.json({ error: 'unauthorized' }, 401)
  }
  await next()
}

app.get('/healthz', c => new Response(JSON.stringify({ ok: true, version: VERSION }), { headers: noStoreHeaders() }))

app.get('/api/location/:token', async c => {
  const token = normalizeToken(c.req.param('token'))
  const raw = await c.env.LOCATIONS.get(`loc:${token}`, 'json')
  if (!raw) return c.json({ error: 'location not found' }, 404)
  return c.json(raw)
})

app.post('/api/location/:token', requireWriteAuth, async c => {
  const token = normalizeToken(c.req.param('token'))
  if (!isValidToken(token)) return new Response(JSON.stringify({ error: 'invalid token' }), { status: 400, headers: noStoreHeaders() })
  const body = await c.req.json()
  if (!areValidCoordinates(body.lat, body.lng)) return new Response(JSON.stringify({ error: 'invalid coordinates' }), { status: 400, headers: noStoreHeaders() })
  const payload = { lat: body.lat, lng: body.lng, updatedAt: new Date().toISOString() }
  await c.env.LOCATIONS.put(`loc:${token}`, JSON.stringify(payload))
  return new Response(JSON.stringify({ ok: true, token, ...payload }), { headers: noStoreHeaders() })
})

app.get('/api/history/:token', async c => {
  const token = normalizeToken(c.req.param('token'))
  if (!isValidToken(token)) return new Response(JSON.stringify({ error: 'invalid token' }), { status: 400, headers: noStoreHeaders() })
  const raw = await c.env.LOCATIONS.get(`history:${token}`, 'json')
  return new Response(JSON.stringify({ items: raw || [] }), { headers: noStoreHeaders() })
})

app.post('/api/history/:token', requireWriteAuth, async c => {
  const token = normalizeToken(c.req.param('token'))
  if (!isValidToken(token)) return new Response(JSON.stringify({ error: 'invalid token' }), { status: 400, headers: noStoreHeaders() })
  const body = await c.req.json()
  if (!areValidCoordinates(body.lat, body.lng)) return new Response(JSON.stringify({ error: 'invalid coordinates' }), { status: 400, headers: noStoreHeaders() })
  const raw = await c.env.LOCATIONS.get(`history:${token}`, 'json')
  const items = raw || []
  const entry = { label: body.label || `${body.lat.toFixed(4)}, ${body.lng.toFixed(4)}`, lat: body.lat, lng: body.lng, savedAt: new Date().toISOString() }
  const deduped = items.filter(i => !(Math.abs(i.lat - entry.lat) < 1e-6 && Math.abs(i.lng - entry.lng) < 1e-6))
  const next = [entry, ...deduped].slice(0, 20)
  await c.env.LOCATIONS.put(`history:${token}`, JSON.stringify(next))
  return new Response(JSON.stringify({ ok: true, items: next }), { headers: noStoreHeaders() })
})

app.delete('/api/history/:token/:index', requireWriteAuth, async c => {
  const token = normalizeToken(c.req.param('token'))
  if (!isValidToken(token)) return new Response(JSON.stringify({ error: 'invalid token' }), { status: 400, headers: noStoreHeaders() })
  const index = Number(c.req.param('index'))
  const raw = await c.env.LOCATIONS.get(`history:${token}`, 'json')
  const items = raw || []
  if (index < 0 || index >= items.length) return c.json({ error: 'index out of range' }, 400)
  items.splice(index, 1)
  await c.env.LOCATIONS.put(`history:${token}`, JSON.stringify(items))
  return new Response(JSON.stringify({ ok: true, items }), { headers: noStoreHeaders() })
})

app.get('/api/module/:client/:token', async c => {
  const client = c.req.param('client')
  const token = normalizeToken(c.req.param('token'))
  if (!isValidToken(token)) return textNoStoreResponse('invalid token')
  const base = new URL(c.req.url).origin
  const relayUrl = `${base}/script/${token}.js`
  const templates = {
    surge: `[MITM]\nhostname = %APPEND% gs-loc.apple.com, gs-loc-cn.apple.com\n\n[Script]\nios-pin = type=http-response,pattern=^https:\/\/gs-loc(-cn)?\\.apple\\.com\/clls\/wloc,requires-body=1,max-size=0,script-path=${relayUrl}\n`,
    loon: `[MITM]\nhostname = gs-loc.apple.com, gs-loc-cn.apple.com\n\n[Script]\nhttp-response ^https:\/\/gs-loc(-cn)?\\.apple\\.com\/clls\/wloc script-path=${relayUrl}, requires-body=true, timeout=60, tag=ios-pin\n`,
    qx: `hostname = gs-loc.apple.com, gs-loc-cn.apple.com\n^https:\/\/gs-loc(-cn)?\\.apple\\.com\/clls\/wloc url script-response-body ${relayUrl}\n`,
    stash: `http:\n  mitm:\n    - gs-loc.apple.com\n    - gs-loc-cn.apple.com\nscript-providers:\n  ios-pin:\n    url: ${relayUrl}\n    interval: 86400\nhttp-response:\n  - match: ^https:\/\/gs-loc(-cn)?\\.apple\\.com\/clls\/wloc\n    name: ios-pin\n    type: script\n    require-body: true\n    provider: ios-pin\n`,
    shadowrocket: `[General]\n\n[MITM]\nhostname = gs-loc.apple.com, gs-loc-cn.apple.com\n\n[Script]\nios-pin = type=http-response,pattern=^https:\/\/gs-loc(-cn)?\\.apple\\.com\/clls\/wloc,requires-body=1,max-size=0,script-path=${relayUrl}\n`
  }
  const content = templates[client]
  if (!content) return new Response('unsupported client', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } })
  return textNoStoreResponse(content)
})

async function relayAppleNetworkLocation(c) {
  const token = normalizeToken(c.req.param('token'))
  if (!isValidToken(token)) return new Response(JSON.stringify({ error: 'invalid token' }), { status: 400, headers: noStoreHeaders() })
  const loc = await c.env.LOCATIONS.get(`loc:${token}`, 'json')
  if (!loc) return c.json({ error: 'location not found' }, 404)
  const upstreamUrl = buildAppleUpstreamUrl(c.req.header('x-ios-pin-upstream-host') || c.req.header('x-ios-pin-original-url'))
  const upstream = await fetch(upstreamUrl, { method: 'POST', headers: copyUpstreamRequestHeaders(c.req.raw.headers), body: await c.req.arrayBuffer() })
  const upstreamBytes = new Uint8Array(await upstream.arrayBuffer())
  const shouldSpoof = upstream.ok && upstreamBytes.length > 10
  const finalBytes = shouldSpoof ? spoofAppleIosPinResponse(upstreamBytes, { latMicro: decimalToMicro(loc.lat), lngMicro: decimalToMicro(loc.lng) }) : upstreamBytes
  return new Response(finalBytes, { status: upstream.status, statusText: upstream.statusText, headers: buildRelayResponseHeaders(upstream, shouldSpoof) })
}

app.post('/relay/apple/:token/clls/wloc', relayAppleNetworkLocation)

app.get('/script/:token.js', c => {
  const token = normalizeToken(c.req.param('token'))
  if (!isValidToken(token)) return new Response('// invalid token', { status: 400, headers: { 'content-type': 'application/javascript; charset=utf-8' } })
  const base = new URL(c.req.url).origin
  const js = `const token = ${JSON.stringify(token)};\nconst base = ${JSON.stringify(base)};\nfunction readHeader(name){const h=$request.headers||{};return h[name]||h[name.toLowerCase()]||h[name.toUpperCase()]||'';}\nfunction originalHost(){try{return new URL($request.url).host||'gs-loc.apple.com';}catch{return readHeader('Host')||'gs-loc.apple.com';}}\nfunction payload(){if(typeof $request.bodyBytes!=='undefined'&&$request.bodyBytes!==null)return { bodyBytes:$request.bodyBytes };return { body:$request.body||'' };}\nasync function relay(){const req={url:base+'/relay/apple/'+token+'/clls/wloc',method:'POST',headers:{'content-type':readHeader('Content-Type')||'application/x-www-form-urlencoded','user-agent':readHeader('User-Agent')||'locationd/1.0','x-ios-pin-upstream-host':originalHost(),'x-ios-pin-original-url':$request.url},...payload()};const r=await $task.fetch(req);const out={headers:r.headers,status:r.statusCode||r.status};if(typeof r.bodyBytes!=='undefined'&&r.bodyBytes!==null)out.bodyBytes=r.bodyBytes;else out.body=r.body;$done(out);}\nrelay().catch(err=>$done({status:502,body:String(err&&err.message?err.message:err)}));\n`
  return new Response(js, { headers: { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-store, no-cache, must-revalidate, max-age=0' } })
})

app.get('*', async c => c.env.ASSETS.fetch(c.req.raw))

export default app
