function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  })
}

function buildModuleTemplates(scriptUrl, settingsScriptUrl) {
  return {
    shadowrocket: `#!name=Apple WLOC 定位修改
#!desc=固定配置，安装一次即可。之后打开选点页面选择位置并点击"应用到设备"即可切换定位，无需重新导入模块。
#!category=Tools
[Script]
Apple WLOC = type=http-response,pattern=^https?:\\/\\/gs-loc(-cn)?\\.apple\\.com\\/clls\\/wloc,requires-body=1,binary-body-mode=1,max-size=0,timeout=30,script-path=${scriptUrl}
WLOC Settings = type=http-request,pattern=^https?:\\/\\/gs-loc(-cn)?\\.apple\\.com\\/wloc-settings\\/save,requires-body=0,timeout=10,script-path=${settingsScriptUrl}
[MITM]
hostname = %APPEND% gs-loc.apple.com, gs-loc-cn.apple.com
`,
    surge: `[MITM]
hostname = %APPEND% gs-loc.apple.com, gs-loc-cn.apple.com

[Script]
ios-pin = type=http-response,pattern=^https:\\/\\/gs-loc(-cn)?\\.apple\\.com\\/clls\\/wloc,requires-body=1,binary-body-mode=1,max-size=0,timeout=30,script-path=${scriptUrl}
ios-pin-settings = type=http-request,pattern=^https:\\/\\/gs-loc(-cn)?\\.apple\\.com\\/wloc-settings\\/save,requires-body=0,timeout=10,script-path=${settingsScriptUrl}
`,
    loon: `[MITM]
hostname = gs-loc.apple.com, gs-loc-cn.apple.com

[Script]
http-response ^https:\\/\\/gs-loc(-cn)?\\.apple\\.com\\/clls\\/wloc script-path=${scriptUrl}, requires-body=true, binary-body-mode=true, timeout=60, tag=ios-pin
http-request ^https:\\/\\/gs-loc(-cn)?\\.apple\\.com\\/wloc-settings\\/save script-path=${settingsScriptUrl}, timeout=10, tag=ios-pin-settings
`,
    qx: `hostname = gs-loc.apple.com, gs-loc-cn.apple.com
^https:\\/\\/gs-loc(-cn)?\\.apple\\.com\\/clls\\/wloc url script-response-body ${scriptUrl}
^https:\\/\\/gs-loc(-cn)?\\.apple\\.com\\/wloc-settings\\/save url script-request-header ${settingsScriptUrl}
`,
    stash: `http:
  mitm:
    - gs-loc.apple.com
    - gs-loc-cn.apple.com
script-providers:
  ios-pin:
    url: ${scriptUrl}
    interval: 86400
  ios-pin-settings:
    url: ${settingsScriptUrl}
    interval: 86400
http-response:
  - match: ^https:\\/\\/gs-loc(-cn)?\\.apple\\.com\\/clls\\/wloc
    name: ios-pin
    type: script
    require-body: true
    binary-body-mode: true
    provider: ios-pin
http-request:
  - match: ^https:\\/\\/gs-loc(-cn)?\\.apple\\.com\\/wloc-settings\\/save
    name: ios-pin-settings
    type: script
    provider: ios-pin-settings
`
  }
}

function handleGetModule(client, siteBase) {
  const scriptUrl = `${siteBase}/script/wloc.js`
  const settingsScriptUrl = `${siteBase}/script/wloc-settings.js`
  const templates = buildModuleTemplates(scriptUrl, settingsScriptUrl)
  const content = templates[client]
  if (!content) return new Response('unsupported client: ' + client, { status: 404 })
  return new Response(content, { headers: { 'content-type': 'text/plain; charset=utf-8' } })
}

function handleGetScript() {
  const js = `function log(message) {
  try { if (console && console.log) console.log('[ios-pin] ' + message); } catch (e) {}
}
function readPersisted() {
  try {
    if (typeof $persistentStore !== 'undefined' && $persistentStore && $persistentStore.read) {
      const raw = $persistentStore.read('wloc_settings');
      if (raw) return JSON.parse(raw);
    }
  } catch (e) {}
  return null;
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
    const loc = readPersisted();
    if (!loc || !Number.isFinite(loc.latitude) || !Number.isFinite(loc.longitude)) {
      log('no saved location, passing through original response');
      $done({});
      return;
    }
    const input = bytesFromBody();
    const output = spoofAppleWlocResponse(input, decimalToMicro(loc.latitude), decimalToMicro(loc.longitude));
    log('spoofed lat=' + loc.latitude + ' lng=' + loc.longitude);
    $done({ bodyBytes: output });
  } catch (err) {
    log('failed: ' + (err && err.message ? err.message : err));
    $done({});
  }
})();
`
  return new Response(js, { headers: { 'content-type': 'application/javascript; charset=utf-8' } })
}

function handleGetSettingsScript() {
  const js = `function log(message) {
  try { if (console && console.log) console.log('[ios-pin-settings] ' + message); } catch (e) {}
}
function parseQuery(urlString) {
  const out = {};
  const qIndex = urlString.indexOf('?');
  if (qIndex === -1) return out;
  const qs = urlString.slice(qIndex + 1);
  for (const part of qs.split('&')) {
    const i = part.indexOf('=');
    const key = i >= 0 ? part.slice(0, i) : part;
    const value = i >= 0 ? part.slice(i + 1) : '';
    const k = decodeURIComponent(key || '').trim();
    const v = decodeURIComponent(value || '').trim();
    if (k) out[k] = v;
  }
  return out;
}
(function main() {
  try {
    const requestUrl = (typeof $request !== 'undefined' && $request && $request.url) ? $request.url : '';
    const params = parseQuery(requestUrl);
    const lat = Number(params.get ? (params.get('lat') || params.get('latitude')) : params.lat);
    const lon = Number(params.get ? (params.get('lon') || params.get('longitude')) : (params.lon || params.longitude));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('missing lon/lat in request');
    const payload = JSON.stringify({ latitude: lat, longitude: lon, accuracy: 25, updatedAt: new Date(Date.now() + 28800000).toISOString().replace('Z', '+08:00') });
    if (typeof $persistentStore !== 'undefined' && $persistentStore && $persistentStore.write) {
      $persistentStore.write(payload, 'wloc_settings');
    }
    log('saved lon=' + lon + ' lat=' + lat);
    $done({ response: { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ success: true, longitude: lon, latitude: lat, accuracy: 25 }) } });
  } catch (err) {
    log('failed: ' + (err && err.message ? err.message : err));
    $done({ response: { status: 400, body: JSON.stringify({ success: false, error: String(err && err.message ? err.message : err) }) } });
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

    if (method === 'GET' && (match = pathname.match(/^\/api\/module\/([^/]+)$/))) {
      return handleGetModule(decodeURIComponent(match[1]), siteBase)
    }
    if (method === 'GET' && pathname === '/script/wloc.js') {
      return handleGetScript()
    }
    if (method === 'GET' && pathname === '/script/wloc-settings.js') {
      return handleGetSettingsScript()
    }
    if (method === 'GET' && pathname === '/wloc-settings/save') {
      return jsonResponse({ ok: true, note: 'this endpoint is intercepted on-device by the proxy MITM script; reaching the real server means the module/MITM is not active yet' })
    }

    return env.ASSETS.fetch(request)
}
