// Smoke + logic test for the health-monitor client half.
// Executes client.js as a classic script, runs apply() against a mock ctx,
// and asserts the detector produces the expected alerts from crafted data.
import { readFileSync } from 'node:fs';

const SRC = 'D:/code/dsh-checkup/client.js';
const src = readFileSync(SRC, 'utf8');

/* ---- minimal browser globals ---- */
globalThis.window = globalThis;
globalThis.__ModuleLoader__ = { load(reg) { globalThis.__HM_FACTORY__ = reg; } };
globalThis.document = {
  querySelector: () => null,
  createElement: () => ({ setAttribute() {}, appendChild() {}, click() {}, set textContent(v) {}, get textContent() { return ''; } }),
  head: { appendChild() {} },
  body: { appendChild() {}, removeChild() {} }
};
// `URL` is stubbed below (exportSnapshot only needs createObjectURL), so keep
// a handle on the real constructor for building this test file's own paths.
const URL2 = URL;
globalThis.URL = { createObjectURL: () => 'blob:x', revokeObjectURL() {} };
globalThis.Blob = class { constructor() {} };
globalThis.FileReader = class { readAsText() {} };

/* ---- the host-composed boot manifest -------------------------------
 * The authoritative list of packages that actually got a browser half.
 * Mirrors the `global` row dsh-client-modules bootInjections() injects.
 * ------------------------------------------------------------------- */
const REAL_BOOT = {
  rev: 'test-rev',
  entries: [
    { id: '@local/plugin-a', url: 'plugins/@local/plugin-a/client.js', rev: 'r1' },
    { id: '@local/plugin-b', url: 'plugins/@local/plugin-b/client.js', rev: 'r1' },
    { id: '@local/plugin-c', url: 'plugins/@local/plugin-c/client.js', rev: 'r1' },
    { id: '@local/plugin-d', url: 'plugins/@local/plugin-d/client.js', rev: 'r1' },
    { id: '@local/plugin-e', url: 'plugins/@local/plugin-e/client.js', rev: 'r1' },
    { id: '@local/plugin-g', url: 'plugins/@local/plugin-g/client.js', rev: 'r1' },
    // plugin-j composed fine; its slot was abdicated by a render crash, which
    // is a separate defect the abdicate branch reports.
    { id: '@local/plugin-j', url: 'plugins/@local/plugin-j/client.js', rev: 'r1' },
    // plugin-k lives in the agent-preset subtree; its browser half composed.
    { id: '@local/plugin-k', url: 'plugins/@local/plugin-k/client.js', rev: 'r1' }
    // plugin-i and plugin-h are deliberately ABSENT:
    //   plugin-i owns a live slot registration -> its client half ran, so its
    //             absence here is a real silent failure.
    //   plugin-h owns no slot registration      -> host-only, so its absence
    //             here is correct and must not be reported.
  ],
  batches: []
};
globalThis.__DSH_BOOT__ = REAL_BOOT;

/* ---- minimal React (structural; no real rendering) ---- */
const React = {
  createElement: (type, props, ...kids) => ({ type, props: props || {}, children: kids.flat().filter((c) => c != null && c !== false) }),
  Fragment: 'Fragment',
  useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
  useEffect: () => {},
  useRef: () => ({ current: null }),
  useMemo: (f) => f(),
  useSyncExternalStore: (sub, get) => get()
};

