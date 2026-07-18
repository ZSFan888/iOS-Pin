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

function requireKv(env) {
  if (!env.LOCATIONS) {
    return jsonResponse({
      error: 'LOCATIONS KV binding not configured. Go to the Cloudflare Pages project Settings -> Bindings and add a KV namespace binding named LOCATIONS, then redeploy.'
    }, 500)
  }
  return null
}

async function handleGetLocation(env, token) {
  const kvErr = requireKv(env)
  if (kvErr) return kvErr
  const raw = await env.LOCATIONS.get(`loc:${token}`, 'json')
  if (!raw) return jsonResponse({ error: 'location not found' }, 404)
  return jsonResponse(raw)
}

async function handlePostLocation(env, token, request) {
  const kvErr = requireKv(env)
  if (kvErr) return kvErr
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
  const kvErr = requireKv(env)
  if (kvErr) return kvErr
  const raw = await env.LOCATIONS.get(`history:${token}`, 'json')
  return jsonResponse({ items: raw ?? [] })
}

async function handlePostHistory(env, token, request) {
  const kvErr = requireKv(env)
  if (kvErr) return kvErr
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
  const kvErr = requireKv(env)
  if (kvErr) return kvErr
  const auth = checkWriteAuth(env, token, request)
  if (auth) return auth
  const raw = await env.LOCATIONS.get(`history:${token}`, 'json')
  const items = raw ?? []
  if (index < 0 || index >= items.length) return jsonResponse({ error: 'index out of range' }, 400)
  items.splice(index, 1)
  await env.LOCATIONS.put(`history:${token}`, JSON.stringify(items))
  return jsonResponse({ ok: true, items })
}

