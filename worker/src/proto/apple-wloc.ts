export type Coord = {
  latMicro: bigint
  lngMicro: bigint
}

function encodeVarint(value: bigint): number[] {
  const out: number[] = []
  let v = value
  while (v >= 0x80n) {
    out.push(Number((v & 0x7fn) | 0x80n))
    v >>= 7n
  }
  out.push(Number(v))
  return out
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

function replaceLocationMessage(message: Uint8Array, latMicro: bigint, lngMicro: bigint) {
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
      if (fieldNo === 1) {
        out.push(...message.slice(fieldStart, tag.next))
        out.push(...encodeVarint(latMicro))
        replacedLat = true
      } else {
        out.push(...message.slice(fieldStart, tag.next))
        out.push(...encodeVarint(lngMicro))
        replacedLng = true
      }
      i = decoded.next
      continue
    }
    const next = skipField(message, i, wireType)
    out.push(...message.slice(fieldStart, next))
    i = next
  }
  if (!replacedLat) {
    out.push(...encodeVarint(8n))
    out.push(...encodeVarint(latMicro))
  }
  if (!replacedLng) {
    out.push(...encodeVarint(16n))
    out.push(...encodeVarint(lngMicro))
  }
  return new Uint8Array(out)
}

export function spoofAppleWlocResponse(body: Uint8Array, coord: Coord) {
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
      const replaced = replaceLocationMessage(original, coord.latMicro, coord.lngMicro)
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
