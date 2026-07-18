#!/usr/bin/env node
/**
 * Manual protobuf field inspector for Apple WLOC response captures.
 *
 * Usage:
 *   node scripts/inspect-capture.mjs test/fixtures/sample-01.bin
 *
 * Prints every top-level field number, wire type, and (for length-delimited
 * fields) recurses one level deeper so you can visually confirm which field
 * numbers correspond to latitude/longitude before trusting the spoofer logic.
 */
import { readFileSync } from 'node:fs'

function decodeVarint(bytes, offset) {
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

function dump(bytes, offset, end, indent) {
  let i = offset
  while (i < end) {
    const tag = decodeVarint(bytes, i)
    const fieldNo = Number(tag.value >> 3n)
    const wireType = Number(tag.value & 0x07n)
    i = tag.next
    if (wireType === 0) {
      const v = decodeVarint(bytes, i)
      console.log(`${'  '.repeat(indent)}field ${fieldNo} (varint) = ${v.value}`)
      i = v.next
    } else if (wireType === 2) {
      const len = decodeVarint(bytes, i)
      const start = len.next
      const stop = start + Number(len.value)
      console.log(`${'  '.repeat(indent)}field ${fieldNo} (bytes, len=${len.value})`)
      try {
        dump(bytes, start, stop, indent + 1)
      } catch {
        console.log(`${'  '.repeat(indent + 1)}<not a nested message, raw bytes>`)
      }
      i = stop
    } else if (wireType === 1) {
      console.log(`${'  '.repeat(indent)}field ${fieldNo} (fixed64)`)
      i += 8
    } else if (wireType === 5) {
      console.log(`${'  '.repeat(indent)}field ${fieldNo} (fixed32)`)
      i += 4
    } else {
      throw new Error('unsupported wire type ' + wireType)
    }
  }
}

const path = process.argv[2]
if (!path) {
  console.error('Usage: node scripts/inspect-capture.mjs <capture.bin>')
  process.exit(1)
}
const bytes = readFileSync(path)
console.log('Bytes total:', bytes.length)
console.log('First 10 bytes (assumed header):', Buffer.from(bytes.slice(0, 10)).toString('hex'))
console.log('--- decoding from offset 10 ---')
dump(bytes, 10, bytes.length, 0)
