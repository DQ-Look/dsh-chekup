/**
 * `dsh-checkup` — client (renderer) half.
 *
 * Hand-written classic script (no ESM/JSX/TS), classic-script transport.
 * Registers one lazy CJS factory whose `id` equals the package name.
 *
 * What it does (resident runtime health layer for DSH plugins):
 *   1. Slots-ledger monitor — walks `ctx.slots.snapshot()` and flags any
 *      occupant whose `active` flag is false. That means one of two things:
 *        (a) a live winner took the same cell  -> silent override / shadowing
 *        (b) no live winner at all             -> the entry was ABDICATED by
 *            its own render crash (error severity, the slot renders nothing)
 *   2. Patch-layer monitor — polls `ctx.remote.pluginInventory.list()` and
 *      flags enabled plugins whose `fiberPhase` is failed, or that carry a
 *      `meta.error` (display metadata only, so reported separately at warn).
 *   3. Capability drift — flags a plugin whose browser half RAN (it owns a
 *      slot registration) but whose row is gone from the boot manifest the
 *      host composed. Host-only plugins are excluded by construction, because
 *      they never appear in the manifest and never register a slot.
 *   4. Live entry crashes — subscribes to `ctx.slots.onEntryError`.
 *
 * It also reports the POSITIVE side: a collapsed "running normally" list of
 * every plugin this scan verified (enabled + active + present in the browser
 * boot graph), so an empty alert list reads as "all good" rather than "broken".
 *
 * Surface: ONE settings section (`settings.section`). There is deliberately
 * no resident banner in `shell.overlay` — a permanent overlay occupant to
 * report "nothing is wrong" is not worth the real estate it takes from the
 * Chat quota notice it shares the additive list slot with.
 *
 * Surfaces:
 *   - `shell.overlay` banner: compact severity tally, click opens the report.
 *   - `settings.section` report: per-alert "who collided + which line to fix"
 *     guidance, plus runtime-snapshot export and pre/post-update diff.
 *
 * This is the client-only build: host-side tool-registry override (ctx.tools)
 * is not visible from the renderer and is left as a documented extension point
 * (see index.js).
 */
