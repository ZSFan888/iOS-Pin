function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  })
}

function buildModuleTemplates(scriptUrl, settingsScriptUrl) {
  return {
    shadowrocket: `#!name=Apple iOS Pin 定位修改
#!desc=固定配置，安装一次即可。之后打开选点页面选择位置并点击"应用到设备"即可切换定位，无需重新导入模块。
#!category=Tools
[Script]
Apple iOS Pin = type=http-response,pattern=^https?:\\/\\/gs-loc(-cn)?\\.apple\\.com\\/clls\\/wloc,requires-body=1,binary-body-mode=1,max-size=0,timeout=30,script-path=${scriptUrl}
iOS Pin Settings = type=http-request,pattern=^https?:\\/\\/gs-loc(-cn)?\\.apple\\.com\\/wloc-settings\\/save,requires-body=0,timeout=10,script-path=${settingsScriptUrl}
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
  const scriptUrl = `${siteBase}/script/ios-pin.js`
  const settingsScriptUrl = `${siteBase}/script/ios-pin-settings.js`
  const templates = buildModuleTemplates(scriptUrl, settingsScriptUrl)
  const content = templates[client]
  if (!content) return new Response('unsupported client: ' + client, { status: 404 })
  return new Response(content, { headers: { 'content-type': 'text/plain; charset=utf-8' } })
}

function handleGetScript() {
  return new Response("/* ios-pin.js — WLOC 响应坐标伪装脚本 (Shadowrocket 兼容, 无 URL/URLSearchParams 依赖) */\n(function () {\n  var STORE_KEY = 'ios_pin_settings';\n  var DEFAULT_ACCURACY = 25;\n  function readRawVarint(buf, pos) { var result = 0n, shift = 0n, p = pos; while (true) { if (p >= buf.length) throw new Error('varint truncated'); if (shift > 63n) throw new Error('varint too long'); var b = buf[p]; p++; result |= BigInt(b & 0x7f) << shift; if ((b & 0x80) === 0) break; shift += 7n; } return { value: result, pos: p }; }\n  function writeRawVarint(u) { var mask64 = (1n << 64n) - 1n; var val = u & mask64; var bytes = []; while (true) { var b = Number(val & 0x7fn); val >>= 7n; if (val !== 0n) { bytes.push(b | 0x80); } else { bytes.push(b); break; } } return Uint8Array.from(bytes); }\n  function toSigned64(u) { var mask = (1n << 64n) - 1n; u = u & mask; return (u & (1n << 63n)) ? u - (1n << 64n) : u; }\n  function fromSigned64(v) { return v & ((1n << 64n) - 1n); }\n  function concatBytes() { var arrs = Array.prototype.slice.call(arguments); var total = 0; for (var i = 0; i < arrs.length; i++) total += arrs[i].length; var out = new Uint8Array(total); var off = 0; for (var j = 0; j < arrs.length; j++) { out.set(arrs[j], off); off += arrs[j].length; } return out; }\n  function parseFieldsShallow(buf, start, end) { var fields = []; var p = start; while (p < end) { var tagR = readRawVarint(buf, p); p = tagR.pos; var tag = Number(tagR.value); var fieldNum = tag >>> 3; var wireType = tag & 0x7; if (fieldNum === 0) throw new Error('invalid field number 0'); if (wireType === 0) { var vR = readRawVarint(buf, p); p = vR.pos; fields.push({ num: fieldNum, wireType: wireType, varint: vR.value }); } else if (wireType === 1) { if (p + 8 > end) throw new Error('fixed64 overrun'); fields.push({ num: fieldNum, wireType: wireType, dataStart: p, dataEnd: p + 8 }); p += 8; } else if (wireType === 5) { if (p + 4 > end) throw new Error('fixed32 overrun'); fields.push({ num: fieldNum, wireType: wireType, dataStart: p, dataEnd: p + 4 }); p += 4; } else if (wireType === 2) { var lenR = readRawVarint(buf, p); p = lenR.pos; var len = Number(lenR.value); if (len < 0 || p + len > end) throw new Error('length-delimited overrun'); fields.push({ num: fieldNum, wireType: wireType, subStart: p, subEnd: p + len }); p += len; } else { throw new Error('unsupported wireType ' + wireType); } } if (p !== end) throw new Error('trailing bytes mismatch'); return fields; }\n  function looksLikeWifiLocation(fields) { if (!fields) return false; var lat = null, lon = null; for (var i = 0; i < fields.length; i++) { var f = fields[i]; if (f.wireType === 0) { if (f.num === 1 && lat === null) lat = f.varint; else if (f.num === 2 && lon === null) lon = f.varint; } } if (lat === null || lon === null) return false; var latDeg = Number(toSigned64(lat)) / 1e8; var lonDeg = Number(toSigned64(lon)) / 1e8; if (!(latDeg >= -90 && latDeg <= 90)) return false; if (!(lonDeg >= -180 && lonDeg <= 180)) return false; if (latDeg === 0 && lonDeg === 0) return false; return true; }\n  function rebuildMessage(buf, start, end, target, depth) { if (depth > 32) throw new Error('max recursion depth exceeded'); var fields = parseFieldsShallow(buf, start, end); var isLoc = looksLikeWifiLocation(fields); var parts = []; for (var i = 0; i < fields.length; i++) { var f = fields[i]; var tagBytes = writeRawVarint(BigInt((f.num << 3) | f.wireType)); if (f.wireType === 0) { var newVal = f.varint; if (isLoc) { if (f.num === 1) newVal = fromSigned64(BigInt(Math.round(target.latitude * 1e8))); else if (f.num === 2) newVal = fromSigned64(BigInt(Math.round(target.longitude * 1e8))); else if (f.num === 3 && typeof target.accuracy === 'number') newVal = fromSigned64(BigInt(Math.round(target.accuracy))); } parts.push(tagBytes, writeRawVarint(newVal)); } else if (f.wireType === 1 || f.wireType === 5) { parts.push(tagBytes, buf.slice(f.dataStart, f.dataEnd)); } else if (f.wireType === 2) { var rebuiltSub; try { rebuiltSub = rebuildMessage(buf, f.subStart, f.subEnd, target, depth + 1); } catch (e) { rebuiltSub = buf.slice(f.subStart, f.subEnd); } parts.push(tagBytes, writeRawVarint(BigInt(rebuiltSub.length)), rebuiltSub); } } return concatBytes.apply(null, parts); }\n  function patchWlocBody(bytes, target) { var buf = (bytes instanceof Uint8Array) ? bytes : new Uint8Array(bytes); try { if (!target || typeof target.latitude !== 'number' || typeof target.longitude !== 'number') throw new Error('invalid target coordinates'); if (!(target.latitude >= -90 && target.latitude <= 90)) throw new Error('latitude out of range'); if (!(target.longitude >= -180 && target.longitude <= 180)) throw new Error('longitude out of range'); var patched = rebuildMessage(buf, 0, buf.length, target, 0); return { ok: true, bytes: patched }; } catch (e) { return { ok: false, bytes: buf, error: (e && e.message) ? e.message : String(e) }; } }\n  function safeReadStore() { try { if (typeof $persistentStore === 'undefined' || !$persistentStore || typeof $persistentStore.read !== 'function') return null; var raw = $persistentStore.read(STORE_KEY); if (!raw) return null; var obj = JSON.parse(raw); if (obj && typeof obj === 'object' && typeof obj.longitude === 'number' && typeof obj.latitude === 'number') return obj; return null; } catch (e) { return null; } }\n  function bytesFromResponse() { try { if (typeof $response !== 'undefined' && $response && $response.bodyBytes) return new Uint8Array($response.bodyBytes); } catch (e) {} try { if (typeof $response !== 'undefined' && $response && typeof $response.body === 'string') { var s = $response.body; var arr = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) arr[i] = s.charCodeAt(i) & 0xff; return arr; } } catch (e) {} return null; }\n  function finishPassthrough() { try { $done({}); } catch (e) {} }\n  function finishPatched(bytes) { try { $done({ response: { status: 200, headers: { 'Content-Length': String(bytes.length) }, bodyBytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) } }); } catch (e) { finishPassthrough(); } }\n  try { var target = { latitude: NaN, longitude: NaN, accuracy: DEFAULT_ACCURACY }; var saved = safeReadStore(); if (saved) { target.latitude = saved.latitude; target.longitude = saved.longitude; if (typeof saved.accuracy === 'number' && saved.accuracy > 0) target.accuracy = saved.accuracy; } if (!isFinite(target.latitude) || !isFinite(target.longitude)) { finishPassthrough(); return; } var bodyBytes = bytesFromResponse(); if (!bodyBytes) { finishPassthrough(); return; } var result = patchWlocBody(bodyBytes, target); if (!result.ok) { finishPassthrough(); return; } finishPatched(result.bytes); } catch (err) { finishPassthrough(); }\n})();", { headers: { 'content-type': 'application/javascript; charset=utf-8' } })
}

function handleGetSettingsScript() {
  return new Response("/* ios-pin-settings.js — 定位坐标保存脚本 (Shadowrocket 兼容, 无 URL/URLSearchParams 依赖) */\n(function () {\n  var STORE_KEY = 'ios_pin_settings';\n  function parseQuery(url) { var out = {}; var qIndex = url.indexOf('?'); if (qIndex === -1) return out; var qs = url.slice(qIndex + 1); var pairs = qs.split('&'); for (var i = 0; i < pairs.length; i++) { if (!pairs[i]) continue; var eq = pairs[i].indexOf('='); var k, v; if (eq === -1) { k = pairs[i]; v = ''; } else { k = pairs[i].slice(0, eq); v = pairs[i].slice(eq + 1); } try { k = decodeURIComponent(k.replace(/\\+/g, ' ')); } catch (e) {} try { v = decodeURIComponent(v.replace(/\\+/g, ' ')); } catch (e) {} if (!(k in out)) out[k] = v; } return out; }\n  function safeReadStore() { try { if (typeof $persistentStore === 'undefined' || !$persistentStore || typeof $persistentStore.read !== 'function') return null; var raw = $persistentStore.read(STORE_KEY); if (!raw) return null; var obj = JSON.parse(raw); if (obj && typeof obj === 'object') return obj; return null; } catch (e) { return null; } }\n  function safeWriteStore(obj) { try { if (typeof $persistentStore === 'undefined' || !$persistentStore || typeof $persistentStore.write !== 'function') return false; return !!$persistentStore.write(JSON.stringify(obj), STORE_KEY); } catch (e) { return false; } }\n  function finish(status, obj) { try { $done({ response: { status: status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(obj) } }); } catch (e) { try { $done({}); } catch (e2) {} } }\n  try { var url = ($request && $request.url) || ''; var params = parseQuery(url); var action = params.action || 'save'; if (action === 'query') { var saved = safeReadStore(); if (saved && typeof saved.longitude === 'number' && typeof saved.latitude === 'number') finish(200, { success: true, longitude: saved.longitude, latitude: saved.latitude, accuracy: saved.accuracy || 25, updatedAt: saved.updatedAt || null }); else finish(200, { success: false, error: '无已保存的坐标' }); return; } if (action === 'clear') { var cleared = safeWriteStore({}); finish(200, { success: !!cleared }); return; } var lonRaw = params.lon !== undefined ? params.lon : params.longitude; var latRaw = params.lat !== undefined ? params.lat : params.latitude; var accRaw = params.acc !== undefined ? params.acc : params.accuracy; var lon = parseFloat(lonRaw); var lat = parseFloat(latRaw); var acc = parseInt(accRaw, 10); if (!isFinite(acc) || acc <= 0) acc = 25; if (!isFinite(lon) || !isFinite(lat)) { finish(400, { success: false, error: '缺少或非法的 lon/lat 参数' }); return; } if (lat < -90 || lat > 90 || lon < -180 || lon > 180) { finish(400, { success: false, error: 'lon/lat 超出合法范围' }); return; } var payload = { longitude: lon, latitude: lat, accuracy: acc, updatedAt: new Date().toISOString() }; var ok = safeWriteStore(payload); if (ok) finish(200, { success: true, longitude: lon, latitude: lat, accuracy: acc }); else finish(500, { success: false, error: '$persistentStore 写入失败（当前客户端可能不支持持久化存储）' }); } catch (err) { finish(500, { success: false, error: (err && err.message) ? err.message : String(err) }); }\n})();", { headers: { 'content-type': 'application/javascript; charset=utf-8' } })
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
    if (method === 'GET' && pathname === '/script/ios-pin.js') {
      return handleGetScript()
    }
    if (method === 'GET' && pathname === '/script/ios-pin-settings.js') {
      return handleGetSettingsScript()
    }
    if (method === 'GET' && pathname === '/wloc-settings/save') {
      return jsonResponse({ ok: true, note: 'this endpoint is intercepted on-device by the proxy MITM script; reaching the real server means the module/MITM is not active yet' })
    }

    return env.ASSETS.fetch(request)
}
