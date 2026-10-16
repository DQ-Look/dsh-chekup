// Single-pass scan of the installed app.asar: read every real package.json
// directly out of the archive and count dsh.client.platform === "web".
import { readFileSync } from 'node:fs';

const ASAR = 'D:/ProgramFiles/DeepSeek Harness/resources/app.asar';
const fd = readFileSync(ASAR);

// asar pickle header layout (see tools/asar.mjs)
const headerPayloadSize = fd.readUInt32LE(4);
const headerJsonSize = fd.readUInt32LE(12);
const jsonStart = 16;
const jsonEnd = jsonStart + headerJsonSize;
const header = JSON.parse(fd.subarray(jsonStart, jsonEnd).toString('utf8'));
const dataStart = 8 + headerPayloadSize;

/** Yield { path, size, offset } for every regular file under node_modules. */
function* walk(files, prefix = '') {
  for (const [name, entry] of Object.entries(files)) {
    const p = prefix ? `${prefix}/${name}` : name;
    if (entry.files) yield* walk(entry.files, p);
    else if (entry.offset !== undefined) yield { path: p, size: Number(entry.size), offset: Number(entry.offset) };
  }
}

const client = [];
const host = [];
for (const f of walk(header.files)) {
  if (!/^dsh\/node_modules\/@deepseek-ai\/[^/]+\/package\.json$/.test(f.path)) continue;
  let j;
  try { j = JSON.parse(fd.subarray(dataStart + f.offset, dataStart + f.offset + f.size).toString('utf8')); }
  catch { continue; }
  (j?.dsh?.client?.platform === 'web' ? client : host).push(j.name);
}

console.log(`client-half packages in the installed runtime: ${client.length}`);
console.log(`host-only packages in the installed runtime:    ${host.length}`);
console.log(`\nclient-half (what the browser can ever register in the slots ledger):`);
for (const n of client.sort()) console.log(`  ${n}`);