/* ---- crafted runtime data ---- */
const slotTrees = [
  {
    type: 'slot', name: 'tool.view.demo', kind: 'list',
    occupants: [
      { active: true, registrant: '@local/plugin-a', id: 'a', order: 10, priority: 0 },
      { active: false, registrant: '@local/plugin-b', id: 'a', order: 20, priority: 0 } // shadowed: same id
    ]
  },
  {
    type: 'slot', name: 'shell.overlay', kind: 'single',
    occupants: [
      { active: true, registrant: '@local/plugin-a', priority: 0 },
      { active: false, registrant: '@local/plugin-c', priority: 0 } // shadowed: single loser
    ]
  },
  {
    type: 'slot', name: 'settings.section', kind: 'list', // healthy, distinct ids
    occupants: [
      { active: true, registrant: '@local/plugin-a', id: 'x', order: 10, priority: 0 },
      { active: true, registrant: '@local/plugin-a', id: 'y', order: 20, priority: 0 }
    ]
  },
  {
    // The host composed this plugin's client half once (it owns a live slot
    // registration) but the current boot manifest no longer carries it.
    // That is the real, actionable silent failure findInert reports.
    type: 'slot', name: 'chat.composer', kind: 'single',
    occupants: [
      { active: true, registrant: '@local/plugin-i', priority: 0 }
    ]
  },
  {
    // abdicated: this entry lost its cell to NOBODY — its own render threw
    // and the boundary retired it. findShadowed must report it (error).
    type: 'slot', name: 'chat.attachment', kind: 'single',
    occupants: [
      { active: false, registrant: '@local/plugin-j', priority: 0 }
    ]
  }
];

const plugins = [
  { moduleName: '@local/plugin-a', enabled: true, fiberPhase: 'active' },
  { moduleName: '@local/plugin-b', enabled: true, fiberPhase: 'active' },
  { moduleName: '@local/plugin-c', enabled: true, fiberPhase: 'active' },
  { moduleName: '@local/plugin-d', enabled: true, fiberPhase: 'active' }, // composed, no slot reg: NOT an alert
  { moduleName: '@local/plugin-e', enabled: true, fiberPhase: 'failed', meta: { error: 'Cannot find module ./client' } }, // patch failure
  { moduleName: '@local/plugin-f', enabled: true, fiberPhase: 'pending' }, // transient startup phase: must NOT alert
  { moduleName: '@local/plugin-g', enabled: true, fiberPhase: 'active', meta: { error: 'icon too large' } }, // metadata only: warn
  { moduleName: '@local/plugin-h', enabled: true, fiberPhase: 'active' }, // host-only, absent from boot: NOT an alert
  { moduleName: '@local/plugin-i', enabled: true, fiberPhase: 'active' }, // ran in browser, gone from boot: REAL silent failure
  { moduleName: '@local/plugin-j', enabled: true, fiberPhase: 'active' }  // abdicated occupant above
];

/* ---- the agent-preset subtree -------------------------------------
 * dsh-agent-preset-registry mounts each preset's `config.plugins` into a
 * SEPARATE PresetTree, so these rows arrive under `agentPresets[]` and never
 * appear in `entries`. Until this plugin learned to read them, a plugin that
 * activated fine at top level but failed inside the standing preset produced
 * NO alert at all.
 *
 * Shape mirrors dsh-host-plugin-inventory/lib/index.js:144-154.
 * ------------------------------------------------------------------ */
const agentPresets = [
  {
    name: 'standard',
    rows: [
      // preset-k activates fine and is in the manifest -> healthy, tagged.
      { moduleName: '@local/plugin-k', enabled: true, fiberPhase: 'active' },
      // preset-l FAILS inside the preset -> must be reported as a patch error,
      // and the alert must say it came from the preset subtree. (No meta.error
      // here on purpose: the top-level plugin-e case already covers the
      // "failed AND metadata-broken" combination.)
      { moduleName: '@local/plugin-l', enabled: true, fiberPhase: 'failed' },
      // preset-m has a metadata error only -> warn, preset-tagged.
      {
        moduleName: '@local/plugin-m', enabled: true, fiberPhase: 'active',
        meta: { error: 'icon too large' }
      },
      // preset-n is still pending -> startup transient, must stay silent.
      { moduleName: '@local/plugin-n', enabled: true, fiberPhase: 'pending' },
      // preset-o is host-only inside the preset -> must NOT be reported.
      { moduleName: '@local/plugin-o', enabled: true, fiberPhase: 'active' }
    ]
  }
];

