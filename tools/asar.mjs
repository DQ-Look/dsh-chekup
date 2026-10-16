#!/usr/bin/env node
// Minimal ASAR reader: list or extract files from an Electron asar archive.
// Usage:
//   node asar.mjs list <archive> [substringFilter]
//   node asar.mjs extract <archive> <innerPathPrefix> <outDir>
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'

const UINT32 = 4

/** Read the asar header JSON and the byte offset where file data starts. */
function readArchive(file) {
  const fd = readFileSync(file)
  // Pickle: uint32(size=4) uint32(headerStringSize) uint32(headerObjSize?) ...
  // Layout: [0..3]=4, [4..7]=headerPayloadSize, [8..11]=headerStringSize,
  //         [12..15]=headerJsonSize, then JSON, padded to 4 bytes.
  const headerPayloadSize = fd.readUInt32LE(4)
  const headerStringSize = fd.readUInt32LE(8)
  const headerJsonSize = fd.readUInt32LE(12)
  const jsonStart = 16
  const jsonEnd = jsonStart + headerJsonSize
  const json = fd.subarray(jsonStart, jsonEnd).toString('utf8')
  const header = JSON.parse(json)
  const dataStart = 8 + headerPayloadSize
  return { fd, header, dataStart }
}

/** Walk the asar file tree, yielding { path, size, offset } for regular files. */
function* walk(header, prefix = '') {
  const { files } = header
  if (!files) return
  for (const [name, entry] of Object.entries(files)) {
    const p = prefix ? posix.join(prefix, name) : name
    if (entry.files) yield* walk(entry, p)
    else if (entry.offset !== undefined) {
      yield { path: p, size: Number(entry.size), offset: Number(entry.offset) }
    }
  }
}

const [cmd, archive, ...rest] = process.argv.slice(2)
if (!cmd || !archive) {
  console.error('usage: asar.mjs <list|extract> <archive> [args]')
  process.exit(2)
}
const { fd, header, dataStart } = readArchive(archive)

if (cmd === 'list') {
  const filter = rest[0]
  let n = 0
  for (const f of walk(header)) {
    if (filter && !f.path.includes(filter)) continue
    n++
    if (n <= 4000) console.log(`${String(f.size).padStart(10)}  ${f.path}`)
  }
  console.log(`# total matched: ${n}`)
} else if (cmd === 'extract') {
  const [prefix, outDir] = rest
  if (!prefix || !outDir) {
    console.error('usage: asar.mjs extract <archive> <innerPrefix> <outDir>')
    process.exit(2)
  }
  let n = 0
  for (const f of walk(header)) {
    if (!f.path.startsWith(prefix)) continue
    const rel = f.path.slice(prefix.length).replace(/^\/+/, '')
    const dest = join(outDir, rel)
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, fd.subarray(dataStart + f.offset, dataStart + f.offset + f.size))
    n++
  }
  console.log(`extracted ${n} files -> ${outDir}`)
} else {
  console.error(`unknown command: ${cmd}`)
  process.exit(2)
}
