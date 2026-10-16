// How the banner could have shown 163.
//
// pluginInventory.list() returns:
//   value.entries        -> every non-group TOP-LEVEL Loader row
//   value.agentPresets   -> per-preset { rows: [...] } for the preset SUBTREES
//
// The client's runScan() reads ONLY res.value.entries (client.js:374), so
// preset-subtree rows never reach findInert. The candidates below enumerate
// what different filter combinations would have counted, so 163 can be tied
// to a cause.
import { readFileSync, existsSync } from 'node:fs';

const REF = 'D:/code/dsh-checkup/.ref/asar';
const NM = 'C:/Users/PC/.dsh/profiles/desktop/node_modules';

/**
 * Parse a patch file. Rows are classified by whether they sit under a
 * top-level `- insert:` (a Loader row) or deeper inside `config.plugins`
 * (an agent-preset subtree row, mounted by dsh-agent-preset, NOT a Loader
 * entry of the root tree).
 */
function parse(file) {
  const out = [];
  if (!existsSync(file)) return out;
  let inTopInsert = false;
  let cur = null;
  let curIsPresetRow = false;
  let presetDepth = 0;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '');
    const indent = line.length - line.trimStart().length;

    if (/^- insert:\s*$/.test(line)) { inTopInsert = true; continue; }
    if (/^\S/.test(line) && !/^- insert:/.test(line)) { inTopInsert = false; cur = null; continue; }

    if (/^\s*- id:\s*(\S+)\s*$/.test(line)) {
      if (cur?.name) out.push(cur);
      // preset subtree rows live under `config: -> plugins:` inside an insert
      curIsPresetRow = inTopInsert && indent >= 6;
      presetDepth = indent;
      cur = { id: RegExp.$1, name: null, disabled: false, disabledExpr: false, group: false, isPresetRow: curIsPresetRow };
      continue;
    }
    if (!cur) continue;
    const m = line.match(/^\s+name:\s*(.+?)\s*$/);
    if (m) cur.name = m[1].replace(/^['"]|['"]$/g, '');
    else if (/^\s+disabled:\s*true\s*$/.test(line)) cur.disabled = true;
    else if (/^\s+disabled:\s*!!js/.test(line)) cur.disabledExpr = true;
    else if (/^\s+group:\s*true/.test(line)) cur.group = true;
    else if (/^\s*-\s/.test(line) && indent <= presetDepth) { if (cur.name) out.push(cur); cur = null; }
  }
  if (cur?.name) out.push(cur);
  return out;
}

const files = [
  `${REF}/dsh-base/cordis.patch.yml`,
  `${REF}/dsh-web-app/cordis.patch.yml`,
  `${REF}/dsh-web-app/presets/standard.patch.yml`,
  `${REF}/dsh-web-app/presets/ptc.patch.yml`,
  `${REF}/dsh-web-app/presets/minimal.patch.yml`,
  `${REF}/dsh-web-app/presets/cordis.patch.yml`,
  'C:/Users/PC/.dsh/profiles/desktop/cordis.patch.yml',
  `${NM}/@cckbc/dsh-session-recycle-bin/cordis.patch.yml`,
  `${NM}/@liustack/modsearch/cordis.patch.yml`,
  `${NM}/dsh-plugin/cordis.patch.yml`,
  `${NM}/@local/dsh-checkup/cordis.patch.yml`,
];

const allRows = [];
for (const f of files) allRows.push(...parse(f));
const named = allRows.filter((r) => r.name && r.name !== 'cordis:group');
const topLevel = named.filter((r) => !r.isPresetRow);
const nested = named.filter((r) => r.isPresetRow);

// client-half package set, read from the INSTALLED app.asar
const clientPkgs = new Set(['@cckbc/dsh-session-recycle-bin', '@liustack/modsearch', 'dsh-plugin', '@local/dsh-checkup']);
{
  const ASAR = 'D:/ProgramFiles/DeepSeek Harness/resources/app.asar';
  const fd = readFileSync(ASAR);
  const header = JSON.parse(fd.subarray(16, 16 + fd.readUInt32LE(12)).toString('utf8'));
  const dataStart = 8 + fd.readUInt32LE(4);
  const walk = function* (files2, prefix = '') {
    for (const [name, entry] of Object.entries(files2)) {
      const p = prefix ? `${prefix}/${name}` : name;
      if (entry.files) yield* walk(entry.files, p);
      else if (entry.offset !== undefined) yield { path: p, size: Number(entry.size), offset: Number(entry.offset) };
    }
  };
  for (const f of walk(header.files)) {
    if (!/^dsh\/node_modules\/@deepseek-ai\/[^/]+\/package\.json$/.test(f.path)) continue;
    try {
      const j = JSON.parse(fd.subarray(dataStart + f.offset, dataStart + f.offset + f.size).toString('utf8'));
      if (j?.dsh?.client?.platform === 'web') clientPkgs.add(j.name);
    } catch { /* ignore */ }
  }
}

const enabled = (r) => !r.disabled && !r.disabledExpr && !r.group;
const hostOnly = (r) => !clientPkgs.has(r.name);

const enabledTop = topLevel.filter(enabled);
const hostOnlyEnabledTop = topLevel.filter((r) => enabled(r) && hostOnly(r));
const hostOnlyNestedEnabled = nested.filter((r) => enabled(r) && hostOnly(r));

console.log('================ reference counts ================');
console.log(`top-level Loader rows (pluginInventory.entries)  : ${topLevel.length}`);
console.log(`preset subtree rows (agentPresets[].rows)        : ${nested.length}`);
console.log(`all named rows                                   : ${named.length}`);
console.log(`client-half packages (can register a slot)       : ${clientPkgs.size}`);

console.log('\n================ what findInert reports today ================');
console.log(`enabled host-only top-level rows -> INFO alerts  : ${hostOnlyEnabledTop.length}`);
console.log(`(client-half rows are the only ones it may judge: ${enabledTop.filter((r) => !hostOnly(r)).length})`);

console.log('\n================ candidates that could total 163 ================');
const candidates = [
  ['enabled top-level, all', enabledTop.length],
  ['enabled top-level, host-only', hostOnlyEnabledTop.length],
  ['top-level + preset, host-only, enabled', hostOnlyEnabledTop.length + hostOnlyNestedEnabled.length],
  ['named top-level (any enabled flag)', topLevel.length],
  ['all named rows', named.length],
  ['all named rows, host-only', named.filter(hostOnly).length],
  ['top-level + preset rows', named.length],
];
for (const [label, v] of candidates) console.log(`  ${String(v).padStart(4)}  ${label}`);
console.log('\n(closest match to the reported 163, if any, is listed above)');