/* ---- mock ctx ---- */
const registered = [];
const recorded = {};
const ctx = {
  effect: (fn) => { const d = fn(); return typeof d === 'function' ? d : () => {}; },
  locale: { register: () => {}, bind: () => (k) => k },
  // cordis event bus: what SlotRegistry's constructor bridges onMutate into.
  on: (name, fn) => { recorded[`on:${name}`] = fn; return () => {}; },
  slots: {
    inject: (name, cb) => { const d = cb(); return typeof d === 'function' ? d : () => {}; },
    register: (options, Component) => { registered.push({ name: options.name, options, Component }); return () => {}; },
    snapshot: () => slotTrees,
    onEntryError: (fn) => { recorded.onEntryError = fn; return () => {}; }
    // deliberately NO onMutate — the real SlotRegistry does not expose it.
  },
  remote: {
    pluginInventory: {
      list: async () => ({ ok: true, value: { entries: plugins, agentPresets } })
    }
  }
};

/* ---- run ---- */
new Function(src)(); // registers the factory via __ModuleLoader__.load
const factory = globalThis.__HM_FACTORY__.factory;
const exports = factory((spec) => (spec === 'react' ? React : {}));
console.log('[1] exports.name   =', exports.name);
console.log('[1] exports.inject =', JSON.stringify(exports.inject));
console.log('[1] typeof apply   =', typeof exports.apply);

exports.apply(ctx);
console.log('[2] registered slots:', registered.map((r) => `${r.name}#${r.options.id || r.options.name}`).join(', '));

await new Promise((r) => setTimeout(r, 60)); // let runScan() resolve

/* ---- inspect the settings report tree for alert rows ---- */
const settingsRow = registered.find((r) => r.name === 'settings.section');
const reportEl = settingsRow.Component({ t: (k) => k }); // returns h(ReportSection, {t})
const reportTree = reportEl.type(reportEl.props);        // invoke ReportSection

function collectAlerts(node, acc) {
  if (!node || typeof node !== 'object') return acc;
  if (node.props && node.props.alert && node.props.alert.title) acc.push(node.props.alert);
  const kids = node.children || (node.props && node.props.children);
  if (Array.isArray(kids)) kids.forEach((c) => collectAlerts(c, acc));
  return acc;
}
const alerts = collectAlerts(reportTree, []);
console.log('[3] alert count   =', alerts.length);
for (const a of alerts) console.log(`    [${a.severity}/${a.category}] ${a.title}`);

/* ---- assertions ---- */
let failed = 0;
const must = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); failed++; } else console.log('PASS:', msg); };
must(exports.name === '@local/dsh-checkup', 'name matches package');
must(Array.isArray(exports.inject) && exports.inject.includes('slots'), 'declares slots inject');
must(typeof exports.apply === 'function', 'apply is a function');
// The overlay banner was removed on purpose: a permanent occupant of the
// additive `shell.overlay` list (shared with the Chat quota notice) just to
// report "nothing is wrong" was not worth the real estate. Everything it
// showed lives in the settings section now.
must(!registered.some((r) => r.name === 'shell.overlay'),
  'does NOT register a shell.overlay banner (removed: report-only by design)');
must(registered.some((r) => r.name === 'settings.section'), 'registered settings.section report');
must(typeof recorded['on:slots/changed'] === 'function', "subscribes to the 'slots/changed' cordis event (not slots.onMutate)");
must(recorded.onMutate === undefined, 'never calls slots.onMutate (absent from the real SlotRegistry)');
// 9 = 2 slot-shadow (list + single) + 1 abdicated (chat.attachment)
//   + 1 patch-failure (plugin-e) + 2 metadata (plugin-e, plugin-g)
//   + 1 client-half-vanished (plugin-i)
//   + 1 preset patch-failure (preset-l) + 1 preset metadata (preset-m)
// NOT counted: plugin-d (composed but registers no slot — legal), plugin-h
// (host-only, absent from boot — legal), plugin-f (pending transient),
// preset-n (pending inside the preset — same transient rule),
// preset-o (host-only inside the preset — legal).
must(alerts.length === 9, `expected 9 alerts, got ${alerts.length}`);
must(alerts.some((a) => a.category === 'slots' && /tool\.view\.demo/.test(a.title)), 'detected list slot shadowing');
must(alerts.some((a) => a.category === 'slots' && /shell\.overlay/.test(a.title)), 'detected single slot shadowing');

