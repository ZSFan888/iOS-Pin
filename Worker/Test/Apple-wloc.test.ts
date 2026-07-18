import { describe, it, expect } from 'vitest'
import { spoofAppleWlocResponse, decimalToMicro } from '../Src/Proto/Apple-wloc'

function buildFakeWlocResponse(latMicro: bigint, lngMicro: bigint): Uint8Array {
  const header = new Uint8Array(10).fill(0)
  const locFieldTag = [0x08, Number(latMicro & 0x7fn)]
  const inner: number[] = []
  function pushVarint(v: bigint) {
    let val = v
    while (val >= 0x80n) {
      inner.push(Number((val & 0x7fn) | 0x80n))
      val >>= 7n
    }
    inner.push(Number(val))
  }
  inner.push(0x08)
  pushVarint(latMicro)
  inner.push(0x10)
  pushVarint(lngMicro)
  const innerBytes = new Uint8Array(inner)
  const outer: number[] = []
  outer.push(0x12)
  function pushLen(v: number) {
    let val = BigInt(v)
    while (val >= 0x80n) {
      outer.push(Number((val & 0x7fn) | 0x80n))
      val >>= 7n
    }
    outer.push(Number(val))
  }
  pushLen(innerBytes.length)
  outer.push(...innerBytes)
  const full = new Uint8Array(header.length + outer.length)
  full.set(header, 0)
  full.set(new Uint8Array(outer), header.length)
  return full
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

  it('decimalToMicro scales decimal degrees by 1e8 and rounds correctly', () => {
    expect(decimalToMicro(35.6762)).toBe(3567620000n)
    expect(decimalToMicro(-122.4194)).toBe(-12241940000n)
  })
})

describe('capture fixture regression (manual)', () => {
  it.skip('replace with a real captured gs-loc response to validate field offsets', () => {
    // Steps:
    // 1. Capture a real response body via Surge/Loon MITM logging on gs-loc.apple.com/clls/wloc
    // 2. Save raw bytes to Worker/Test/Fixtures/sample-01.bin
    // 3. Load it here with Node's fs.readFileSync, run spoofAppleWlocResponse, and manually
    //    decode the result with a protobuf inspector to confirm lat/lng landed correctly.
    expect(true).toBe(true)
  })
})
