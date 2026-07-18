import { describe, it, expect } from 'vitest'
import {
  spoofAppleWlocResponse,
  decimalToMicro,
  microToDecimal,
  encodeVarint,
  decodeVarint,
  encodeZigzagVarint,
  decodeZigzagVarint,
  toSigned64
} from '../Src/Proto/Apple-wloc'

function buildFakeWlocResponse(latMicro: bigint, lngMicro: bigint): Uint8Array {
  const header = new Uint8Array(10).fill(0)
  const inner: number[] = []
  inner.push(0x08)
  inner.push(...encodeVarint(latMicro))
  inner.push(0x10)
  inner.push(...encodeVarint(lngMicro))
  const innerBytes = new Uint8Array(inner)
  const outer: number[] = []
  outer.push(0x12)
  outer.push(...encodeVarint(BigInt(innerBytes.length)))
  outer.push(...innerBytes)
  const full = new Uint8Array(header.length + outer.length)
  full.set(header, 0)
  full.set(new Uint8Array(outer), header.length)
  return full
}

function extractLatLngFromSpoofedMessage(body: Uint8Array): { lat: bigint; lng: bigint } {
  const message = body.slice(10)
  let i = 0
  let lat = 0n
  let lng = 0n
  while (i < message.length) {
    const tag = decodeVarint(message, i)
    const fieldNo = Number(tag.value >> 3n)
    const wireType = Number(tag.value & 0x07n)
    i = tag.next
    if (fieldNo === 2 && wireType === 2) {
      const len = decodeVarint(message, i)
      let j = len.next
      const end = j + Number(len.value)
      while (j < end) {
        const innerTag = decodeVarint(message, j)
        const innerFieldNo = Number(innerTag.value >> 3n)
        j = innerTag.next
        const val = decodeVarint(message, j)
        if (innerFieldNo === 1) lat = toSigned64(val.value)
        if (innerFieldNo === 2) lng = toSigned64(val.value)
        j = val.next
      }
      i = end
      continue
    }
    if (wireType === 0) {
      i = decodeVarint(message, i).next
    } else if (wireType === 2) {
      const len = decodeVarint(message, i)
      i = len.next + Number(len.value)
    } else {
      throw new Error('unexpected wire type in test fixture')
    }
  }
  return { lat, lng }
}

describe('spoofAppleWlocResponse', () => {
  it('replaces latitude and longitude fields inside the location submessage', () => {
    const original = buildFakeWlocResponse(decimalToMicro(35.0), decimalToMicro(139.0))
    const targetLat = decimalToMicro(48.8566)
    const targetLng = decimalToMicro(2.3522)
    const spoofed = spoofAppleWlocResponse(original, { latMicro: targetLat, lngMicro: targetLng })
    expect(spoofed.length).toBeGreaterThan(0)
    expect(spoofed).not.toEqual(original)
  })

  it('returns the body unchanged if it is too short to contain a valid message', () => {
    const tiny = new Uint8Array([1, 2, 3])
    const result = spoofAppleWlocResponse(tiny, { latMicro: 0n, lngMicro: 0n })
    expect(result).toEqual(tiny)
  })

  it('round-trips a negative latitude and negative longitude correctly (Southern/Western hemisphere)', () => {
    const original = buildFakeWlocResponse(decimalToMicro(35.0), decimalToMicro(139.0))
    const targetLat = decimalToMicro(-33.8688) // Sydney
    const targetLng = decimalToMicro(-70.6693) // negative longitude edge case
    const spoofed = spoofAppleWlocResponse(original, { latMicro: targetLat, lngMicro: targetLng })
    const { lat, lng } = extractLatLngFromSpoofedMessage(spoofed)
    expect(lat).toBe(targetLat)
    expect(lng).toBe(targetLng)
  })

  it('round-trips positive coordinates without sign corruption', () => {
    const original = buildFakeWlocResponse(decimalToMicro(0), decimalToMicro(0))
    const targetLat = decimalToMicro(48.8566)
    const targetLng = decimalToMicro(2.3522)
    const spoofed = spoofAppleWlocResponse(original, { latMicro: targetLat, lngMicro: targetLng })
    const { lat, lng } = extractLatLngFromSpoofedMessage(spoofed)
    expect(lat).toBe(targetLat)
    expect(lng).toBe(targetLng)
  })
})

describe('coordinate scaling helpers', () => {
  it('decimalToMicro scales decimal degrees by 1e8 and rounds correctly', () => {
    expect(decimalToMicro(35.6762)).toBe(3567620000n)
    expect(decimalToMicro(-122.4194)).toBe(-12241940000n)
  })

  it('microToDecimal is the inverse of decimalToMicro (within floating point tolerance)', () => {
    expect(microToDecimal(decimalToMicro(48.8566))).toBeCloseTo(48.8566, 6)
    expect(microToDecimal(decimalToMicro(-70.6693))).toBeCloseTo(-70.6693, 6)
  })
})

describe('varint encoding primitives', () => {
  it('encodeVarint/decodeVarint + toSigned64 round-trips negative int64 values', () => {
    const value = -12241940000n
    const encoded = new Uint8Array(encodeVarint(value))
    const decoded = decodeVarint(encoded, 0)
    expect(toSigned64(decoded.value)).toBe(value)
  })

  it('encodeVarint/decodeVarint round-trips positive int64 values', () => {
    const value = 4887066000n
    const encoded = new Uint8Array(encodeVarint(value))
    const decoded = decodeVarint(encoded, 0)
    expect(decoded.value).toBe(value)
  })

  it('encodeZigzagVarint/decodeZigzagVarint round-trips negative values', () => {
    const value = -70669300000n
    const encoded = new Uint8Array(encodeZigzagVarint(value))
    const decoded = decodeZigzagVarint(encoded, 0)
    expect(decoded.value).toBe(value)
  })

  it('encodeZigzagVarint/decodeZigzagVarint round-trips positive values', () => {
    const value = 48856600000n
    const encoded = new Uint8Array(encodeZigzagVarint(value))
    const decoded = decodeZigzagVarint(encoded, 0)
    expect(decoded.value).toBe(value)
  })
})

describe('capture fixture regression (manual)', () => {
  it.skip('replace with a real captured gs-loc response to validate field offsets', () => {
    // Steps:
    // 1. Capture a real response body via Surge/Loon MITM logging on gs-loc.apple.com/clls/wloc
    // 2. Save raw bytes to Worker/Test/Fixtures/sample-01.bin
    // 3. Load it here with Node's fs.readFileSync, run spoofAppleWlocResponse, and manually
    //    decode the result with a protobuf inspector to confirm lat/lng landed correctly.
    // 4. If the real capture uses zigzag (sint64) encoding instead of plain int64, switch
    //    replaceLocationMessage in Apple-wloc.ts to use encodeZigzagVarint/decodeZigzagVarint.
    expect(true).toBe(true)
  })
})
