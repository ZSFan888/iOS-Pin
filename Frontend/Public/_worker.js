import { decimalToMicro, spoofAppleWlocResponse } from './apple-wloc.js'

const APPLE_WLOC_PATH = '/clls/wloc'
const APPLE_HOST_DEFAULT = 'gs-loc.apple.com'
const APPLE_HOST_CN = 'gs-loc-cn.apple.com'
const RESPONSE_HEADERS_TO_FORWARD = [
  'content-type',
  'cache-control',
  'expires',
  'last-modified',
  'etag',
  'date',
  'server'
]

function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  })
}

function isTokenAllowed(env, token) {
  if (!env.ALLOWED_TOKENS) return true
  const allowed = env.ALLOWED_TOKENS.split(',').map(t => t.trim()).filter(Boolean)
  if (allowed.length === 0) return true
  return allowed.includes(token)
}

function checkWriteAuth(env, token, request) {
  if (token && !isTokenAllowed(env, token)) {
    return jsonResponse({ error: 'token not allowed' }, 403)
  }
  if (env.API_KEY) {
    const provided = request.headers.get('x-wloc-key')
    if (provided !== env.API_KEY) {
      return jsonResponse({ error: 'unauthorized' }, 401)
    }
  }
  return null
}

function normalizeAppleHost(input) {
  if (!input) return APPLE_HOST_DEFAULT
  const lowered = input.toLowerCase()
  if (lowered.includes(APPLE_HOST_CN)) return APPLE_HOST_CN
  return APPLE_HOST_DEFAULT
}

function buildAppleUpstreamUrl(requestedHost) {
  return `https://${normalizeAppleHost(requestedHost)}${APPLE_WLOC_PATH}`
}

