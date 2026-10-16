/**
 * End-to-end boot of dsh-checkup through the REAL DSH
 * browser module system (dsh-client-modules/lib/client.js), exactly like
 * .ref/skeleton/harness.mjs. Proves the classic-script contract holds:
 * id === package name, factory materializes, apply() registers its slots.
 */
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const nodeRequire = createRequire(import.meta.url);
const MODULES_BUNDLE = 'D:/code/dsh-checkup/.ref/asar/dsh-client-modules/lib/client.js';
const PLUGIN_BUNDLE = 'D:/code/dsh-checkup/client.js';

// `.ref/` holds decompiled copies of the installed DSH packages and is
// gitignored (it is ~38 MB of third-party source, not part of this plugin).
// This test needs the real module system from it, so fail with an actionable
// message rather than a bare ENOENT.
if (!existsSync(MODULES_BUNDLE)) {
  console.error('SKIP: dsh-client-modules bundle not found at');
  console.error(`      ${MODULES_BUNDLE}`);
  console.error('      `.ref/` is gitignored (decompiled third-party source). Re-extract with:');
  console.error('      node tools/asar.mjs extract "<DSH install>/resources/app.asar" dsh/ .ref/asar/');
  process.exit(0);
}

/* browser stubs */
const head = [];
globalThis.document = {
  head: { appendChild: (el) => { head.push(el); return el; } },
  createElement: (tag) => ({ tagName: tag, dataset: {}, style: {}, setAttribute(k, v) { this[k] = v; }, getAttribute(k) { return this[k]; }, textContent: '' }),
  querySelector: (sel) => head.find((el) => el.tagName === 'style' && String(el['data-plugin-css'] ?? '') === sel.split('"')[1]) ?? null,
  querySelectorAll: () => head
};
globalThis.window = globalThis;
const queue = [];
globalThis.__ModuleLoader__ = {
  mode: 'queue',
  pendingQueue: queue,
  load(registration) { queue.push(registration); },
  create() { throw new Error('harness: create not installed yet'); }
};

/* evaluate the real modules bundle */
new Function(readFileSync(MODULES_BUNDLE, 'utf8'))();
console.log('[1] modules bundle registered:', queue.map((r) => r.id));

/* install the facade exactly like bootInjections() */
const MODULES_ID = '@deepseek-ai/dsh-client-modules';
const boot = {
  rev: 'harness-rev',
  entries: [{ id: 'dsh-checkup', url: 'plugins/??dsh-checkup/client.js&rev=abc', rev: 'abc', external: [] }],
  batches: [{ phase: 'application', url: 'plugins/??dsh-checkup/client.js&rev=abc', rev: 'abc', entries: ['dsh-checkup'] }]
};
const React = { createElement: (...a) => ({ type: a[0], props: a[1] ?? {}, children: a.slice(2) }) };
const staticModules = {
  react: React, 'react/jsx-runtime': { jsx: React.createElement, jsxs: React.createElement, Fragment: 'Fragment' },
  'react-dom': {}, 'react-dom/client': {},
  '@deepseek-ai/cordis': {}, '@deepseek-ai/dsh-client-store': {},
  '@deepseek-ai/dsh-client-ui-slots': {}, '@deepseek-ai/dsh-client-ui-primitives': {}, '@deepseek-ai/dsh-client-ui-dockkit': {}
};
const transports = [];
const loadBundle = async (url) => { transports.push(url); new Function(readFileSync(PLUGIN_BUNDLE, 'utf8'))(); };
const facade = globalThis.__ModuleLoader__;
facade.create = function create(options) {
  if (this.mode !== 'queue') throw new Error('harness: create called after boot');
  const index = queue.findIndex((r) => r.id === MODULES_ID);
  const registration = queue[index];
  if (registration === undefined) throw new Error('harness: modules bundle not preloaded');
  queue.splice(index, 1);
  const exports = registration.factory((spec) => { throw new Error('pre-boot require: ' + spec); });
  return exports.createClientModuleSystem(this, { id: registration.id, exports }, options);
};
const modules = facade.create({ boot, staticModules, loadBundle });
console.log('[2] module system created; graph rows =', modules.manifest.modules.map((r) => r.id));

/* import the plugin row */
const pluginExports = await modules.import('dsh-checkup');
console.log('[3] transported URLs:', transports);
console.log('[4] plugin exports:', Object.keys(pluginExports));
console.log('    name   =', pluginExports.name);
console.log('    inject =', pluginExports.inject);
console.log('    typeof apply =', typeof pluginExports.apply);
console.log('[5] style tags injected:', head.map((el) => el['data-plugin-css']).filter(Boolean));

/* run apply() against a recording ctx (uses real slots stub from the bundle is not available; use a recorder) */
const registrations = [];
const ctx = {
  effect: (fn) => { const d = fn(); return typeof d === 'function' ? d : () => {}; },
  logger: { error() {}, warn() {}, info() {} },
  locale: { register: () => {}, bind: () => (k) => k },
  slots: {
    inject: (key, cb) => { registrations.push(['slots.inject', key]); return cb(); },
    register: (options, component) => { registrations.push(['slots.register', options.name, options.id ?? options.key, options.order, typeof component]); return () => {}; },
    snapshot: () => [], onMutate: () => () => {}, onEntryError: () => () => {}
  },
  remote: {
    pluginInventory: {
      list: async () => ({
        ok: true,
        value: {
          entries: [],
          // The agent-preset subtree arrives as a sibling of `entries`, never
          // inside it. The plugin must read it without throwing when it is
          // absent (older hosts / embedders) and without throwing when a
          // composition carries a malformed row.
          agentPresets: [
            { name: 'standard', rows: [{ moduleName: 'some-preset-plugin', enabled: true, fiberPhase: 'active' }] },
            { name: 'minimal', rows: [{ moduleName: 42 }] }, // malformed: no moduleName
            { name: 'cordis' }                                // no rows array at all
          ]
        }
      })
    }
  }
};
pluginExports.apply(ctx);
console.log('[6] registrations through real module system:');
for (const r of registrations) console.log('    ', JSON.stringify(r));

