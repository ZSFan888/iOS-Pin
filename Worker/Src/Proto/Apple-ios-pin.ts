export type Coord = {
  latMicro: bigint
  lngMicro: bigint
}

const UINT64_MASK = (1n << 64n) - 1n

/**
 * Apple iOS Pin response wire format (confirmed against public reverse-engineering
 * write-ups — see Worker/Test/Fixtures/README.md for sources):
 *
 *   [10-byte opaque header][repeated top-level field 2 = AccessPoint entry]
 *
 *   AccessPoint entry:
 *     field 1 (bytes/string) = BSSID, e.g. "64:d8:14:72:60:c"
 *     field 2 (bytes)        = nested Coordinate message
 *       Coordinate:
 *         field 1 (varint) = latitude,  scaled by 1e8 (two's complement wraps
 *                             to a 10-byte varint for "unknown"/negative-ish
 *                             sentinel values like 0xfffffffbcf1dcc00 —
 *                             this is plain varint, NOT zigzag)
 *         field 2 (varint) = longitude, scaled by 1e8, same encoding as above
 *         field 3, 5, 6, 11, 12 (varint) = accuracy / channel / misc, left untouched
 *     field 21 (varint, optional) = misc counter, left untouched
 *
 * Coordinates are plain (non-zigzag) varints — confirmed by the public sample
 * `135582881 * 1e-8 = 1.35544532`, which only round-trips correctly without
 * zigzag decoding. `encodeZigzagVarint`/`decodeZigzagVarint` are kept below
 * in case a future Apple response revision switches encodings; swapping is a
 * one-line change in `replaceCoordinateMessage`.
 */
function encodeVarint(value: bigint): number[] {
  const out: number[] = []
  let v = value < 0n ? (value & UINT64_MASK) : value
  while (v > 0x7fn) {
    out.push(Number((v & 0x7fn) | 0x80n))
    v >>= 7n
  }
  out.push(Number(v))
  return out
}

/** Zigzag-encodes a signed value, then varint-encodes it (for `sint32`/`sint64` fields). */
function encodeZigzagVarint(value: bigint): number[] {
  const zigzag = value >= 0n ? value << 1n : (-value << 1n) - 1n
  return encodeVarint(zigzag)
}

/** Decodes a zigzag-encoded varint back to its signed value. */
function decodeZigzagVarint(bytes: Uint8Array, offset: number) {
  const raw = decodeVarint(bytes, offset)
  const value = raw.value
  const signed = (value & 1n) === 0n ? value >> 1n : -((value + 1n) >> 1n)
  return { value: signed, next: raw.next }
}

function decodeVarint(bytes: Uint8Array, offset: number) {
  let result = 0n
  let shift = 0n
  let i = offset
  while (i < bytes.length) {
    const b = BigInt(bytes[i])
    result |= (b & 0x7fn) << shift
    i += 1
    if ((b & 0x80n) === 0n) return { value: result, next: i }
    shift += 7n
  }
  throw new Error('unterminated varint')
}

/**
 * Reinterprets a raw varint-decoded value as a signed 64-bit two's complement
 * integer. Plain `decodeVarint` returns an always-positive bigint (since it
 * just accumulates bits); this converts values with the top bit set back to
 * their negative representation.
 */
function toSigned64(value: bigint): bigint {
  const masked = value & UINT64_MASK
  return masked >= 1n << 63n ? masked - (1n << 64n) : masked
}

function skipField(bytes: Uint8Array, offset: number, wireType: number) {
  if (wireType === 0) return decodeVarint(bytes, offset).next
  if (wireType === 1) return offset + 8
  if (wireType === 2) {
    const len = decodeVarint(bytes, offset)
    return len.next + Number(len.value)
  }
  if (wireType === 5) return offset + 4
  throw new Error('unsupported wire type: ' + wireType)
}

/**
 * Rewrites the innermost Coordinate message (field 1 = lat, field 2 = lng,
 * both plain varints scaled by 1e8). Any other fields (accuracy, channel,
 * etc.) are copied through untouched. If lat/lng fields are missing they are
 * appended, matching proto3 "field absent = default" semantics.
 */