/* ---- the two regression guards that matter -------------------------
 * Both encode the bug that produced "163 plugins silently failing":
 *
 *  R1  findInert must NOT flag a host-only plugin. The old predicate was
 *      `active && no registrant in the slots ledger`, which matches EVERY
 *      host-only plugin by construction, because dsh-client-modules only
 *      ever puts `dsh.client.platform === "web"` packages into the boot
 *      manifest and a host-only plugin registers no slot. plugin-h is
 *      exactly that case: enabled, active, no slot, absent from the manifest.
 *
 *  R2  findInert MUST flag a plugin whose browser half RAN and then vanished
 *      from the host's manifest. plugin-i owns a live slot registration
 *      (proof its client.js executed) yet is absent from
 *      `__DSH_BOOT__.entries` — the real, actionable defect.
 *
 * A separate guard pins that a plugin which is merely composed-but-slotless
 * (plugin-d) is not an alert either: registering no slot is legal.
 * ---------------------------------------------------------------- */
must(!alerts.some((a) => /plugin-h/.test(a.title)),
  'R1: a host-only plugin (no slot registration) is NOT reported as a silent failure');
must(alerts.some((a) => a.category === 'inert' && /plugin-i/.test(a.title)),
  'R2: a plugin that registered a slot but left the boot manifest IS reported (real silent failure)');
must(!alerts.some((a) => /plugin-d/.test(a.title)),
  'a composed plugin that registers no slot is not an alert (legal)');

/* ---- abdicate is a crash, not a shadow ----------------------------- */
must(alerts.some((a) => /chat\.attachment/.test(a.title) && a.severity === 'error'),
  'an inactive occupant with no live winner is reported as an abdicate crash (error)');
must(alerts.find((a) => /chat\.attachment/.test(a.title)).category === 'slots',
  'the abdicate alert is filed under the slots category');

must(alerts.some((a) => a.category === 'patch' && /plugin-e/.test(a.title)), 'detected patch-layer failure');
must(alerts.some((a) => a.severity === 'error' && /plugin-e/.test(a.title)), 'patch failure is error severity');
must(!alerts.some((a) => /plugin-f/.test(a.title)), 'transient pending phase does not alert (startup noise suppression)');
must(alerts.some((a) => a.category === 'metadata' && /plugin-g/.test(a.title)), 'display-metadata error reported in its own category');
must(alerts.find((a) => /plugin-g/.test(a.title)).severity === 'warn', 'metadata failure is warn, not error');

/* ---- the agent-preset subtree -------------------------------------
 * The biggest blind spot this plugin had: `pluginInventory.entries` only
 * walks the TOP-LEVEL Loader tree, while dsh-agent-preset-registry mounts
 * preset `config.plugins` into a separate PresetTree. Those rows arrive under
 * `agentPresets[]` and were previously ignored entirely.
 *
 * P1  a preset row that FAILED must be reported, and must say it came from
 *     the preset subtree (so the user knows it is not a top-level problem).
 * P2  a preset row with a metadata error must be reported, preset-tagged.
 * P3  a pending preset row must stay silent (same startup-transient rule).
 * P4  a host-only preset row must NOT be reported (same host-only rule).
 * P5  a preset row that activated and composed must appear in the healthy
 *     list, tagged with its preset.
 * P6  a preset row must NOT be double-reported when the same package also
 *     exists at top level.
 * ---------------------------------------------------------------- */
must(alerts.some((a) => a.category === 'patch' && /plugin-l/.test(a.title) && /agent preset/.test(a.title)),
  'P1: a preset row that failed activation IS reported, tagged with its preset');
must(alerts.find((a) => /plugin-l/.test(a.title)).severity === 'error',
  'P1: a preset patch failure is error severity');