window.__ModuleLoader__.load({
  id: 'dsh-checkup',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /* ---------------------------------------------------------------- CSS */
    const CSS = [
      '.dsh-hm-banner{position:fixed;top:10px;right:14px;z-index:2147483000;',
      'display:flex;flex-direction:column;border-radius:10px;',
      'background:var(--dsw-alias-bg-layer-1,#1b1b1d);color:var(--dsw-alias-label-primary,#e8e8ea);',
      'border:.5px solid var(--dsw-alias-border-l2,#3a3a3d);font-size:12px;box-shadow:0 4px 18px rgba(0,0,0,.35)}',
      '.dsh-hm-banner-bar{display:flex;align-items:center;gap:8px;padding:7px 12px;border-radius:10px;cursor:pointer}',
      '.dsh-hm-caret{color:var(--dsw-alias-label-tertiary,#9a9aa0);font-size:10px}',
      '.dsh-hm-banner-list{display:flex;flex-direction:column;gap:8px;max-height:60vh;overflow-y:auto;',
      'padding:0 10px 10px;border-top:.5px solid var(--dsw-alias-border-l3,#2c2c2f)}',
      '.dsh-hm-row-compact{padding:8px 10px;font-size:12px}',
      '.dsh-hm-dot{width:8px;height:8px;border-radius:50%}',
      '.dsh-hm-sec{display:flex;flex-direction:column;gap:14px;color:var(--dsw-alias-label-primary,#e8e8ea);font-size:13px;line-height:20px}',
      '.dsh-hm-row{border:.5px solid var(--dsw-alias-border-l3,#2c2c2f);border-radius:10px;padding:12px 14px;background:var(--dsw-alias-bg-layer-2,#161618)}',
      '.dsh-hm-row.error{border-color:var(--dsw-alias-state-error-secondary,#7a2b2b)}',
      '.dsh-hm-row.warn{border-color:var(--dsw-alias-state-warning-secondary,#7a5a2b)}',
      '.dsh-hm-row.info{border-color:var(--dsw-alias-border-l4,#262629)}',
      '.dsh-hm-title{font-weight:600;margin:0 0 6px;display:flex;align-items:center;gap:8px}',
      '.dsh-hm-meta{color:var(--dsw-alias-label-tertiary,#9a9aa0);font-size:12px;margin:2px 0}',
      '.dsh-hm-stalled{display:flex;flex-direction:column;gap:4px}',
      '.dsh-hm-stalled-dot{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-label-quaternary,#6c6c72);flex:none}',
      '.dsh-hm-stalled-age{color:var(--dsw-alias-label-quaternary,#6c6c72);font-size:12px;font-variant-numeric:tabular-nums}',
      '.dsh-hm-fix{margin:8px 0 0;padding:10px 12px;border-radius:8px;background:var(--dsw-alias-bg-layer-1,#1b1b1d);white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:var(--dsw-alias-label-secondary,#c8c8cd)}',
      '.dsh-hm-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}',
      '.dsh-hm-btn{border:.5px solid var(--dsw-alias-border-l3,#2c2c2f);border-radius:8px;background:var(--dsw-alias-bg-layer-1,#1b1b1d);',
      'color:var(--dsw-alias-label-primary,#e8e8ea);font:inherit;font-size:12px;padding:5px 12px;cursor:pointer}',
      '.dsh-hm-btn:hover{border-color:var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#3b82f6))}',
      '.dsh-hm-empty{color:var(--dsw-alias-label-tertiary,#9a9aa0);padding:18px;text-align:center}',
      '.dsh-hm-healthy{margin-top:10px}',
      '.dsh-hm-healthy-list{list-style:none;margin:8px 0 0;padding:0;max-height:280px;overflow:auto}',
      '.dsh-hm-healthy-item{display:flex;align-items:baseline;gap:8px;padding:4px 0;font-size:12px}',
      '.dsh-hm-ok-dot{width:8px;height:8px;border-radius:50%;flex:none;align-self:center;',
      'background:var(--dsw-alias-state-success-primary,#3fb950)}',
      '.dsh-hm-healthy-name{color:var(--dsw-alias-label-primary,#e8e8ea);word-break:break-all}',
      '.dsh-hm-healthy-slots{color:var(--dsw-alias-label-tertiary,#9a9aa0)}',
      '.dsh-hm-diff{margin-top:10px;border-top:.5px dashed var(--dsw-alias-border-l3,#2c2c2f);padding-top:10px}',
      '.dsh-hm-diffadd{color:var(--dsw-alias-state-success-primary,#3fb950)}',
      '.dsh-hm-diffdel{color:var(--dsw-alias-state-error-primary,#f85149)}'
    ].join('');
    if (typeof document !== 'undefined' &&
        document.querySelector('style[data-plugin-css="dsh-hm/health"]') === null) {
      const tag = document.createElement('style');
      tag.setAttribute('data-plugin', 'dsh-checkup');
      tag.setAttribute('data-plugin-css', 'dsh-hm/health');
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    /* ----------------------------------------------------------- locale */
    const NS = 'healthMonitor';
    const zh = {
      nav: '插件体检',
      title: '插件体检与告警',
      banner: '插件体检',
      empty: '未检测到运行期健康问题。下方"运行正常"列出了本次扫描确认正常的插件。',
      rescan: '重新扫描',
      export: '导出运行期快照',
      import: '导入上一快照做 diff',
      diffTitle: '与导入快照的差异',
      sevError: '错误',
      sevWarn: '警告',
      sevInfo: '提示',
      who: '谁和谁撞了',
      fix: '改哪一行',
      'cat.slots': '槽位注册',
      'cat.patch': 'patch 层',
      'cat.inert': '客户端半体缺失',
      'cat.metadata': '展示元数据',
      'cat.crash': '组件崩溃'
    };
    const en = {
      nav: 'Plugin Health',
      title: 'Plugin Health Monitor',
      banner: 'Plugin Health',
      empty: 'No runtime health problems detected. See "Running normally" below for the plugins this scan verified.',
      rescan: 'Rescan',
      export: 'Export runtime snapshot',
      import: 'Import previous snapshot for diff',
      diffTitle: 'Diff vs imported snapshot',
      sevError: 'Error',
      sevWarn: 'Warning',
      sevInfo: 'Info',
      who: 'Who collided',
      fix: 'Which line to fix',
      'cat.slots': 'Slot registration',
      'cat.patch': 'Patch layer',
      'cat.inert': 'Missing client half',
      'cat.metadata': 'Display metadata',
      'cat.crash': 'Component crash'
    };

    /* ------------------------------------------------------------ store */
    const store = {
      version: 0,
      plugins: [],
      // Agent-preset subtree rows (see readPresetRows). Same shape as a
      // top-level plugin row plus `preset`. These are NOT in `plugins`.
      presetRows: [],
      slotSnapshot: [],
      alerts: [],
      // Plugins that are enabled + activated + (when the manifest is
      // available) present in the browser boot graph. Shown as a positive
      // list, never as alerts.
      healthy: [],
      // Not alerts — an informational split of the Loader's plugin rows, shown
      // in the report so the "why isn't X listed?" question has an answer
      // without generating a warning per host-only plugin.
      stats: null,
      // Rows still sitting in a transient phase (pending / loading) that have
      // been there longer than STALE_MS. Keyed internally by
      // `preset\0moduleName\0phase` — the phase is part of the key so a
      // pending -> loading flip restarts the timer. This is the one place a
      // transient is surfaced, and only as elapsed-time information — never as
      // a severity-colored alert.
      stalled: [],
      lastRun: null,
      diff: null,
      t: null,
      listeners: new Set(),
      ctx: null,
      subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
      notify() { this.version++; this.listeners.forEach((fn) => fn()); },
      set(patch) { Object.assign(this, patch); this.notify(); }
    };

    /* ----------------------------------------------------- stall tracker */
    // How long a transient phase may persist before it stops being plausible
    // startup noise and becomes worth mentioning.
    //
    // `pending` and `loading` are deliberately NOT alerts (README §2): the
    // first scan of a 4-second poll almost always catches a wall of them, and
    // reporting them would re-create the noise problem this plugin exists to
    // avoid. But "deliberately silent" is not the same as "indistinguishable
    // from healthy" — a row stuck in `loading` for two minutes looks exactly
    // like one that started three seconds ago, and that is the gap this closes.
    //
    // What this does NOT do: it never promotes a transient to an alert. A
    // stalled row is reported as elapsed-time information with no severity
    // colouring, because from the renderer there is still no way to tell a
    // slow dependency chain from a genuinely stuck one. The threshold is only
    // a "look at this" cue.
    //
    // The timestamp map survives across scans, so the elapsed time is real
    // wall-clock time, not "how many polls happened".
    const STALE_MS = 60000;
    // (preset, moduleName, phase) -> first time (ms) that combination was seen.
    // The phase is part of the key on purpose: a row that flips pending ->
    // loading is a NEW observation, not a continuation, so its timer must
    // restart. Keying on the row alone would make that flip inherit the old
    // elapsed time and report a stall that never happened.
    const phaseSince = new Map();
    function stallKey(row) {
      return `${row.preset || ''}\u0000${row.moduleName}\u0000${row.fiberPhase}`;
    }
    /**
     * Update the elapsed-time tracker and return the rows now considered stalled.
     * @param rows - top-level rows plus preset rows.
     * @param now - current time in ms.
     * @returns stalled rows with their observed phase and elapsed seconds.
     */
    function trackStalls(rows, now) {
      const seen = new Set();
      const stalled = [];
      for (const r of rows) {
        // A disabled or failed row is already reported (or legally idle);
        // the transient phases are the only ones this tracker is about.
        if (r.fiberPhase !== 'pending' && r.fiberPhase !== 'loading') continue;
        const key = stallKey(r);
        seen.add(key);
        const first = phaseSince.get(key);
        if (first === void 0) {
          phaseSince.set(key, now);
          continue;
        }
        const elapsed = now - first;
        if (elapsed >= STALE_MS) {
          stalled.push({
            moduleName: r.moduleName,
            preset: r.preset || null,
            phase: r.fiberPhase,
            seconds: Math.round(elapsed / 1000)
          });
        }
      }
      // Drop keys whose row left the transient phase: back to normal means the
      // timer is meaningless, and keeping it would make a later re-entry
      // report a stale elapsed time.
      for (const key of [...phaseSince.keys()]) if (!seen.has(key)) phaseSince.delete(key);
      return stalled;
    }

    /* ----------------------------------------------------- React hook */
    function useStore() {
      const [, force] = React.useState(0);
      React.useEffect(() => store.subscribe(() => force((n) => n + 1)), []);
      return store;
    }

    /* ----------------------------------------------------- detection */
    // cell key for shadowing resolution (single: undefined, keyed: key, list: id)
    function cellKey(kind, occ) {
      if (kind === 'keyed') return occ.key;
      if (kind === 'list') return occ.id;
      return '__single__';
    }

    // 1. Silent slot shadowing: an occupant with active===false lost its cell.
    //
    // A cell's winner is the FIRST live (non-abdicated) entry in priority order
    // (dsh-client-ui-slots entriesOfSlot). So inactive means exactly one of:
    //   (a) a live winner exists  -> silent override (the classic shadowing)
    //   (b) no winner exists     -> the entry was ABDICATED (its render threw
    //                               and the boundary retired it), which is a
    //                               crash, reported here too since the effect
    //                               is identical: the slot renders nothing.
    function findShadowed(slotTrees) {
      const out = [];
      const walk = (node) => {
        if (node.type === 'slot' && node.kind !== 'chain') {
          const activeByCell = new Map();
          for (const o of node.occupants) if (o.active) activeByCell.set(cellKey(node.kind, o), o);
          for (const o of node.occupants) {
            if (o.active) continue;
            out.push({
              slot: node.name,
              kind: node.kind,
              winner: activeByCell.get(cellKey(node.kind, o)) || null,
              loser: o,
              // (b) is the abdicate case: nothing live in this cell at all.
              abdicated: !activeByCell.has(cellKey(node.kind, o))
            });
          }
        }
        if (node.children) node.children.forEach(walk);
      };
      slotTrees.forEach(walk);
      return out;
    }

    // 2. Patch-layer non-effectiveness from inventory.
    // NOTE: `meta.error` is DISPLAY-METADATA resolution failure (title /
    // description / icon could not be read) — it is not a patch activation
    // failure, so it is reported separately at warn severity.
    // `preset` is carried through when the row came from an agent-preset
    // subtree (see readPresetRows), so the alert can say where to look.
    function findPatchFailures(plugins) {
      return plugins
        .filter((p) => p.enabled && p.fiberPhase === 'failed')
        .map((p) => ({
          moduleName: p.moduleName,
          fiberPhase: p.fiberPhase,
          preset: p.preset || null,
          error: p.meta && p.meta.error ? p.meta.error : null
        }));
    }

    function findMetadataErrors(plugins) {
      return plugins
        .filter((p) => p.enabled && (p.meta && p.meta.error))
        .map((p) => ({
          moduleName: p.moduleName,
          preset: p.preset || null,
          error: p.meta.error
        }));
    }

    // 3. Capability drift, CORRECTED.
    //
    // The old predicate was: enabled && fiberPhase==='active' && no registrant
    // in the slots ledger. That reported EVERY host-only plugin, because the
    // renderer can only ever see packages that declare
    // `dsh.client.platform === "web"` (dsh-client-modules rejects all others
    // when composing window.__DSH_BOOT__). Host-only plugins — tools, skills,
    // storage, sandbox — register no slot by design, so the old rule emitted
    // one false "silent failure" per host plugin: over 100 on a stock profile,
    // which is exactly the "163 plugins silently failing" report.
    //
    // The correct question is narrower and answerable from the renderer:
    //
    //   "This plugin DID contribute a browser half once (it owns a slot
    //    registration in the ledger) but its row is gone from the boot
    //    manifest the host composed."
    //
    // That is the set difference between
    //   composed = ids in window.__DSH_BOOT__.entries   (what the host scanned)
    //   observed = registrants in ctx.slots.snapshot()  (what actually ran)
    // restricted to plugins the host still reports as enabled+active.
    //
    // A row in `observed` but not in `composed` means the browser half loaded
    // and registered, yet the host no longer serves it in the manifest — a
    // stale graph, a revoked `dsh.client` declaration, or a row the activation
    // scan dropped. That is a real, actionable defect.
    //
    // Why this cannot be "every plugin that promised a browser half":
    // `pluginInventory` carries only display metadata (title/description/icon
    // via pluginPackages.metaOf) and deliberately NOT the `dsh.client`
    // declaration, so from the renderer there is NO way to tell an enabled
    // host-only plugin from one whose client half failed to compose. Using the
    // raw difference would re-introduce the 100+ false positives. The slots
    // ledger is the only renderer-visible proof that a browser half existed.
    //
    // Why `fiberPhase === 'active'` is required, not merely `enabled`:
    // dsh-client-modules' activation scan seeds itself from the CURRENT Loader
    // entries and flushes synchronously, so a still-pending row has simply not
    // been scanned yet — it will appear in the manifest a moment later.
    // Reporting it now is the same startup-noise mistake the `pending`
    // suppression already avoids elsewhere in this plugin.
    //
    // `window.__DSH_BOOT__` is the same object the host injects as a script
    // global (dsh-client-modules bootInjections), so it is readable without any
    // service injection.
    function bootEntryIds() {
      try {
        const boot = typeof window !== 'undefined' ? window.__DSH_BOOT__ : null;
        if (boot && Array.isArray(boot.entries)) {
          return new Set(boot.entries.map((e) => e && e.id).filter(Boolean));
        }
      } catch (_) { /* boot global absent or malformed */ }
      return null;
    }

    /** Every registrant the live slots ledger knows about. */
    function slotRegistrants(slotTrees) {
      const out = new Set();
      const walk = (node) => {
        if (node.occupants) node.occupants.forEach((o) => { if (o.registrant) out.add(o.registrant); });
        if (node.children) node.children.forEach(walk);
      };
      slotTrees.forEach(walk);
      return out;
    }

    function findInert(plugins, slotTrees) {
      const composed = bootEntryIds();
      if (composed === null) return []; // no boot manifest: cannot judge
      const observed = slotRegistrants(slotTrees);
      return plugins
        .filter((p) =>
          p.enabled &&
          p.fiberPhase === 'active' &&
          observed.has(p.moduleName) &&   // it DID have a browser half
          !composed.has(p.moduleName))    // ... which the host no longer composes
        .map((p) => ({ moduleName: p.moduleName, preset: p.preset || null }));
    }

    function fmtWho(reg) {
      if (reg && reg.registrant) return reg.registrant;
      return '(未在 register 中标注 registrant)';
    }
    function fmtCoord(kind, occ) {
      if (kind === 'single' || kind === 'keyed') return `priority=${occ.priority ?? 0}`;
      return `id=${occ.id ?? '?'}, order=${occ.order ?? '?'}, priority=${occ.priority ?? 0}`;
    }

    // Build the alert list (pure over the inputs).
    //
    // `presetRows` is the agent-preset subtree. Patch-failure, metadata and
    // inert detection all apply to it, because a preset row is a real Loader
    // entry in its own tree — it activates, it can fail, and its browser half
    // is composed from the same manifest. Slot shadowing does NOT: the slots
    // ledger only reflects the top-level tree's registrations, so a preset
    // row's registrant would be a false signal.
    function buildAlerts(plugins, slotTrees, presetRows = []) {
      const alerts = [];
      // Rows already covered at top level must not be reported twice.
      const topNames = new Set(plugins.map((p) => p.moduleName));
      const presetOnly = presetRows.filter((r) => !topNames.has(r.moduleName));

      for (const s of findShadowed(slotTrees)) {
        const kind = s.kind === 'list' ? 'list' : s.kind === 'keyed' ? 'keyed' : 'single';
        const loserCoord = fmtCoord(kind, s.loser);
        let fixLine;
        if (s.abdicated) {
          // No live winner: the entry was retired by its own render crash.
          fixLine =
            `在 ${fmtWho(s.loser)} 的 client.js 中定位该槽位组件并修复其抛错。\n` +
            `该条目已被渲染边界 abdicate 退出单元——槽位当前没有任何可见注册者。`;
          alerts.push({
            id: `abdicated:${s.slot}:${fmtWho(s.loser)}`,
            severity: 'error',
            category: 'slots',
            title: `槽位 ${s.slot} 的注册已被 abdicate 退出（组件渲染崩溃）`,
            who: `${fmtWho(s.loser)}（${loserCoord}）的 render 抛错被边界捕获并退出该单元；该槽位当前无存活注册者。`,
            fix: fixLine
          });
          continue;
        }
        const winnerCoord = fmtCoord(kind, s.winner);
        if (kind === 'list') {
          fixLine =
            `在 ${fmtWho(s.loser)} 的 client.js 中，将\n` +
            `  ctx.slots.register({ name: '${s.slot}', id: '${s.loser.id}', order: ${s.loser.order ?? '?'} , … })\n` +
            `改为一个全局唯一的 id，或降低其 priority 以胜出（priority 越低越先渲染；当前被 ${fmtWho(s.winner)} 的同 id 项覆盖）。`;
        } else if (kind === 'keyed') {
          fixLine =
            `在 ${fmtWho(s.loser)} 的 client.js 中，将\n` +
            `  ctx.slots.register({ name: '${s.slot}', key: '${s.loser.key}', priority: ${s.loser.priority ?? 0} , … })\n` +
            `降低 priority（需低于 ${s.winner.priority ?? 0}），或改用不同的 key。`;
        } else {
          fixLine =
            `在 ${fmtWho(s.loser)} 的 client.js 中，将\n` +
            `  ctx.slots.register({ name: '${s.slot}', priority: ${s.loser.priority ?? 0} , … })\n` +
            `降低 priority（需低于 ${s.winner.priority ?? 0}），让本插件胜出该 single 槽位。`;
        }
        alerts.push({
          id: `shadow:${s.slot}:${fmtWho(s.loser)}`,
          severity: 'warn',
          category: 'slots',
          title: `槽位 ${s.slot} 的注册被静默覆盖`,
          who: `胜出方：${fmtWho(s.winner)}（${winnerCoord}）\n被覆盖方：${fmtWho(s.loser)}（${loserCoord}）`,
          fix: fixLine
        });
      }

      for (const f of findPatchFailures(plugins.concat(presetOnly))) {
        const scope = f.preset ? `（agent preset：${f.preset}）` : '';
        alerts.push({
          id: f.preset ? `patch:${f.preset}:${f.moduleName}` : `patch:${f.moduleName}`,
          severity: 'error',
          category: 'patch',
          title: `插件 ${f.moduleName} 的 patch 层未生效（fiberPhase=failed）${scope}`,
          who: (f.error ? `激活报错：${f.error}` : `cordis.patch.yml 声明的 insert 行未成功激活（可能与同名/同 id 的另一加载源冲突，或依赖未就绪）。`) + (scope ? `\n该行来自 agent preset「${f.preset}」的子树，不是顶层 Loader。` : ''),
          fix: (
            `1) 检查 cordis.patch.yml 的 insert.id / insert.name 是否与 package.json 的 name 完全一致；\n` +
            `2) 若提示找不到 ./client，先 ` + '`pnpm run build`' + ` 再启动；\n` +
            `3) 若存在同名加载源，移除重复启用。` +
            (scope ? `\n4) 该行只在 preset「${f.preset}」生效时才被装载——确认当前会话挂的是这个 preset。` : ''))
        });
      }

      // Display-metadata failures are a packaging problem, not an activation one.
      for (const m of findMetadataErrors(plugins.concat(presetOnly))) {
        const scope = m.preset ? `（agent preset：${m.preset}）` : '';
        alerts.push({
          id: m.preset ? `metadata:${m.preset}:${m.moduleName}` : `metadata:${m.moduleName}`,
          severity: 'warn',
          category: 'metadata',
          title: `插件 ${m.moduleName} 的展示元数据无法解析${scope}`,
          who: `meta.error：${m.error}` + (scope ? `\n该行来自 agent preset「${m.preset}」的子树。` : ''),
          fix:
            `这不影响插件激活与运行，只影响插件管理器里的标题/描述/图标。\n` +
            `检查 ${m.moduleName} 的 package.json：\n` +
            `1) "meta": { "title", "description" } 是否为合法 JSON 字符串；\n` +
            `2) locale/en.json、locale/zh.json 是否存在且字段齐全；\n` +
            `3) "icon" 指向的 SVG/PNG/JPEG/WebP 是否 ≤256KiB 且在包目录内。`
        });
      }

      // Capability drift: a browser half that ran and then vanished from the
      // host's manifest. The intersection with the slots ledger is what keeps
      // this from re-introducing the host-only false positives — see the long
      // note on findInert above.
      //
      // Preset rows are included: a preset row's browser half is composed from
      // the same manifest, so "ran then vanished" means the same thing there.
      for (const i of findInert(plugins.concat(presetOnly), slotTrees)) {
        const scope = i.preset ? `（agent preset：${i.preset}）` : '';
        alerts.push({
          id: i.preset ? `inert:${i.preset}:${i.moduleName}` : `inert:${i.moduleName}`,
          severity: 'warn',
          category: 'inert',
          title: `插件 ${i.moduleName} 的浏览器半体已从启动清单中消失${scope}`,
          who: `该插件在 slots 账本中留有注册（说明其 client.js 确实运行过），但当前 window.__DSH_BOOT__.entries 里已没有它的行——宿主不再向浏览器提供它。` + (scope ? `\n该行来自 agent preset「${i.preset}」的子树。` : ''),
          fix:
            `核对 ${i.moduleName} 的 package.json：\n` +
            `1) "dsh": { "client": { "platform": "web" } } 是否仍声明；\n` +
            `2) "exports"["./client"] 是否指向真实存在的文件；\n` +
            `3) 若刚改过源码，先 ` + '`pnpm run build`' + ` 再重启宿主；\n` +
            `4) 若为软链安装，确认软链目标与 profile 的 node_modules 一致。` +
            (scope ? `\n5) 确认当前会话挂的 preset 仍是「${i.preset}」——换 preset 会改变装载集合。` : '')
        });
      }

      return alerts;
    }

    /* ----------------------------------------------------- snapshot IO */
    function buildSnapshot() {
      return {
        capturedAt: new Date().toISOString(),
        source: 'dsh-checkup',
        dshVersion: (typeof window !== 'undefined' && window.__DSH_BOOT__ && window.__DSH_BOOT__.rev) || null,
        stats: store.stats,
        healthy: store.healthy,
        // The agent-preset subtree is reported separately from `plugins`
        // because it is a different Loader tree, not a subset of the top level.
        presetRows: store.presetRows.map((r) => ({
          preset: r.preset,
          moduleName: r.moduleName,
          enabled: r.enabled,
          fiberPhase: r.fiberPhase,
          error: r.meta && r.meta.error ? r.meta.error : null
        })),
        plugins: store.plugins.map((p) => ({
          moduleName: p.moduleName, enabled: p.enabled, fiberPhase: p.fiberPhase,
          error: p.meta && p.meta.error ? p.meta.error : null
        })),
        slots: store.slotSnapshot,
        alerts: store.alerts.map((a) => ({ id: a.id, severity: a.severity, category: a.category, title: a.title }))
      };
    }

    function exportSnapshot() {
      const data = JSON.stringify(buildSnapshot(), null, 2);
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dsh-health-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    // Diff two snapshots → what became worse / better.
    function diffSnapshots(prev, next) {
      const added = [];
      const removed = [];
      const prevIds = new Set((prev.alerts || []).map((a) => a.id));
      const nextIds = new Set((next.alerts || []).map((a) => a.id));
      for (const a of (next.alerts || [])) if (!prevIds.has(a.id)) added.push(a);
      for (const a of (prev.alerts || [])) if (!nextIds.has(a.id)) removed.push(a);

      const prevPh = new Map((prev.plugins || []).map((p) => [p.moduleName, p.fiberPhase]));
      const phaseChanges = [];
      for (const p of (next.plugins || [])) {
        const before = prevPh.get(p.moduleName);
        if (before && before !== p.fiberPhase) {
          phaseChanges.push({ moduleName: p.moduleName, before, after: p.fiberPhase });
        }
      }
      // Preset rows are keyed by preset+moduleName: the same package can sit
      // in two presets with different phases, so a bare moduleName would
      // collide.
      const prevPreset = new Map(
        (prev.presetRows || []).map((r) => [`${r.preset}\u0000${r.moduleName}`, r.fiberPhase]));
      for (const r of (next.presetRows || [])) {
        const key = `${r.preset}\u0000${r.moduleName}`;
        const before = prevPreset.get(key);
        if (before && before !== r.fiberPhase) {
          phaseChanges.push({
            moduleName: `${r.moduleName}（preset：${r.preset}）`,
            before, after: r.fiberPhase
          });
        }
      }
      return { added, removed, phaseChanges };
    }

    function importSnapshot(file, t) {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const prev = JSON.parse(String(reader.result));
          const next = buildSnapshot();
          store.set({ diff: diffSnapshots(prev, next) });
        } catch (e) {
          store.set({ diff: { error: String(e && e.message || e) } });
        }
      };
      reader.readAsText(file);
    }

    /* ----------------------------------------------------- scanner */
    let scanScheduled = false;
    function scheduleScan() {
      if (scanScheduled) return;
      scanScheduled = true;
      Promise.resolve().then(() => {
        scanScheduled = false;
        runScan();
      });
    }

    async function runScan() {
      const ctx = store.ctx;
      if (!ctx) return;
      let plugins = store.plugins;
      let presetRows = store.presetRows;
      try {
        const res = await ctx.remote.pluginInventory.list();
        if (res && res.ok) {
          plugins = res.value.entries || [];
          presetRows = readPresetRows(res.value);
        }
      } catch (_) { /* inventory temporarily unavailable; keep last */ }
      let slotSnapshot = [];
      try { slotSnapshot = ctx.slots.snapshot() || []; } catch (_) { slotSnapshot = []; }
      const alerts = buildAlerts(plugins, slotSnapshot, presetRows);
      const stats = buildStats(plugins, presetRows);
      const healthy = findHealthy(plugins.concat(presetRows), slotSnapshot);
      // Transient phases are never alerts, but a row that has sat in one for
      // minutes is no longer plausibly startup noise. Reported as elapsed-time
      // information only — see trackStalls.
      const stalled = trackStalls(plugins.concat(presetRows), Date.now());
      store.set({
        plugins, slotSnapshot, presetRows,
        alerts, stats, healthy, stalled, lastRun: new Date().toISOString()
      });
    }

    /* ----------------------------------------------------- preset rows */
    // The agent-preset subtree is the biggest blind spot this plugin had.
    //
    // `pluginInventory.entries` comes from `ctx.loader.entries()`, which only
    // walks the TOP-LEVEL Loader tree. dsh-agent-preset-registry mounts each
    // preset's `config.plugins` into a SEPARATE `PresetTree` (it declares
    // `static [EntryGroup.key] = true`), so preset rows are reported under
    // `agentPresets[]` and never appear in `entries`.
    //
    // On a stock profile that is ~36 rows, ~26 of them enabled — every one of
    // them invisible to this report until now. A plugin that activates
    // correctly at top level but fails inside the standing preset produced
    // NO alert at all, which is exactly the silent-failure class this plugin
    // exists to catch.
    //
    // Row shape (dsh-host-plugin-inventory/lib/index.js:144-154):
    //   { moduleName, enabled, fiberPhase, meta? }  — same as a top-level row,
    //   plus whatever compositionInventory() puts on the composition itself.
    // `preset` names which composition the row came from.
    function readPresetRows(value) {
      const out = [];
      const compositions = value && Array.isArray(value.agentPresets) ? value.agentPresets : [];
      for (const c of compositions) {
        const presetName = (c && (c.name || c.id || c.preset)) || '(unnamed preset)';
        const rows = c && Array.isArray(c.rows) ? c.rows : [];
        for (const r of rows) {
          if (!r || typeof r.moduleName !== 'string') continue;
          out.push({
            preset: presetName,
            moduleName: r.moduleName,
            enabled: r.enabled !== false,
            fiberPhase: r.fiberPhase === void 0 ? null : r.fiberPhase,
            meta: r.meta || null
          });
        }
      }
      return out;
    }

    // Informational split of the Loader's rows: how many activated plugins
    // have a browser half vs are host-only. Reported as a sentence, NEVER as
    // alerts — a host-only plugin registering no slot is correct behaviour,
    // not a failure. Counting one alert per host-only plugin is the bug that
    // produced the "163 plugins silently failing" report.
    //
    // The split uses `fiberPhase === 'active'`, not `enabled`, for the same
    // reason findInert does: a still-pending row has not been scanned into the
    // manifest yet, so it would otherwise be miscounted as host-only.
    function buildStats(plugins, presetRows = []) {
      const composed = bootEntryIds();
      const enabled = plugins.filter((p) => p.enabled);
      const failed = enabled.filter((p) => p.fiberPhase === 'failed');
      const active = enabled.filter((p) => p.fiberPhase === 'active');
      const clientHalf = composed === null
        ? null
        : active.filter((p) => composed.has(p.moduleName)).length;
      return {
        total: plugins.length,
        enabled: enabled.length,
        active: active.length,
        failed: failed.length,
        hostOnly: clientHalf === null ? null : active.length - clientHalf,
        clientHalf,
        manifestAvailable: composed !== null,
        // Informational only: the preset subtree is a different Loader tree and
        // is NOT part of the split above. Surfacing its size makes the coverage
        // claim honest ("N top-level + M preset rows were examined").
        presetRows: presetRows.length,
        presetEnabled: presetRows.filter((r) => r.enabled).length
      };
    }

    /* ----------------------------------------------------- healthy list */
    // The positive counterpart to the alert list: plugins that are enabled,
    // fully activated, and — when the manifest is available — actually present
    // in the browser's boot graph. Everything NOT in here is either an alert
    // (see buildAlerts) or a startup transient (pending / loading), which are
    // deliberately not surfaced at all.
    //
    // It answers the question the alert list cannot: "is my plugin actually
    // running?" Without it a clean scan is just an empty box, which reads as
    // "this plugin is broken" rather than "everything is fine".
    //
    // Preset rows are included, tagged with their preset, because a preset row
    // that activated is just as "running" as a top-level one.
    function findHealthy(plugins, slotTrees) {
      const composed = bootEntryIds();
      const observed = slotRegistrants(slotTrees);
      // moduleName -> the slots it actually contributed to.
      const byRegistrant = new Map();
      const walk = (node) => {
        if (node.occupants) {
          for (const o of node.occupants) {
            if (!o.registrant) continue;
            if (!byRegistrant.has(o.registrant)) byRegistrant.set(o.registrant, new Set());
            byRegistrant.get(o.registrant).add(node.name);
          }
        }
        if (node.children) node.children.forEach(walk);
      };
      slotTrees.forEach(walk);

      return plugins
        .filter((p) => {
          if (!p.enabled) return false;
          // A failed row is an alert, never a healthy entry.
          if (p.fiberPhase === 'failed') return false;
          // pending / loading are normal startup transients: not healthy yet,
          // not broken either. They are listed separately so the user can see
          // that the scan is aware of them.
          if (p.fiberPhase !== 'active') return false;
          // Without the manifest we can only vouch for activation, not for the
          // browser half actually loading.
          if (composed === null) return true;
          return composed.has(p.moduleName);
        })
        .map((p) => ({
          moduleName: p.moduleName,
          preset: p.preset || null,
          // A plugin that registered nothing is still healthy — host-only
          // plugins are supposed to register nothing.
          slots: observed.has(p.moduleName)
            ? [...byRegistrant.get(p.moduleName)]
            : [],
          browserHalf: composed === null ? null : composed.has(p.moduleName)
        }));
    }
    /* ----------------------------------------------------- components */
    const SEV_COLOR = {
      error: 'var(--dsw-alias-state-error-primary,#f85149)',
      warn: 'var(--dsw-alias-state-warning-primary,#d29922)',
      info: 'var(--dsw-alias-state-business-primary,#3b82f6)'
    };

    // Category ids are internal; show the localized label.
    const CATEGORY_FALLBACK = {
      slots: '槽位注册', patch: 'patch 层', inert: '客户端半体缺失',
      metadata: '展示元数据', crash: '组件崩溃'
    };
    function categoryLabel(cat, t) {
      try { return t(`cat.${cat}`); } catch (_) { return CATEGORY_FALLBACK[cat] || cat; }
    }

    function AlertRow({ alert, compact, t }) {
      const [open, setOpen] = React.useState(false);
      const cat = categoryLabel(alert.category, t || ((k) => k));
      return h('div', { className: `dsh-hm-row ${alert.severity}${compact ? ' dsh-hm-row-compact' : ''}` },
        h('p', { className: 'dsh-hm-title' },
          h('span', { className: 'dsh-hm-dot', style: { background: SEV_COLOR[alert.severity] } }),
          h('span', null, alert.title)),
        h('p', { className: 'dsh-hm-meta' }, `分类：${cat}`),
        h('button', { className: 'dsh-hm-btn', onClick: () => setOpen((v) => !v) }, open ? '收起' : '查看修复建议'),
        open ? h('div', null,
          h('p', { className: 'dsh-hm-meta' }, alert.who),
          h('pre', { className: 'dsh-hm-fix' }, alert.fix)) : null
      );
    }

    function DiffView({ diff, t }) {
      if (!diff) return null;
      if (diff.error) return h('div', { className: 'dsh-hm-diff' }, `快照解析失败：${diff.error}`);
      const { added, removed, phaseChanges } = diff;
      if (!added.length && !removed.length && !phaseChanges.length) {
        return h('div', { className: 'dsh-hm-diff' }, '与上一快照相比无变化。');
      }
      return h('div', { className: 'dsh-hm-diff' },
        h('p', { className: 'dsh-hm-title' }, t('diffTitle')),
        added.length ? h('div', null, h('p', { className: 'dsh-hm-diffadd' }, '新增告警：'),
          added.map((a) => h('p', { className: 'dsh-hm-meta dsh-hm-diffadd' }, `+ ${a.title}`))) : null,
        removed.length ? h('div', null, h('p', { className: 'dsh-hm-diffdel' }, '已解决：'),
          removed.map((a) => h('p', { className: 'dsh-hm-meta dsh-hm-diffdel' }, `- ${a.title}`))) : null,
        phaseChanges.length ? h('div', null, h('p', { className: 'dsh-hm-meta' }, '插件相位变化：'),
          phaseChanges.map((c) => h('p', { className: 'dsh-hm-meta' },
            `· ${c.moduleName}: ${c.before} → ${c.after}`))) : null
      );
    }

    function StatsView({ stats, t }) {
      if (!stats || !stats.manifestAvailable) return null;
      const presetPart = stats.presetRows > 0
        ? `；另检出 agent preset 子树 ${stats.presetRows} 行（已并入下方巡检范围）。`
        : '';
      return h('p', { className: 'dsh-hm-meta' },
        `插件构成：共 ${stats.enabled} 个启用中，其中 ${stats.clientHalf} 个带浏览器半体、` +
        `${stats.hostOnly} 个仅宿主侧（不注册任何界面槽位，属正常设计）。` +
        `${stats.failed > 0 ? ` ${stats.failed} 个激活失败。` : ''}` + presetPart);
    }

    // Rows that have been sitting in a startup transient far longer than a
    // dependency chain plausibly needs. Shown as plain text with NO severity
    // dot: from the renderer a stalled `loading` is still indistinguishable
    // from a slow one, so this is a "worth a look" cue and nothing stronger.
    // The whole point is that these rows are otherwise completely invisible —
    // silent, and not in the healthy list either.
      function StalledView({ stalled }) {
        if (!stalled || stalled.length === 0) return null;
        return h('div', { className: 'dsh-hm-stalled' },
          h('p', { className: 'dsh-hm-meta' },
            `启动相位停留过久（${stalled.length}）：以下插件长时间停在 pending / loading，` +
            `未激活也未失败，因此既不算异常也不在“运行正常”清单里。`),
          h('ul', { className: 'dsh-hm-healthy-list' },
            stalled.map((s) => h('li', {
              key: `${s.preset || ''}\u0000${s.moduleName}`,
              className: 'dsh-hm-healthy-item'
            },
              h('span', { className: 'dsh-hm-stalled-dot' }),
              h('span', { className: 'dsh-hm-healthy-name' },
                s.preset ? `${s.moduleName}　[preset: ${s.preset}]` : s.moduleName),
              h('span', { className: 'dsh-hm-stalled-age' },
                ` ${s.phase} 已 ${s.seconds} 秒`)))));
      }

    // The positive list. Collapsed by default: it is long (every working
    // plugin) and the interesting half of the report is the alerts.
    function HealthyView({ healthy }) {
      const [open, setOpen] = React.useState(false);
      if (!healthy || healthy.length === 0) return null;
      return h('div', { className: 'dsh-hm-healthy' },
        h('button', {
          className: 'dsh-hm-btn', onClick: () => setOpen((v) => !v),
          'aria-expanded': open
        }, `${open ? '▴' : '▾'} 运行正常（${healthy.length}）`),
        open ? h('ul', { className: 'dsh-hm-healthy-list' },
          healthy.map((p) => h('li', {
            // A package can appear once at top level and again inside a
            // preset, so the key must carry the preset too.
            key: `${p.preset || ''}\u0000${p.moduleName}`,
            className: 'dsh-hm-healthy-item'
          },
            h('span', { className: 'dsh-hm-ok-dot' }),
            h('span', { className: 'dsh-hm-healthy-name' },
              p.preset ? `${p.moduleName}　[preset: ${p.preset}]` : p.moduleName),
            h('span', { className: 'dsh-hm-healthy-slots' },
              p.slots.length
                ? `→ ${p.slots.join(', ')}`
                : (p.browserHalf === false ? '仅宿主侧，无界面注册（正常）' : '未注册界面槽位（正常）'))))) : null
      );
    }

    function ReportSection(props) {
      const s = useStore();
      const t = props.t;
      const fileRef = React.useRef(null);
      return h('div', { className: 'dsh-hm-sec' },
        h('div', { className: 'dsh-hm-actions' },
          h('button', { className: 'dsh-hm-btn', onClick: () => runScan() }, t('rescan')),
          h('button', { className: 'dsh-hm-btn', onClick: () => exportSnapshot() }, t('export')),
          h('button', { className: 'dsh-hm-btn', onClick: () => fileRef.current && fileRef.current.click() }, t('import')),
          h('input', {
            ref: fileRef, type: 'file', accept: 'application/json',
            style: { display: 'none' },
            onChange: (e) => { const f = e.target.files && e.target.files[0]; if (f) importSnapshot(f, t); e.target.value = ''; }
          })),
        s.lastRun ? h('p', { className: 'dsh-hm-meta' }, `最近扫描：${s.lastRun}`) : null,
        h(StatsView, { stats: s.stats, t }),
        s.alerts.length === 0
          ? h('div', { className: 'dsh-hm-empty' }, t('empty'))
          : h('div', null, s.alerts.map((a) => h(AlertRow, { key: a.id, alert: a, t }))),
        h(StalledView, { stalled: s.stalled }),
        h(HealthyView, { healthy: s.healthy }),
        h(DiffView, { diff: s.diff, t })
      );
    }

    /* ----------------------------------------------------- apply */
    function apply(ctx) {
      store.ctx = ctx;
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'health-monitor: dictionaries');
      const t = ctx.locale.bind(NS);
      store.set({ t });

      // Full report in Settings. The report is the ONLY surface — there is
      // deliberately no resident banner in `shell.overlay`. A permanent red
      // pill in the corner is noise for the 99% of sessions where everything
      // is fine, and `shell.overlay` is an additive list slot shared with the
      // Chat quota notice; parking a permanent occupant there to report
      // "nothing is wrong" was not worth the real estate. Everything the
      // banner showed is in this section, including the healthy list.
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section', id: 'healthMonitor', order: 70,
        label: () => t('nav'), locale: NS
      }, (p) => h(ReportSection, { t })));

      // Re-scan on any slot-ledger mutation (coalesced).
      // NOTE: SlotRegistry does not expose `onMutate` (that is private to
      // SlotCore). The renderer bridges it to the cordis event 'slots/changed',
      // which fires once per mutated key — coalescing happens in scheduleScan.
      const offMutate = typeof ctx.on === 'function'
        ? ctx.on('slots/changed', () => scheduleScan())
        : () => {};
      // Live component-crash supervision.
      const offError = typeof ctx.slots.onEntryError === 'function'
        ? ctx.slots.onEntryError((key, entry, error, info) => {
            const a = {
              id: `crash:${key}:${info && info.abdicated ? 'abdicated' : 'error'}`,
              severity: 'error',
              category: 'crash',
              title: `槽位 ${key} 的组件渲染崩溃`,
              who: `entry=${entry && entry.options ? (entry.options.id || entry.options.key || '(anonymous)') : '?'}；${info && info.abdicated ? '已被 abdicate 退出该单元' : '仅通知'}。`,
              fix: `在对应插件的 client.js 中定位该槽位的组件实现，修复其抛错（检查 props/hooks 与 owner 传入的 props 是否匹配）。`
            };
            store.set({ alerts: store.alerts.filter((x) => x.id !== a.id).concat([a]) });
          })
        : () => {};

      // Initial scan + resident polling (patch-layer / activation is not
      // observable from slot mutations, so poll the inventory).
      const timer = setInterval(() => runScan(), 4000);
      runScan();

      // Cleanup on unload / HMR.
      ctx.effect(() => {
        return () => {
          clearInterval(timer);
          offMutate && offMutate();
          offError && offError();
        };
      }, 'health-monitor: teardown');
    }

    return { name: 'dsh-checkup', inject: ['slots', 'locale', 'remote', 'remote.pluginInventory'], apply };
  }
});