/* ---- REAL-SURFACE CONTRACT CHECKS --------------------------------------
 * The recorder above is permissive: it happily answers onMutate() even though
 * the real SlotRegistry (dsh-client-ui-renderer) does not expose it. These
 * checks pin the plugin to the surface that actually ships, so a call to a
 * non-existent method fails here instead of throwing at plugin activation.
 *
 * Source of truth: .ref/asar/dsh-client-ui-renderer/lib/client.js
 *   SlotRegistry methods: inject, install, installLocale, provideRoot,
 *   installScope, bindStoreScope, renderSlot, entries, entriesOfSlot,
 *   snapshot, onEntryError, spec, subscribe, getVersion, register,
 *   registerFactory.
 *   SlotCore.onMutate is PRIVATE — the renderer bridges it to the cordis
 *   event 'slots/changed' in its constructor.
 * ---------------------------------------------------------------------- */
const REAL_SLOTS_SURFACE = [
  'inject', 'install', 'installLocale', 'provideRoot', 'installScope',
  'bindStoreScope', 'renderSlot', 'entries', 'entriesOfSlot', 'snapshot',
  'onEntryError', 'spec', 'subscribe', 'getVersion', 'register', 'registerFactory'
];
let surfaceFailures = 0;
const must = (cond, msg) => {
  if (!cond) { console.error('FAIL:', msg); surfaceFailures++; }
  else console.log('PASS:', msg);
};

must(pluginExports.inject.includes('remote.pluginInventory'),
  "module inject includes 'remote.pluginInventory' (package.json dsh.client.inject carries the package names)");
must(!('onMutate' in REAL_SLOTS_SURFACE),
  "reference surface confirms slots.onMutate does NOT exist (regression guard for the ctx.on('slots/changed') migration)");

// The overlay banner was removed: the settings section is the ONLY surface.
// shell.overlay is an additive list slot shared with the Chat quota notice, so
// parking a permanent occupant there to report "nothing is wrong" was dropped.
must(registrations.every((r) => r[1] !== 'shell.overlay'),
  'apply() does not touch shell.overlay (report-only by design)');
must(registrations.some((r) => r[1] === 'settings.section'),
  'apply() registers the settings.section report');

// The agent-preset subtree is read by a pure helper, `readPresetRows`. Extract
// it from the real client.js source and drive it directly with the same shapes
// the host produces (dsh-host-plugin-inventory/lib/index.js:144-154), plus the
// malformed shapes a defensive scan must survive.
const presetFnSrc = (() => {
  const m = readFileSync(PLUGIN_BUNDLE, 'utf8')
    .match(/function readPresetRows\(value\) \{[\s\S]*?\n    \}/);
  if (m === null) throw new Error('boot test: readPresetRows not found in client.js');
  return m[0];
})();
const readPresetRows = new Function(`return (${presetFnSrc.replace(/^function readPresetRows/, 'function readPresetRows')})`)();

const presetRowsObserved = readPresetRows({
  agentPresets: [
    { name: 'standard', rows: [{ moduleName: 'some-preset-plugin', enabled: true, fiberPhase: 'active' }] },
    { name: 'minimal', rows: [{ moduleName: 42 }] }, // malformed: no moduleName
    { name: 'cordis' },                              // no rows array at all
    null,                                            // null composition
    'not-an-object'                                  // wrong type entirely
  ]
});
must(presetRowsObserved.length === 1 && presetRowsObserved[0].preset === 'standard',
  `reads agentPresets[] and skips malformed rows — got ${JSON.stringify(presetRowsObserved)}`);
must(presetRowsObserved[0].moduleName === 'some-preset-plugin',
  'the preset row carries its moduleName through to the scan input');
must(readPresetRows({}).length === 0,
  'a host without agentPresets yields zero preset rows (older hosts / embedders)');
must(readPresetRows({ agentPresets: [] }).length === 0,
  'an empty agentPresets array yields zero preset rows');

// The plugin must not call ctx.slots.onMutate: re-run apply against a surface
// that mimics the real registry exactly, and prove nothing throws.
const realishCtx = {
  effect: (fn) => { const d = fn(); return typeof d === 'function' ? d : () => {}; },
  logger: { error() {}, warn() {}, info() {} },
  locale: { register: () => {}, bind: () => (k) => k },
  on: () => () => {},
  slots: {
    inject: (key, cb) => cb(),
    register: () => () => {},
    snapshot: () => [],
    onEntryError: () => () => {}
    // deliberately NO onMutate — exactly like the real SlotRegistry
  },
  remote: { pluginInventory: { list: async () => ({ ok: true, value: { entries: [] } }) } }
};
let activationThrew = null;
try {
  pluginExports.apply(realishCtx);
} catch (error) {
  activationThrew = error;
}
must(activationThrew === null,
  `apply() survives a registry without slots.onMutate${activationThrew ? ` — threw: ${activationThrew.message}` : ''}`);

console.log(surfaceFailures === 0
  ? 'OK: health-monitor client.js loaded and applied through the real module system.'
  : `${surfaceFailures} SURFACE CHECK(S) FAILED`);
process.exit(surfaceFailures === 0 ? 0 : 1);