must(alerts.find((a) => /plugin-l/.test(a.title)).who.includes('standard'),
  'P1: the preset alert names the preset it came from');
must(alerts.some((a) => a.category === 'metadata' && /plugin-m/.test(a.title) && /agent preset/.test(a.title)),
  'P2: a preset metadata error is reported, tagged with its preset');
must(!alerts.some((a) => /plugin-n/.test(a.title)),
  'P3: a pending preset row does not alert (startup-transient rule holds inside the preset)');
must(!alerts.some((a) => /plugin-o/.test(a.title)),
  'P4: a host-only preset row is not reported (host-only rule holds inside the preset)');

/* ---- the "running normally" list -------------------------------------
 * The positive counterpart to the alerts. It must list every plugin this
 * scan actually verified: enabled + active + present in the boot manifest.
 * Top level: a,b,c,d,g,j = 6. Preset: k = 1. Total 7.
 * NOT h (host-only, absent from the manifest), NOT i (alerted as inert),
 * NOT e (failed), NOT f (still pending), NOT l/m (preset alerts),
 * NOT n (pending), NOT o (host-only).
 * ---------------------------------------------------------------- */
const healthyNode = (function findHealthy(node) {
  if (!node || typeof node !== 'object') return null;
  if (typeof node.type === 'function' && node.type.name === 'HealthyView') return node;
  const kids = node.children || (node.props && node.props.children);
  if (Array.isArray(kids)) {
    for (const c of kids) { const hit = findHealthy(c); if (hit) return hit; }
  }
  return null;
})(reportTree);
must(healthyNode !== null, 'the report renders a HealthyView');
const healthyNames = (healthyNode.props.healthy || []).map((p) => p.moduleName).sort();
must(healthyNames.length === 7,
  `healthy list holds the 7 verified plugins (6 top-level + 1 preset) — got ${healthyNames.length}: ${healthyNames.join(', ')}`);
must(!healthyNames.includes('@local/plugin-h'),
  'healthy list excludes the host-only plugin (absent from the boot manifest)');
must(!healthyNames.includes('@local/plugin-i'),
  'healthy list excludes the plugin reported as inert');
must(!healthyNames.includes('@local/plugin-e'),
  'healthy list excludes the plugin whose activation failed');
must(!healthyNames.includes('@local/plugin-f'),
  'healthy list excludes the still-pending plugin (transient, not yet healthy)');
must(!healthyNames.includes('@local/plugin-l'),
  'P5: healthy list excludes the preset row that failed');
must(!healthyNames.includes('@local/plugin-n'),
  'P5: healthy list excludes the pending preset row');
must(!healthyNames.includes('@local/plugin-o'),
  'P5: healthy list excludes the host-only preset row');
const healthyPresetK = (healthyNode.props.healthy || []).find((p) => p.moduleName === '@local/plugin-k');
must(healthyPresetK !== undefined && healthyPresetK.preset === 'standard',
  'P5: a healthy preset row is tagged with its preset');
// Each healthy entry carries the slots it actually contributed to.
const healthyByName = new Map((healthyNode.props.healthy || []).map((p) => [p.moduleName, p]));
must(healthyByName.get('@local/plugin-a').slots.length === 3,
  `a healthy entry names the slots it registered — got ${healthyByName.get('@local/plugin-a').slots.length}`);
must(healthyByName.get('@local/plugin-d').slots.length === 0,
  'a healthy plugin with no registration is still healthy (host-side is legal)');
// Render it and confirm the collapsed label is a count, not a wall of names.
const healthyText = JSON.stringify(healthyNode.type({ healthy: healthyNode.props.healthy }));
must(healthyText.includes('运行正常（7）'), 'HealthyView shows a collapsed count label');
must(!healthyText.includes('@local/plugin-a'),
  'HealthyView is collapsed by default (does not dump every plugin name)');

