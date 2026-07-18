import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
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

function buildFakeWlocResponse(latMicro: bigint, lngMicro: bigint, bssid = '64:d8:14:72:60:c'): Uint8Array {
  const header = new Uint8Array(10).fill(0)

  const coordinate: number[] = []
  coordinate.push(0x08)
  coordinate.push(...encodeVarint(latMicro))
  coordinate.push(0x10)
  coordinate.push(...encodeVarint(lngMicro))

  const bssidBytes = Array.from(new TextEncoder().encode(bssid))
  const accessPoint: number[] = []
  accessPoint.push(0x0a)
  accessPoint.push(...encodeVarint(BigInt(bssidBytes.length)))
  accessPoint.push(...bssidBytes)
  accessPoint.push(0x12)
  accessPoint.push(...encodeVarint(BigInt(coordinate.length)))
  accessPoint.push(...coordinate)

  const outer: number[] = []
  outer.push(0x12)
  outer.push(...encodeVarint(BigInt(accessPoint.length)))
  outer.push(...accessPoint)

  const full = new Uint8Array(header.length + outer.length)
  full.set(header, 0)
  full.set(new Uint8Array(outer), header.length)
  return full
}

function buildFakeWlocResponseMultiEntry(entries: Array<{ lat: bigint; lng: bigint; bssid: string }>): Uint8Array {
  const header = new Uint8Array(10).fill(0)
  const out: number[] = []
  for (const entry of entries) {
    const coordinate: number[] = []
    coordinate.push(0x08)
    coordinate.push(...encodeVarint(entry.lat))
    coordinate.push(0x10)
    coordinate.push(...encodeVarint(entry.lng))

    const bssidBytes = Array.from(new TextEncoder().encode(entry.bssid))
    const accessPoint: number[] = []
    accessPoint.push(0x0a)
    accessPoint.push(...encodeVarint(BigInt(bssidBytes.length)))
    accessPoint.push(...bssidBytes)
    accessPoint.push(0x12)
    accessPoint.push(...encodeVarint(BigInt(coordinate.length)))
    accessPoint.push(...coordinate)

    out.push(0x12)
    out.push(...encodeVarint(BigInt(accessPoint.length)))
    out.push(...accessPoint)
  }
  const full = new Uint8Array(header.length + out.length)
  full.set(header, 0)
  full.set(new Uint8Array(out), header.length)
  return full
}

