// Accurate merged-topology reproduction.
//
// Composition order (cordis bundle layers, last write wins per row id):
//   dsh-base -> dsh-web-app -> presets/{standard,ptc,minimal,cordis} ->
//   profile cordis.patch.yml -> third-party bundle patches
//
// Agent-preset `config.plugins` rows are NOT top-level Loader entries: the
// host reports them under `agentPresets`, not under `entries`, so they never
// reach pluginInventory.list().entries — the array findInert reads.
import { readFileSync, existsSync, readdirSync } from 'node:fs';

const entries = new Map(); // id -> { id, name, disabled, group, layer }

/** Parse a patch file's rows. `insert:` children are indented 2 spaces. */
function parseRows(file, layer) {
  if (!existsSync(file)) { console.log(`MISSING ${layer}`); return; }
  let cur = null;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '');
    // row start, either top-level (`- id:`) or under an `insert:` (`  - id:`)
    if (/^\s*- id:\s*(\S+)\s*$/.test(line)) {
      if (cur?.name) entries.set(cur.id, cur);
      cur = { id: RegExp.$1, name: null, disabled: false, disabledExpr: false, group: false, layer };
      continue;
    }
    if (/^\s*-\s*insert:\s*$/.test(line)) continue;
    if (!cur) continue;
    if (/^\s+name:\s*(.+?)\s*$/.test(line)) cur.name = line.match(/^\s+name:\s*(.+?)\s*$/)[1].replace(/^['"]|['"]$/g, '');
    else if (/^\s+disabled:\s*true\s*$/.test(line)) cur.disabled = true;
    else if (/^\s+disabled:\s*!!js/.test(line)) cur.disabledExpr = true;
    else if (/^\s+group:\s*true/.test(line)) cur.group = true;
    // a new sibling row or a new top-level key ends this row
    else if (/^\s*-\s/.test(line) || /^\S/.test(line)) { if (cur.name) entries.set(cur.id, cur); cur = null; }
  }
  if (cur?.name) entries.set(cur.id, cur);
}

// NOTE: preset files contain ONE top-level row each (preset-standard etc.);
// their `config.plugins` children are nested deeper and are skipped by the
// depth anchor in parseRows, which is what the Loader reports: a preset's
// rows live under `agentPresets`, never under `entries`.
parseRows('D:/code/dsh-checkup/.ref/asar/dsh-base/cordis.patch.yml', 'dsh-base');
parseRows('D:/code/dsh-checkup/.ref/asar/dsh-web-app/cordis.patch.yml', 'dsh-web-app');
parseRows('D:/code/dsh-checkup/.ref/asar/dsh-web-app/presets/standard.patch.yml', 'preset/standard');
parseRows('D:/code/dsh-checkup/.ref/asar/dsh-web-app/presets/ptc.patch.yml', 'preset/ptc');
parseRows('D:/code/dsh-checkup/.ref/asar/dsh-web-app/presets/minimal.patch.yml', 'preset/minimal');
parseRows('D:/code/dsh-checkup/.ref/asar/dsh-web-app/presets/cordis.patch.yml', 'preset/cordis');
parseRows('C:/Users/PC/.dsh/profiles/desktop/cordis.patch.yml', 'profile');
// third-party bundles (profile node_modules)
for (const [p, id] of [
  ['@cckbc/dsh-session-recycle-bin', 'delete-session'],
  ['@liustack/modsearch', 'modsearch'],
  ['dsh-plugin', 'dsh-plugin'],
  ['@local/dsh-checkup', 'dsh-checkup'],
]) {
  const f = `C:/Users/PC/.dsh/profiles/desktop/node_modules/${p}/cordis.patch.yml`;
  if (!existsSync(f)) continue;
  for (const raw of readFileSync(f, 'utf8').split(/\r?\n/)) {
    if (/^\s+- id:\s*(\S+)/.test(raw)) { entries.set(RegExp.$1, { id: RegExp.$1, name: null, disabled: false, disabledExpr: false, group: false, layer: p }); }
    else if (raw.match(/^\s+name:\s*(.+)$/) && entries.has(id)) { const e = entries.get(id); e.name = raw.match(/^\s+name:\s*(.+)$/)[1].trim().replace(/^['"]|['"]$/g, ''); }
  }
}

const all = [...entries.values()].filter((e) => e.name);
console.log(`merged top-level Loader entries: ${all.length}`);
const byLayer = {};
for (const e of all) byLayer[e.layer] = (byLayer[e.layer] ?? 0) + 1;
console.log('by layer:', JSON.stringify(byLayer, null, 2));

// client-half package names from the INSTALLED app.asar
const ASAR = 'D:/ProgramFiles/DeepSeek Harness/resources/app.asar';
const fd = readFileSync(ASAR);
const header = JSON.parse(fd.subarray(16, 16 + fd.readUInt32LE(12)).toString('utf8'));
const dataStart = 8 + fd.readUInt32LE(4);
function* walk(files, prefix = '') {
  for (const [name, entry] of Object.entries(files)) {
    const p = prefix ? `${prefix}/${name}` : name;
    if (entry.files) yield* walk(entry.files, p);
    else if (entry.offset !== undefined) yield { path: p, size: Number(entry.size), offset: Number(entry.offset) };
  }
}
const clientPkgs = new Set();
for (const f of walk(header.files)) {
  if (!/^dsh\/node_modules\/@deepseek-ai\/[^/]+\/package\.json$/.test(f.path)) continue;
  try {
    const j = JSON.parse(fd.subarray(dataStart + f.offset, dataStart + f.offset + f.size).toString('utf8'));
    if (j?.dsh?.client?.platform === 'web') clientPkgs.add(j.name);
  } catch { /* ignore */ }
}
for (const p of ['@cckbc/dsh-session-recycle-bin', '@liustack/modsearch', 'dsh-plugin', '@local/dsh-checkup']) {
  clientPkgs.add(p);
}
console.log(`\nclient-half packages: ${clientPkgs.size}`);

const client = all.filter((e) => clientPkgs.has(e.name));
const hostOnly = all.filter((e) => !clientPkgs.has(e.name));
const enabledHostOnly = hostOnly.filter((e) => !e.disabled && !e.disabledExpr && !e.group);

console.log(`\n===== the number the UI banner would show =====`);
console.log(`top-level entries                 : ${all.length}`);
console.log(`  client-half (browser-visible)   : ${client.length}`);
console.log(`  host-only (never in slots)      : ${hostOnly.length}`);
console.log(`    of those, disabled/group      : ${hostOnly.length - enabledHostOnly.length}`);
console.log(`    host-only AND enabled         : ${enabledHostOnly.length}`);
console.log(`\nfindInert would emit one INFO alert per enabled host-only entry:`);
console.log(`  => ${enabledHostOnly.length} info alerts, all false positives`);

console.log(`\n-- enabled host-only entries (the false positives) --`);
for (const e of enabledHostOnly) console.log(`  [${e.layer}] ${e.id} -> ${e.name}`);

console.log(`\n-- client-half entries (the only ones the detector may judge) --`);
for (const e of client) console.log(`  [${e.layer}] ${e.id} -> ${e.name}`);