/* ---- the stats line is informational, never an alert --------------- */
// StatsView receives the store's computed split as a prop; the mock useStore()
// returns the live store, so the value rendered in the tree is the real one.
const statsNode = (function findStats(node) {
  if (!node || typeof node !== 'object') return null;
  if (typeof node.type === 'function' && node.type.name === 'StatsView') return node;
  const kids = node.children || (node.props && node.props.children);
  if (Array.isArray(kids)) {
    for (const c of kids) { const hit = findStats(c); if (hit) return hit; }
  }
  return null;
})(reportTree);
must(statsNode !== null, 'the report renders a StatsView');
must(statsNode && statsNode.props.stats && statsNode.props.stats.manifestAvailable === true,
  'StatsView receives the computed manifest split');
// active rows: a,b,c,d,g,h,i,j = 8.  manifest hits: a,b,c,d,g,j = 6.
// host-only = h (no slot registration, legal) + i (registration present, but
// that is what the inert alert reports — the stats line just counts it).
must(statsNode && statsNode.props.stats.hostOnly === 2,
  `stats counts the two plugins without a browser half (h + i) — got ${statsNode && statsNode.props.stats.hostOnly}`);
must(statsNode && statsNode.props.stats.clientHalf === 6,
  `stats counts the six composed plugins — got ${statsNode && statsNode.props.stats.clientHalf}`);
must(statsNode && statsNode.props.stats.failed === 1,
  `stats counts the failed activation (plugin-e) — got ${statsNode && statsNode.props.stats.failed}`);
must(statsNode && statsNode.props.stats.presetRows === 5,
  `stats reports the 5 agent-preset rows it also examined — got ${statsNode && statsNode.props.stats.presetRows}`);
const statsText = statsNode ? JSON.stringify(statsNode.type({ stats: statsNode.props.stats, t: (k) => k })) : '';
must(statsText.includes('仅宿主侧') && statsText.includes('不注册任何界面槽位'),
  'the stats line explains that host-only plugins register no slot by design');
must(statsText.includes('agent preset 子树 5 行'),
  'the stats line discloses the preset-subtree coverage');

/* ---- stall tracker ----------------------------------------------------
 * A row stuck in `pending` / `loading` must stay silent (startup transient),
 * but it must not be INDISTINGUISHABLE from healthy either. The tracker turns
 * elapsed time into a visible, severity-free line.
 *
 * S1  a transient observed for the first scan is not stalled (no evidence yet);
 * S2  after STALE_MS (60s) it IS reported, with its elapsed seconds;
 * S3  the timer is keyed per row, so two stalled rows are reported separately;
 * S4  a row that leaves the transient phase drops its timer, and a later
 *     re-entry starts from zero rather than resuming the old elapsed time;
 * S5  preset rows are tracked independently of top-level rows;
 * S6  `failed` / `active` rows are never tracked;
 * S7  stalled rows are NOT alerts — no severity, no alert id.
 * -------------------------------------------------------------------- */
const stalledNode = (function find(node) {
  if (!node || typeof node !== 'object') return null;
  if (typeof node.type === 'function' && node.type.name === 'StalledView') return node;
  const kids = node.children || (node.props && node.props.children);
  if (Array.isArray(kids)) { for (const c of kids) { const hit = find(c); if (hit) return hit; } }
  return null;
})(reportTree);

// S1: plugin-f has been pending for one scan (~60ms), far under the threshold.
must(stalledNode !== null, 'the report renders a StalledView');
const stalledNow = (stalledNode && stalledNode.props.stalled) || [];
must(stalledNow.length === 0,
  `S1: a first-scan transient is not stalled — got ${JSON.stringify(stalledNow)}`);
must(!alerts.some((a) => /plugin-f/.test(a.title)),
  'S7: a transient row produces no alert (README §2 promise)');