function replaceCoordinateMessage(message: Uint8Array, latMicro: bigint, lngMicro: bigint) {
  const out: number[] = []
  let i = 0
  let replacedLat = false
  let replacedLng = false
  while (i < message.length) {
    const tag = decodeVarint(message, i)
    const fieldNo = Number(tag.value >> 3n)
    const wireType = Number(tag.value & 0x07n)
    const fieldStart = i
    i = tag.next
    if (wireType === 0 && (fieldNo === 1 || fieldNo === 2)) {
      const decoded = decodeVarint(message, i)
      out.push(...message.slice(fieldStart, tag.next))
      out.push(...encodeVarint(fieldNo === 1 ? latMicro : lngMicro))
      if (fieldNo === 1) replacedLat = true
      else replacedLng = true
      i = decoded.next
      continue
    }
    const next = skipField(message, i, wireType)
    out.push(...message.slice(fieldStart, next))
    i = next
  }
  if (!replacedLat) {
    out.push(...encodeVarint(1n << 3n))
    out.push(...encodeVarint(latMicro))
  }
  if (!replacedLng) {
    out.push(...encodeVarint(2n << 3n))
    out.push(...encodeVarint(lngMicro))
  }
  return new Uint8Array(out)
}

/**
 * Rewrites a single AccessPoint entry (field 1 = BSSID, field 2 = nested
 * Coordinate message). Only field 2 is rewritten; the BSSID and any trailing
 * metadata fields (channel, signal, timestamp, etc.) pass through unchanged
 * so the response still looks structurally authentic to locationd.
 */
function replaceAccessPointEntry(entry: Uint8Array, latMicro: bigint, lngMicro: bigint) {
  const out: number[] = []
  let i = 0
  while (i < entry.length) {
    const tag = decodeVarint(entry, i)
    const fieldNo = Number(tag.value >> 3n)
    const wireType = Number(tag.value & 0x07n)
    const fieldStart = i
    i = tag.next
    if (fieldNo === 2 && wireType === 2) {
      const len = decodeVarint(entry, i)
      const msgStart = len.next
      const msgEnd = msgStart + Number(len.value)
      const original = entry.slice(msgStart, msgEnd)
      const replaced = replaceCoordinateMessage(original, latMicro, lngMicro)
      out.push(...entry.slice(fieldStart, tag.next))
      out.push(...encodeVarint(BigInt(replaced.length)))
      out.push(...replaced)
      i = msgEnd
      continue
    }
    const next = skipField(entry, i, wireType)
    out.push(...entry.slice(fieldStart, next))
    i = next
  }
  return new Uint8Array(out)
}

/**
 * Rewrites every AccessPoint entry (top-level field 2) in an Apple iOS Pin
 * response body to report the same spoofed coordinate. Rewriting *all*
 * entries — not just the first — matters because locationd trilaterates
 * using multiple entries; leaving real coordinates on other entries would
 * pull the computed fix back toward the true location.
 */
export function spoofAppleIosPinResponse(body: Uint8Array, coord: Coord) {
  if (body.length <= 10) return body
  const prefix = body.slice(0, 10)
  const message = body.slice(10)
  const out: number[] = []
  let i = 0
  while (i < message.length) {
    const tag = decodeVarint(message, i)
    const fieldNo = Number(tag.value >> 3n)
    const wireType = Number(tag.value & 0x07n)
    const fieldStart = i
    i = tag.next
    if (fieldNo === 2 && wireType === 2) {
      const len = decodeVarint(message, i)
      const msgStart = len.next
      const msgEnd = msgStart + Number(len.value)
      const original = message.slice(msgStart, msgEnd)
      const replaced = replaceAccessPointEntry(original, coord.latMicro, coord.lngMicro)
      out.push(...message.slice(fieldStart, tag.next))
      out.push(...encodeVarint(BigInt(replaced.length)))
      out.push(...replaced)
      i = msgEnd
      continue
    }
    const next = skipField(message, i, wireType)
    out.push(...message.slice(fieldStart, next))
    i = next
  }
  const finalBody = new Uint8Array(prefix.length + out.length)
  finalBody.set(prefix, 0)
  finalBody.set(new Uint8Array(out), prefix.length)
  return finalBody
}

export function decimalToMicro(value: number) {
  return BigInt(Math.round(value * 100000000))
}

export function microToDecimal(value: bigint) {
  return Number(value) / 100000000
}

export { encodeVarint, decodeVarint, encodeZigzagVarint, decodeZigzagVarint, toSigned64 }