function parseCoordinate(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

async function handleGetModule(env, client, token, siteBase) {
  const kvErr = requireKv(env)
  if (kvErr) return kvErr
  const loc = await env.LOCATIONS.get(`loc:${token}`, 'json')
  if (!loc) return new Response('location not found for token: ' + token, { status: 404 })

  const lat = parseCoordinate(loc.lat)
  const lng = parseCoordinate(loc.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return new Response('invalid saved coordinates for token: ' + token, { status: 400 })
  }

  const scriptUrl = `${siteBase}/script/${token}.js`
  const argument = `longitude=${encodeURIComponent(String(lng))}&latitude=${encodeURIComponent(String(lat))}&accuracy=25&logLevel=info`
  const templates = {
    shadowrocket: `#!name=Apple WLOC 定位修改 (${token})
#!desc=打开网页选点后，回到 Shadowrocket 更新本模块即可切换定位。
#!homepage=${siteBase}
#!author=iOS-Pin
#!category=Tools
[Script]
Apple WLOC = type=http-response,pattern=^https?:\\/\\/gs-loc(-cn)?\\.apple\\.com\\/clls\\/wloc,requires-body=1,binary-body-mode=1,max-size=0,timeout=30,script-path=${scriptUrl},argument=${argument}
[MITM]
hostname = %APPEND% gs-loc.apple.com, gs-loc-cn.apple.com
`,
    surge: `[MITM]
hostname = %APPEND% gs-loc.apple.com, gs-loc-cn.apple.com

[Script]
ios-pin = type=http-response,pattern=^https:\\/\\/gs-loc(-cn)?\\.apple\\.com\\/clls\\/wloc,requires-body=1,binary-body-mode=1,max-size=0,timeout=30,script-path=${scriptUrl},argument=${argument}
`,
    loon: `[MITM]
hostname = gs-loc.apple.com, gs-loc-cn.apple.com

[Script]
http-response ^https:\\/\\/gs-loc(-cn)?\\.apple\\.com\\/clls\\/wloc script-path=${scriptUrl}, requires-body=true, binary-body-mode=true, timeout=60, tag=ios-pin
`,
    qx: `hostname = gs-loc.apple.com, gs-loc-cn.apple.com
^https:\\/\\/gs-loc(-cn)?\\.apple\\.com\\/clls\\/wloc url script-response-body ${scriptUrl}
`,
    stash: `http:
  mitm:
    - gs-loc.apple.com
    - gs-loc-cn.apple.com
script-providers:
  ios-pin:
    url: ${scriptUrl}
    interval: 86400
http-response:
  - match: ^https:\\/\\/gs-loc(-cn)?\\.apple\\.com\\/clls\\/wloc
    name: ios-pin
    type: script
    require-body: true
    binary-body-mode: true
    provider: ios-pin
`
  }
  const content = templates[client]
  if (!content) return new Response('unsupported client', { status: 404 })
  return new Response(content, { headers: { 'content-type': 'text/plain; charset=utf-8' } })
}

async function relayAppleWloc(env, token, request) {
  const kvErr = requireKv(env)
  if (kvErr) return kvErr
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
  const js = `const defaults = { latitude: 0, longitude: 0, accuracy: 25, logLevel: 'info' };
function parseArgumentString() {
  const raw = typeof $argument === 'string' ? $argument : '';
  const out = { ...defaults };
  if (!raw) return out;
  for (const part of raw.split('&')) {
    const i = part.indexOf('=');
    const key = i >= 0 ? part.slice(0, i) : part;
    const value = i >= 0 ? part.slice(i + 1) : '';
    const k = decodeURIComponent(key || '').trim();
    const v = decodeURIComponent(value || '').trim();
    if (!k) continue;
    if (k === 'latitude' || k === 'longitude' || k === 'accuracy') out[k] = Number(v);
    else out[k] = v;
  }
  return out;
}
function log(message) {
  try { if (console && console.log) console.log('[ios-pin] ' + message); } catch (e) {}
}
function bytesFromBody() {
  if (typeof $response !== 'undefined' && $response && typeof $response.bodyBytes !== 'undefined' && $response.bodyBytes !== null) return new Uint8Array($response.bodyBytes);
  if (typeof $response !== 'undefined' && $response && $response.body) {
    const s = $response.body;
    const arr = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) arr[i] = s.charCodeAt(i) & 255;
    return arr;
  }
  throw new Error('response body is missing');
}
function zigZagEncode32(value) {
  return ((value << 1) ^ (value >> 31)) >>> 0;
}
function encodeVarint(value) {
  const out = [];
  let v = value >>> 0;
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  out.push(v);
  return out;
}
function replaceFieldVarint(message, fieldNumber, signedValue) {
  const tag = (fieldNumber << 3) | 0;
  const replacement = [...encodeVarint(tag), ...encodeVarint(zigZagEncode32(signedValue))];
  const out = [];
  let i = 0;
  let replaced = false;
  while (i < message.length) {
    const fieldStart = i;
    let shift = 0;
    let tagValue = 0;
    let tagEnd = i;
    while (tagEnd < message.length) {
      const b = message[tagEnd++];
      tagValue |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
    }
    if (tagEnd > message.length) break;
    const wireType = tagValue & 0x7;
    const fieldNum = tagValue >>> 3;
    if (wireType === 0) {
      let valueEnd = tagEnd;
      while (valueEnd < message.length && (message[valueEnd++] & 0x80) !== 0) {}
      if (fieldNum === fieldNumber && !replaced) {
        out.push(...replacement);
        replaced = true;
      } else {
        out.push(...message.slice(fieldStart, valueEnd));
      }
      i = valueEnd;
      continue;
    }
    if (wireType === 1) { out.push(...message.slice(fieldStart, tagEnd + 8)); i = tagEnd + 8; continue; }
    if (wireType === 5) { out.push(...message.slice(fieldStart, tagEnd + 4)); i = tagEnd + 4; continue; }
    if (wireType === 2) {
      let len = 0, lenShift = 0, lenEnd = tagEnd;
      while (lenEnd < message.length) {
        const b = message[lenEnd++];
        len |= (b & 0x7f) << lenShift;
        if ((b & 0x80) === 0) break;
        lenShift += 7;
      }
      const valueEnd = lenEnd + len;
      out.push(...message.slice(fieldStart, valueEnd));
      i = valueEnd;
      continue;
    }
    out.push(...message.slice(fieldStart));
    i = message.length;
  }
  return replaced ? new Uint8Array(out) : message;
}
function decimalToMicro(value) {
  return Math.round(Number(value) * 1000000);
}
function spoofAppleWlocResponse(bytes, latMicro, lngMicro) {
  let out = bytes;
  out = replaceFieldVarint(out, 1, latMicro);
  out = replaceFieldVarint(out, 2, lngMicro);
  return out;
}
(function main() {
  try {
    const cfg = parseArgumentString();
    if (!Number.isFinite(cfg.latitude) || !Number.isFinite(cfg.longitude)) throw new Error('invalid latitude/longitude argument');
    const input = bytesFromBody();
    const output = spoofAppleWlocResponse(input, decimalToMicro(cfg.latitude), decimalToMicro(cfg.longitude));
    log('spoofed token=' + ${JSON.stringify(token)} + ' lat=' + cfg.latitude + ' lng=' + cfg.longitude);
    $done({ bodyBytes: output });
  } catch (err) {
    log('failed: ' + (err && err.message ? err.message : err));
    $done({});
  }
})();
`
  return new Response(js, { headers: { 'content-type': 'application/javascript; charset=utf-8' } })
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await handleRequest(request, env)
    } catch (err) {
      return jsonResponse({ error: 'internal error', message: String(err && err.message ? err.message : err) }, 500)
    }
  }
}

async function handleRequest(request, env) {
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
      return handleGetModule(env, decodeURIComponent(match[1]), decodeURIComponent(match[2]), siteBase)
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