// S2/S3/S4/S5/S6: drive the extracted pure helper directly, because the
// 60-second threshold cannot be reached inside a test.
const CLIENT_SRC = readFileSync(SRC, 'utf8');
// trackStalls calls stallKey and reads STALE_MS, so extract the whole block by
// line span rather than by regex (the block contains nested braces).
const STALL_BLOCK = (() => {
  const L = CLIENT_SRC.split('\n');
  const from = L.findIndex((l) => l.includes('const STALE_MS ='));
  const to = L.findIndex((l) => l.includes('function trackStalls('));
  if (from === -1 || to === -1 || to < from) throw new Error('stall block not found in client.js');
  // walk forward from trackStalls to its closing brace
  let depth = 0, end = to;
  for (let i = to; i < L.length; i++) {
    for (const ch of L[i]) { if (ch === '{') depth++; else if (ch === '}') { depth--; if (depth === 0) { end = i; break; } } }
    if (end === i && depth === 0) break;
  }
  return L.slice(from, end + 1).join('\n');
})();
const trackStalls = new Function(`${STALL_BLOCK}\nreturn trackStalls;`)();
const STALE_MS_SRC = Number(STALL_BLOCK.match(/const STALE_MS = (\d+);/)[1]);

const ROWS = [
  { moduleName: 'a', preset: null, enabled: true, fiberPhase: 'pending' },
  { moduleName: 'b', preset: null, enabled: true, fiberPhase: 'loading' },
  { moduleName: 'c', preset: null, enabled: true, fiberPhase: 'pending' },
  { moduleName: 'p', preset: 'standard', enabled: true, fiberPhase: 'loading' },
  { moduleName: 'x', preset: null, enabled: true, fiberPhase: 'failed' },
  { moduleName: 'y', preset: null, enabled: true, fiberPhase: 'active' }
];
const T0 = 1_700_000_000_000;

// First observation: seeds timers, reports nothing.
must(trackStalls(ROWS, T0).length === 0, 'S1: first observation seeds timers and reports nothing');

// Just under the threshold: still silent.
must(trackStalls(ROWS, T0 + Number(STALE_MS_SRC) - 1).length === 0,
  'S2: a transient just under the threshold is still silent');

// Past the threshold: a, b, c and the preset row p are all reported; x and y never.
const after = trackStalls(ROWS, T0 + Number(STALE_MS_SRC) + 5000);
const afterNames = after.map((s) => `${s.preset || ''}/${s.moduleName}`).sort();
must(after.length === 4, `S2/S3: every long-lived transient is reported separately — got ${JSON.stringify(afterNames)}`);
must(afterNames.includes('/a') && afterNames.includes('/b') && afterNames.includes('/c'),
  'S3: distinct rows get distinct stalled entries');
must(afterNames.includes('standard/p'),
  'S5: preset rows are tracked independently and carry their preset');
must(!afterNames.includes('/x') && !afterNames.includes('/y'),
  'S6: failed and active rows are never tracked as stalled');
must(after.every((s) => typeof s.seconds === 'number' && s.seconds > 0),
  'S2: each stalled row carries its elapsed seconds');

// S4: a row that leaves the transient phase has its timer dropped. `x` is
// `failed` here, so its key must be gone — while a/b/c/p are still transient
// and (having passed the threshold) still report. That is 4, not 3.
const CLEARED = [ROWS[0], ROWS[1], ROWS[2], ROWS[3], ROWS[5]]; // x dropped
const clearedOut = trackStalls(CLEARED, T0 + Number(STALE_MS_SRC) * 3);
must(clearedOut.length === 4,
  `S4: rows still in a transient phase keep reporting — got ${clearedOut.length}`);
must(!clearedOut.some((s) => s.moduleName === 'x'),
  'S4: a row that left the transient phase (x -> failed) is no longer stalled');

// Re-enter: `a` flips from pending to loading. Its old timer must NOT survive
// that, so it must not report at the same instant it re-enters.
const REENTER = [
  { moduleName: 'a', preset: null, enabled: true, fiberPhase: 'loading' },
  ROWS[1], ROWS[2], ROWS[3], ROWS[5]
];
const reOut = trackStalls(REENTER, T0 + Number(STALE_MS_SRC) * 3);
must(!reOut.some((s) => s.moduleName === 'a'),
  'S4: a re-entered transient starts from zero (no stale elapsed time)');
