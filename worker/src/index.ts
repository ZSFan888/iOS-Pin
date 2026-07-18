import { Hono } from 'hono'
import { decimalToMicro, spoofAppleWlocResponse } from './proto/apple-wloc'

type Bindings = {
  LOCATIONS: KVNamespace
  API_KEY?: string
  ALLOWED_TOKENS?: string
}

const app = new Hono<{ Bindings: Bindings }>()

function isTokenAllowed(env: Bindings, token: string) {
  if (!env.ALLOWED_TOKENS) return true
  const allowed = env.ALLOWED_TOKENS.split(',').map(t => t.trim()).filter(Boolean)
  if (allowed.length === 0) return true
  return allowed.includes(token)
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
  name: 'wloc-pro',
  status: 'ok',
  endpoints: ['/api/location/:token', '/api/module/:client/:token']
}))

app.get('/api/location/:token', async (c) => {
  const token = c.req.param('token')
  const raw = await c.env.LOCATIONS.get(`loc:${token}`, 'json') as { lat: number; lng: number; updatedAt: string } | null
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

type HistoryEntry = { label: string; lat: number; lng: number; savedAt: string }

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
  const templates: Record<string, string> = {
    surge: `[MITM]\nhostname = %APPEND% gs-loc.apple.com, gs-loc-cn.apple.com\n\n[Script]\nwloc-pro = type=http-response,pattern=^https:\\/\\/gs-loc(-cn)?\\.apple\\.com\\/clls\\/wloc,requires-body=1,max-size=0,script-path=${workerBase}/script/${token}.js\n`,
    loon: `[MITM]\nhostname = gs-loc.apple.com, gs-loc-cn.apple.com\n\n[Script]\nhttp-response ^https:\\/\\/gs-loc(-cn)?\\.apple\\.com\\/clls\\/wloc script-path=${workerBase}/script/${token}.js, requires-body=true, timeout=60, tag=wloc-pro\n`,
    qx: `hostname = gs-loc.apple.com, gs-loc-cn.apple.com\n^https:\\/\\/gs-loc(-cn)?\\.apple\\.com\\/clls\\/wloc url script-response-body ${workerBase}/script/${token}.js\n`,
    stash: `http:\n  mitm:\n    - gs-loc.apple.com\n    - gs-loc-cn.apple.com\nscript-providers:\n  wloc-pro:\n    url: ${workerBase}/script/${token}.js\n    interval: 86400\nhttp-response:\n  - match: ^https:\\/\\/gs-loc(-cn)?\\.apple\\.com\\/clls\\/wloc\n    name: wloc-pro\n    type: script\n    require-body: true\n    provider: wloc-pro\n`,
    shadowrocket: `[General]\n\n[MITM]\nhostname = gs-loc.apple.com, gs-loc-cn.apple.com\n\n[Script]\nwloc-pro = type=http-response,pattern=^https:\\/\\/gs-loc(-cn)?\\.apple\\.com\\/clls\\/wloc,requires-body=1,max-size=0,script-path=${workerBase}/script/${token}.js\n`
  }
  const content = templates[client]
  if (!content) return c.text('unsupported client', 404)
  return new Response(content, { headers: { 'content-type': 'text/plain; charset=utf-8' } })
})

app.post('/apple/clls/wloc/:token', async (c) => {
  const token = c.req.param('token')
  const loc = await c.env.LOCATIONS.get(`loc:${token}`, 'json') as { lat: number; lng: number } | null
  if (!loc) return c.json({ error: 'location not found' }, 404)
  const upstream = await fetch('https://gs-loc.apple.com/clls/wloc', {
    method: 'POST',
    headers: {
      'content-type': c.req.header('content-type') || 'application/x-www-form-urlencoded',
      'user-agent': c.req.header('user-agent') || 'locationd/1.0'
    },
    body: await c.req.arrayBuffer()
  })
  const body = new Uint8Array(await upstream.arrayBuffer())
  const spoofed = spoofAppleWlocResponse(body, {
    latMicro: decimalToMicro(loc.lat),
    lngMicro: decimalToMicro(loc.lng)
  })
  return new Response(spoofed, {
    headers: {
      'content-type': upstream.headers.get('content-type') || 'application/octet-stream'
    }
  })
})

app.get('/script/:token.js', (c) => {
  const token = c.req.param('token')
  const workerBase = new URL(c.req.url).origin
  const js = `const token = ${JSON.stringify(token)};\nconst base = ${JSON.stringify(workerBase)};\nasync function relay() {\n  const req = {\n    url: base + '/apple/clls/wloc/' + token,\n    method: 'POST',\n    headers: { 'content-type': $request.headers['Content-Type'] || $request.headers['content-type'] || 'application/x-www-form-urlencoded', 'user-agent': $request.headers['User-Agent'] || $request.headers['user-agent'] || 'locationd/1.0' },\n    body: $request.bodyBytes || $request.body\n  };\n  const r = await $task.fetch(req);\n  $done({ body: r.body, bodyBytes: r.bodyBytes, headers: r.headers, status: r.statusCode || r.status });\n}\nrelay().catch(() => $done({}));\n`
  return new Response(js, { headers: { 'content-type': 'application/javascript; charset=utf-8' } })
})

export default app