function copyUpstreamRequestHeaders(source) {
  const headers = new Headers()
  for (const [key, value] of source.entries()) {
    const lowered = key.toLowerCase()
    if (
      lowered === 'host' ||
      lowered === 'content-length' ||
      lowered.startsWith('cf-') ||
      lowered === 'x-forwarded-for' ||
      lowered === 'x-forwarded-proto' ||
      lowered === 'x-real-ip' ||
      lowered === 'x-wloc-upstream-host' ||
      lowered === 'x-wloc-original-url'
    ) {
      continue
    }
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

async function handleGetLocation(env, token) {
  const raw = await env.LOCATIONS.get(`loc:${token}`, 'json')
  if (!raw) return jsonResponse({ error: 'location not found' }, 404)
  return jsonResponse(raw)
}

async function handlePostLocation(env, token, request) {
  const auth = checkWriteAuth(env, token, request)
  if (auth) return auth
  const body = await request.json()
  if (!Number.isFinite(body.lat) || !Number.isFinite(body.lng)) {
    return jsonResponse({ error: 'invalid coordinates' }, 400)
  }
  const payload = { lat: body.lat, lng: body.lng, updatedAt: new Date().toISOString() }
  await env.LOCATIONS.put(`loc:${token}`, JSON.stringify(payload))
  return jsonResponse({ ok: true, token, ...payload })
}

async function handleGetHistory(env, token) {
  const raw = await env.LOCATIONS.get(`history:${token}`, 'json')
  return jsonResponse({ items: raw ?? [] })
}

async function handlePostHistory(env, token, request) {
  const auth = checkWriteAuth(env, token, request)
  if (auth) return auth
  const body = await request.json()
  if (!Number.isFinite(body.lat) || !Number.isFinite(body.lng)) {
    return jsonResponse({ error: 'invalid coordinates' }, 400)
  }
  const raw = await env.LOCATIONS.get(`history:${token}`, 'json')
  const items = raw ?? []
  const entry = {
    label: body.label || `${body.lat.toFixed(4)}, ${body.lng.toFixed(4)}`,
    lat: body.lat,
    lng: body.lng,
    savedAt: new Date().toISOString()
  }
  const deduped = items.filter(i => !(Math.abs(i.lat - entry.lat) < 1e-6 && Math.abs(i.lng - entry.lng) < 1e-6))
  const next = [entry, ...deduped].slice(0, 20)
  await env.LOCATIONS.put(`history:${token}`, JSON.stringify(next))
  return jsonResponse({ ok: true, items: next })
}

async function handleDeleteHistory(env, token, index, request) {
  const auth = checkWriteAuth(env, token, request)
  if (auth) return auth
  const raw = await env.LOCATIONS.get(`history:${token}`, 'json')
  const items = raw ?? []
  if (index < 0 || index >= items.length) return jsonResponse({ error: 'index out of range' }, 400)
  items.splice(index, 1)
  await env.LOCATIONS.put(`history:${token}`, JSON.stringify(items))
  return jsonResponse({ ok: true, items })
}

function handleGetModule(client, token, siteBase) {
  const relayUrl = `${siteBase}/script/${token}.js`
  const templates = {
    surge: `[MITM]
hostname = %APPEND% gs-loc.apple.com, gs-loc-cn.apple.com

[Script]
ios-pin = type=http-response,pattern=^https:\\/\\/gs-loc(-cn)?\\.apple\\.com\\/clls\\/wloc,requires-body=1,max-size=0,script-path=${relayUrl}
`,
    loon: `[MITM]
hostname = gs-loc.apple.com, gs-loc-cn.apple.com

[Script]
http-response ^https:\\/\\/gs-loc(-cn)?\\.apple\\.com\\/clls\\/wloc script-path=${relayUrl}, requires-body=true, timeout=60, tag=ios-pin
`,
    qx: `hostname = gs-loc.apple.com, gs-loc-cn.apple.com
^https:\\/\\/gs-loc(-cn)?\\.apple\\.com\\/clls\\/wloc url script-response-body ${relayUrl}
`,
    stash: `http:
  mitm:
    - gs-loc.apple.com
    - gs-loc-cn.apple.com
script-providers:
  ios-pin:
    url: ${relayUrl}
    interval: 86400
http-response:
  - match: ^https:\\/\\/gs-loc(-cn)?\\.apple\\.com\\/clls\\/wloc
    name: ios-pin
    type: script
    require-body: true
    provider: ios-pin
`,
    shadowrocket: `[General]

[MITM]
hostname = gs-loc.apple.com, gs-loc-cn.apple.com

[Script]
ios-pin = type=http-response,pattern=^https:\\/\\/gs-loc(-cn)?\\.apple\\.com\\/clls\\/wloc,requires-body=1,max-size=0,script-path=${relayUrl}
`
  }
  const content = templates[client]
  if (!content) return new Response('unsupported client', { status: 404 })
  return new Response(content, { headers: { 'content-type': 'text/plain; charset=utf-8' } })
}

async function relayAppleWloc(env, token, request) {
  const loc = await env.LOCATIONS.get(`loc:${token}`, 'json')
  if (!loc) return jsonResponse({ error: 'location not found' }, 404)

  const upstreamUrl = buildAppleUpstreamUrl(request.headers.get('x-wloc-upstream-host') || request.headers.get('x-wloc-original-url'))
  const upstream = await fetch(upstreamUrl, {
    method: 'POST',
    headers: copyUpstreamRequestHeaders(request.headers),
    body: await request.arrayBuffer()
  })

  const upstreamBytes = new Uint8Array(await upstream.arrayBuffer())
  const shouldSpoof = upstream.ok && upstreamBytes.length > 10
  const finalBytes = shouldSpoof
    ? spoofAppleWlocResponse(upstreamBytes, {
        latMicro: decimalToMicro(loc.lat),
        lngMicro: decimalToMicro(loc.lng)
      })
    : upstreamBytes

  return new Response(finalBytes, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: buildRelayResponseHeaders(upstream, shouldSpoof)
  })
}

function handleGetScript(token, siteBase) {
  const js = `const token = ${JSON.stringify(token)};
const base = ${JSON.stringify(siteBase)};
function readHeader(name) {
  const h = $request.headers || {};
  return h[name] || h[name.toLowerCase()] || h[name.toUpperCase()] || '';
}
function originalHost() {
  try { return new URL($request.url).host || 'gs-loc.apple.com'; } catch { return readHeader('Host') || 'gs-loc.apple.com'; }
}
function payload() {
  if (typeof $request.bodyBytes !== 'undefined' && $request.bodyBytes !== null) return { bodyBytes: $request.bodyBytes };
  return { body: $request.body || '' };
}
async function relay() {
  const req = {
    url: base + '/relay/apple/' + token + '/clls/wloc',
    method: 'POST',
    headers: {
      'content-type': readHeader('Content-Type') || 'application/x-www-form-urlencoded',
      'user-agent': readHeader('User-Agent') || 'locationd/1.0',
      'x-wloc-upstream-host': originalHost(),
      'x-wloc-original-url': $request.url
    },
    ...payload()
  };
  const r = await $task.fetch(req);
  const out = { headers: r.headers, status: r.statusCode || r.status };
  if (typeof r.bodyBytes !== 'undefined' && r.bodyBytes !== null) out.bodyBytes = r.bodyBytes; else out.body = r.body;
  $done(out);
}
relay().catch(err => $done({ status: 502, body: String(err && err.message ? err.message : err) }));
`
  return new Response(js, { headers: { 'content-type': 'application/javascript; charset=utf-8' } })
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    const pathname = url.pathname
    const siteBase = url.origin
    const method = request.method

    let match

    if (method === 'GET' && (match = pathname.match(/^\/api\/location\/([^/]+)$/))) {
      return handleGetLocation(env, decodeURIComponent(match[1]))
    }
    if (method === 'POST' && (match = pathname.match(/^\/api\/location\/([^/]+)$/))) {
      return handlePostLocation(env, decodeURIComponent(match[1]), request)
    }
    if (method === 'GET' && (match = pathname.match(/^\/api\/history\/([^/]+)$/))) {
      return handleGetHistory(env, decodeURIComponent(match[1]))
    }
    if (method === 'POST' && (match = pathname.match(/^\/api\/history\/([^/]+)$/))) {
      return handlePostHistory(env, decodeURIComponent(match[1]), request)
    }
    if (method === 'DELETE' && (match = pathname.match(/^\/api\/history\/([^/]+)\/(\d+)$/))) {
      return handleDeleteHistory(env, decodeURIComponent(match[1]), Number(match[2]), request)
    }
    if (method === 'GET' && (match = pathname.match(/^\/api\/module\/([^/]+)\/([^/]+)$/))) {
      return handleGetModule(decodeURIComponent(match[1]), decodeURIComponent(match[2]), siteBase)
    }
    if (method === 'POST' && (match = pathname.match(/^\/apple\/clls\/wloc\/([^/]+)$/))) {
      return relayAppleWloc(env, decodeURIComponent(match[1]), request)
    }
    if (method === 'POST' && (match = pathname.match(/^\/relay\/apple\/([^/]+)\/clls\/wloc$/))) {
      return relayAppleWloc(env, decodeURIComponent(match[1]), request)
    }
    if (method === 'GET' && (match = pathname.match(/^\/script\/([^/]+)\.js$/))) {
      return handleGetScript(decodeURIComponent(match[1]), siteBase)
    }

    return env.ASSETS.fetch(request)
  }
}