function extractEntriesFromSpoofedMessage(body: Uint8Array): Array<{ bssid: string; lat: bigint; lng: bigint }> {
  const message = body.slice(10)
  const results: Array<{ bssid: string; lat: bigint; lng: bigint }> = []
  let i = 0
  while (i < message.length) {
    const tag = decodeVarint(message, i)
    const fieldNo = Number(tag.value >> 3n)
    const wireType = Number(tag.value & 0x07n)
    i = tag.next
    if (fieldNo === 2 && wireType === 2) {
      const len = decodeVarint(message, i)
      let j = len.next
      const end = j + Number(len.value)
      let bssid = ''
      let lat = 0n
      let lng = 0n
      while (j < end) {
        const apTag = decodeVarint(message, j)
        const apFieldNo = Number(apTag.value >> 3n)
        const apWireType = Number(apTag.value & 0x07n)
        j = apTag.next
        if (apFieldNo === 1 && apWireType === 2) {
          const apLen = decodeVarint(message, j)
          const strStart = apLen.next
          const strEnd = strStart + Number(apLen.value)
          bssid = new TextDecoder().decode(message.slice(strStart, strEnd))
          j = strEnd
        } else if (apFieldNo === 2 && apWireType === 2) {
          const coordLen = decodeVarint(message, j)
          let k = coordLen.next
          const coordEnd = k + Number(coordLen.value)
          while (k < coordEnd) {
            const coordTag = decodeVarint(message, k)
            const coordFieldNo = Number(coordTag.value >> 3n)
            k = coordTag.next
            const val = decodeVarint(message, k)
            if (coordFieldNo === 1) lat = toSigned64(val.value)
            if (coordFieldNo === 2) lng = toSigned64(val.value)
            k = val.next
          }
          j = coordEnd
        } else if (apWireType === 0) {
          j = decodeVarint(message, j).next
        } else if (apWireType === 2) {
          const skipLen = decodeVarint(message, j)
          j = skipLen.next + Number(skipLen.value)
        } else {
          throw new Error('unexpected wire type in access point entry')
        }
      }
      results.push({ bssid, lat, lng })
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
  return results
}

describe('spoofAppleWlocResponse', () => {
  it('replaces latitude and longitude fields inside the nested Coordinate submessage', () => {
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

  it('preserves the BSSID field while rewriting only the coordinate', () => {
    const original = buildFakeWlocResponse(decimalToMicro(35.0), decimalToMicro(139.0), '64:d8:14:72:60:c')
    const spoofed = spoofAppleWlocResponse(original, {
      latMicro: decimalToMicro(48.8566),
      lngMicro: decimalToMicro(2.3522)
    })
    const [entry] = extractEntriesFromSpoofedMessage(spoofed)
    expect(entry.bssid).toBe('64:d8:14:72:60:c')
  })

  it('rewrites coordinates on every AccessPoint entry, not just the first', () => {
    const original = buildFakeWlocResponseMultiEntry([
      { lat: decimalToMicro(35.0), lng: decimalToMicro(139.0), bssid: '64:d8:14:72:60:c' },
      { lat: decimalToMicro(10.0), lng: decimalToMicro(20.0), bssid: '10:bd:18:5f:e9:83' },
      { lat: decimalToMicro(-5.0), lng: decimalToMicro(-90.0), bssid: '98:1:a7:e6:85:70' }
    ])
    const targetLat = decimalToMicro(48.8566)
    const targetLng = decimalToMicro(2.3522)
    const spoofed = spoofAppleWlocResponse(original, { latMicro: targetLat, lngMicro: targetLng })
    const entries = extractEntriesFromSpoofedMessage(spoofed)
    expect(entries).toHaveLength(3)
    for (const entry of entries) {
      expect(entry.lat).toBe(targetLat)
      expect(entry.lng).toBe(targetLng)
    }
    expect(entries.map(e => e.bssid)).toEqual(['64:d8:14:72:60:c', '10:bd:18:5f:e9:83', '98:1:a7:e6:85:70'])
  })

  it('round-trips a negative latitude and negative longitude correctly (Southern/Western hemisphere)', () => {
    const original = buildFakeWlocResponse(decimalToMicro(35.0), decimalToMicro(139.0))
    const targetLat = decimalToMicro(-33.8688)
    const targetLng = decimalToMicro(-70.6693)
    const spoofed = spoofAppleWlocResponse(original, { latMicro: targetLat, lngMicro: targetLng })
    const [entry] = extractEntriesFromSpoofedMessage(spoofed)
    expect(entry.lat).toBe(targetLat)
    expect(entry.lng).toBe(targetLng)
  })

  it('round-trips positive coordinates without sign corruption', () => {
    const original = buildFakeWlocResponse(decimalToMicro(0), decimalToMicro(0))
    const targetLat = decimalToMicro(48.8566)
    const targetLng = decimalToMicro(2.3522)
    const spoofed = spoofAppleWlocResponse(original, { latMicro: targetLat, lngMicro: targetLng })
    const [entry] = extractEntriesFromSpoofedMessage(spoofed)
    expect(entry.lat).toBe(targetLat)
    expect(entry.lng).toBe(targetLng)
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

describe('capture fixture regression', () => {
  const fixturePath = join(__dirname, 'Fixtures', 'sample-01.bin')
  const hasFixture = existsSync(fixturePath)

  it.skipIf(!hasFixture)("rewrites a real captured gs-loc response without throwing and changes every entry's coordinate", () => {
    const original = new Uint8Array(readFileSync(fixturePath))
    const targetLat = decimalToMicro(48.8566)
    const targetLng = decimalToMicro(2.3522)
    const spoofed = spoofAppleWlocResponse(original, { latMicro: targetLat, lngMicro: targetLng })
    expect(spoofed.length).toBeGreaterThan(0)
    const entries = extractEntriesFromSpoofedMessage(spoofed)
    expect(entries.length).toBeGreaterThan(0)
    for (const entry of entries) {
      expect(entry.lat).toBe(targetLat)
      expect(entry.lng).toBe(targetLng)
    }
  })

  if (!hasFixture) {
    it.skip('no real capture found — see Worker/Test/Fixtures/README.md to add one', () => {
      expect(true).toBe(true)
    })
  }
})
