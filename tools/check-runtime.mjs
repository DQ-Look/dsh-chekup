// Cross-check the reproduction against what the host's Loader would actually
// report, by reading the *installed* package set rather than the patch files.
// The profile's node_modules only holds the profile-specific bundles; the
// built-in @deepseek-ai rows resolve from the runtime's own node_modules, so
// the two sources must agree on the row count.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';

const RUNTIME_NM = 'D:/ProgramFiles/DeepSeek Harness/resources/app.asar.unpacked/dsh/node_modules';
const REF = 'D:/code/dsh-checkup/.ref/asar';

function pkgName(dir) {
  const f = `${dir}/package.json`;
  if (!existsSync(f)) return null;
  try { return JSON.parse(readFileSync(f, 'utf8')).name ?? null; } catch { return null; }
}

const runtimePkgs = new Set();
for (const d of readdirSync(RUNTIME_NM)) {
  if (!d.startsWith('@')) { const n = pkgName(`${RUNTIME_NM}/${d}`); if (n) runtimePkgs.add(n); continue; }
  for (const sub of readdirSync(`${RUNTIME_NM}/${d}`)) {
    const n = pkgName(`${RUNTIME_NM}/${d}/${sub}`);
    if (n) runtimePkgs.add(n);
  }
}
console.log(`packages physically in the runtime node_modules: ${runtimePkgs.size}`);
for (const p of [...runtimePkgs].sort()) console.log(`  ${p}`);

// A patch row can only be satisfied if its module is resolvable somewhere.
// Everything else in the patch layers must come from the bundled app.asar.
console.log(`\nreference asar top-level dirs: ${readdirSync(REF).length}`);
