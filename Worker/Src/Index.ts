import { Hono } from 'hono'
import { decimalToMicro, spoofAppleWlocResponse } from './Proto/Apple-ios-pin'

type Bindings = {
  LOCATIONS: KVNamespace
  API_KEY?: string
  ALLOWED_TOKENS?: string
}

type HistoryEntry = { label: string; lat: number; lng: number; savedAt: string }
type StoredLocation = { lat: number; lng: number; updatedAt?: string }

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

const app = new Hono<{ Bindings: Bindings }>()

function isTokenAllowed(env: Bindings, token: string) {
  if (!env.ALLOWED_TOKENS) return true
  const allowed = env.ALLOWED_TOKENS.split(',').map(t => t.trim()).filter(Boolean)
  if (allowed.length === 0) return true
  return allowed.includes(token)
}

function normalizeAppleHost(input?: string | null) {
  if (!input) return APPLE_HOST_DEFAULT
  const lowered = input.toLowerCase()
  if (lowered.includes(APPLE_HOST_CN)) return APPLE_HOST_CN
  return APPLE_HOST_DEFAULT
}

function buildAppleUpstreamUrl(requestedHost?: string | null) {
  return `https://${normalizeAppleHost(requestedHost)}${APPLE_WLOC_PATH}`
}

function copyUpstreamRequestHeaders(source: Headers) {
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

function buildRelayResponseHeaders(upstream: Response, spoofed: boolean) {
  const headers = new Headers()
  for (const key of RESPONSE_HEADERS_TO_FORWARD) {
    const value = upstream.headers.get(key)
    if (value) headers.set(key, value)
  }
  headers.set('x-ios-pin-relay', '1')
  headers.set('x-ios-pin-spoofed', spoofed ? '1' : '0')
  return headers
}

async function requireWriteAuth(c: any, next: () => Promise<void>) {
  const env = c.env as Bindings
  const token = c.req.param('token')
  if (token && !isTokenAllowed(env, token)) {
    return c.json({ error: 'token not allowed' }, 403)
  }
  if (env.API_KEY) {
    const provided = c.req.header('x-wloc-key')
    if (provided !== env.API_KEY) {
      return c.json({ error: 'unauthorized' }, 401)
    }
  }
  await next()
}

app.get('/', (c) => c.json({
  name: 'ios-pin',
  status: 'ok',
  endpoints: ['/api/location/:token', '/api/module/:client/:token', '/relay/apple/:token/clls/wloc']
}))

app.get('/api/location/:token', async (c) => {
  const token = c.req.param('token')
  const raw = await c.env.LOCATIONS.get(`loc:${token}`, 'json') as StoredLocation | null
  if (!raw) return c.json({ error: 'location not found' }, 404)
  return c.json(raw)
})

app.post('/api/location/:token', requireWriteAuth, async (c) => {
  const token = c.req.param('token')
  const body = await c.req.json<{ lat: number; lng: number }>()
  if (!Number.isFinite(body.lat) || !Number.isFinite(body.lng)) {
    return c.json({ error: 'invalid coordinates' }, 400)
  }
  const payload = { lat: body.lat, lng: body.lng, updatedAt: new Date().toISOString() }
  await c.env.LOCATIONS.put(`loc:${token}`, JSON.stringify(payload))
  return c.json({ ok: true, token, ...payload })
})

app.get('/api/history/:token', async (c) => {
  const token = c.req.param('token')
  const raw = await c.env.LOCATIONS.get(`history:${token}`, 'json') as HistoryEntry[] | null
  return c.json({ items: raw ?? [] })
})

app.post('/api/history/:token', requireWriteAuth, async (c) => {
  const token = c.req.param('token')
  const body = await c.req.json<{ label?: string; lat: number; lng: number }>()
  if (!Number.isFinite(body.lat) || !Number.isFinite(body.lng)) {
    return c.json({ error: 'invalid coordinates' }, 400)
  }
  const raw = await c.env.LOCATIONS.get(`history:${token}`, 'json') as HistoryEntry[] | null
  const items = raw ?? []
  const entry: HistoryEntry = {
    label: body.label || `${body.lat.toFixed(4)}, ${body.lng.toFixed(4)}`,
    lat: body.lat,
    lng: body.lng,
    savedAt: new Date().toISOString()
  }
  const deduped = items.filter(i => !(Math.abs(i.lat - entry.lat) < 1e-6 && Math.abs(i.lng - entry.lng) < 1e-6))
  const next = [entry, ...deduped].slice(0, 20)
  await c.env.LOCATIONS.put(`history:${token}`, JSON.stringify(next))
  return c.json({ ok: true, items: next })
})

app.delete('/api/history/:token/:index', requireWriteAuth, async (c) => {
  const token = c.req.param('token')
  const index = Number(c.req.param('index'))
  const raw = await c.env.LOCATIONS.get(`history:${token}`, 'json') as HistoryEntry[] | null
  const items = raw ?? []
  if (index < 0 || index >= items.length) return c.json({ error: 'index out of range' }, 400)
  items.splice(index, 1)
  await c.env.LOCATIONS.put(`history:${token}`, JSON.stringify(items))
  return c.json({ ok: true, items })
})

app.get('/api/module/:client/:token', async (c) => {
  const { client, token } = c.req.param()
  const workerBase = new URL(c.req.url).origin
  const relayUrl = `${workerBase}/script/${token}.js`
  const templates: Record<string, string> = {
    surge: `[MITM]
hostname = %APPEND% gs-loc.apple.com, gs-loc-cn.apple.com

[Script]
ios-pin = type=http-response,pattern=^https:\/\/gs-loc(-cn)?\.apple\.com\/clls\/wloc,requires-body=1,max-size=0,script-path=${relayUrl}
`,
    loon: `[MITM]
hostname = gs-loc.apple.com, gs-loc-cn.apple.com

[Script]
http-response ^https:\/\/gs-loc(-cn)?\.apple\.com\/clls\/wloc script-path=${relayUrl}, requires-body=true, timeout=60, tag=ios-pin
`,
    qx: `hostname = gs-loc.apple.com, gs-loc-cn.apple.com
^https:\/\/gs-loc(-cn)?\.apple\.com\/clls\/wloc url script-response-body ${relayUrl}
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
  - match: ^https:\/\/gs-loc(-cn)?\.apple\.com\/clls\/wloc
    name: ios-pin
    type: script
    require-body: true
    provider: ios-pin
`,
    shadowrocket: `[General]

[MITM]
hostname = gs-loc.apple.com, gs-loc-cn.apple.com

[Script]
ios-pin = type=http-response,pattern=^https:\/\/gs-loc(-cn)?\.apple\.com\/clls\/wloc,requires-body=1,max-size=0,script-path=${relayUrl}
`
  }
  const content = templates[client]
  if (!content) return c.text('unsupported client', 404)
  return new Response(content, { headers: { 'content-type': 'text/plain; charset=utf-8' } })
})

async function relayAppleWloc(c: any) {
  const token = c.req.param('token')
  const loc = await c.env.LOCATIONS.get(`loc:${token}`, 'json') as StoredLocation | null
  if (!loc) return c.json({ error: 'location not found' }, 404)

  const upstreamUrl = buildAppleUpstreamUrl(c.req.header('x-wloc-upstream-host') || c.req.header('x-wloc-original-url'))
  const upstream = await fetch(upstreamUrl, {
    method: 'POST',
    headers: copyUpstreamRequestHeaders(c.req.raw.headers),
    body: await c.req.arrayBuffer()
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

app.post('/apple/clls/wloc/:token', relayAppleWloc)
app.post('/relay/apple/:token/clls/wloc', relayAppleWloc)

app.get('/script/:token.js', (c) => {
  const token = c.req.param('token')
  const workerBase = new URL(c.req.url).origin
  const js = `const token = ${JSON.stringify(token)};
const base = ${JSON.stringify(workerBase)};
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
})

export default app