must(reOut.length === 3,
  `S4: the other three transients keep their timers — got ${reOut.length}`);

/* ---- localization of the category label -------------------------------
 * Regression guard: AlertRow used to print the raw category id
 * (`分类：metadata`), which is not user-facing copy. The locale dict keys are
 * namespaced `cat.*` and the component must translate them.
 * -------------------------------------------------------------------- */
const boundT = (key) => (key.startsWith('cat.') ? `<${key}>` : key);
const alertEl = alerts.length > 0
  ? (function findAlertNode(node, acc) {
      if (!node || typeof node !== 'object') return acc;
      if (node.props && node.props.alert && node.props.alert.title) acc.push(node);
      const kids = node.children || (node.props && node.props.children);
      if (Array.isArray(kids)) kids.forEach((c) => findAlertNode(c, acc));
      return acc;
    })(reportTree, [])[0]
  : null;
const alertRowText = alertEl
  ? JSON.stringify(alertEl.props.alert.category)
  : '';
must(alertRowText.length > 0, 'an AlertRow node exists to localize');
// render one AlertRow through the same React stub and confirm the label is translated
const alertNode = alertEl.type({ alert: alertEl.props.alert, compact: true, t: boundT });
const alertText = JSON.stringify(alertNode);
must(alertText.includes(`分类：<cat.${alertEl.props.alert.category}>`),
  `AlertRow localizes the category label (got raw id?) — ${alertText.slice(0, 120)}`);

/* ---- the missing-manifest safety net ---------------------------------
 * The bug that produced "163 plugins silently failing" was a detector that
 * kept guessing when it had no evidence. If the host never published a boot
 * manifest (embedder, CLI, a pre-boot render), the correct behaviour is
 * ZERO inert alerts — not one per enabled plugin.
 *
 * This removes the manifest, runs one more scan through the same ctx, and
 * asserts the inert detector stays empty while the others keep working.
 * -------------------------------------------------------------------- */
delete globalThis.__DSH_BOOT__;
// The resident poll is 4s; drive one explicit rescan through the report's own
// button so the store reflects the manifest-less world immediately.
const rescanButton = (function findRescan(node) {
  if (!node || typeof node !== 'object') return null;
  if (node.props && node.props.onClick && node.props.className === 'dsh-hm-btn') return node;
  const kids = node.children || (node.props && node.props.children);
  if (Array.isArray(kids)) {
    for (const c of kids) { const hit = findRescan(c); if (hit) return hit; }
  }
  return null;
})(reportTree);
must(rescanButton !== null, 'the report exposes a rescan button');
if (rescanButton) rescanButton.props.onClick();
await new Promise((r) => setTimeout(r, 60)); // let runScan() resolve again
const noManifestRow = registered.find((r) => r.name === 'settings.section');
const noManifestReport = noManifestRow.Component({ t: (k) => k }).type({ t: (k) => k });
const noManifestAlerts = collectAlerts(noManifestReport, []);
must(!noManifestAlerts.some((a) => a.category === 'inert'),
  'safety net: with no boot manifest, the inert detector emits ZERO alerts (no per-plugin guessing)');
must(noManifestAlerts.some((a) => a.category === 'patch' && /plugin-e/.test(a.title)),
  'safety net: the other detectors still work without a boot manifest');
// The stats line must degrade quietly rather than claim a bogus split.
const noManifestStats = (function findStats(node) {
  if (!node || typeof node !== 'object') return null;
  if (typeof node.type === 'function' && node.type.name === 'StatsView') return node;
  const kids = node.children || (node.props && node.props.children);
  if (Array.isArray(kids)) {
    for (const c of kids) { const hit = findStats(c); if (hit) return hit; }
  }
  return null;
})(noManifestReport);
must(noManifestStats === null || noManifestStats.props.stats.manifestAvailable !== true,
  'safety net: StatsView is not rendered when the manifest is unavailable');

console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
