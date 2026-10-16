# 插件体检（dsh-checkup）

一个**只读**的 DSH 客户端插件：把插件静默失效变成设置页里明确的、可操作的告警，并同时列出**确认正常**的插件。

安装后进入 **设置 → 插件体检**。右上角没有常驻角标——那会为一个"一切都好"的会话持续占用 `shell.overlay` 的真实空间，因此全部内容都收敛在这一处。

> 本插件是**双面体（dual-face）**：`index.js` 是 Node 宿主半体（本插件留空），`client.js` 是 Web 渲染器半体（全部逻辑与 UI）。
> 三个名字必须完全一致：`__ModuleLoader__.load({ id })` 的 `id`、`cordis.patch.yml` 的 `name`、`package.json` 的 `name` —— 三者都等于 `@local/dsh-checkup`。

---

## 1. 它解决什么问题

DSH 的插件失效大多是**静默**的——不弹错、不闪红，只是"看起来装了但没生效"。常见形态：

- **Patch 层没生效**：`cordis.patch.yml` 里写了 `insert`，但对应插件 `fiberPhase` 是 `failed` 或带着 `meta.error` —— 插件行根本没激活。
- **渲染崩溃（entry error）**：某个槽位挂件的 `render` 抛错被边界捕获并 `abdicate`，该单元从此没有任何可见注册者。
- **槽位注册被静默覆盖**：多个插件往同一个 `list` 槽位注册了相同 `id`，或往同一个 `single` 槽位注册且 `priority` 相同，后到的那个不报错、也不显示。
- **浏览器半体缺失**：插件在宿主侧活着，但其 `client.js` 没有进入浏览器的启动清单。

本插件把这些**静默失败**变成**明确的、可操作的 UI 告警**：谁和谁撞了、撞的是哪个槽位/工具、改哪一行能解决，而不是只给你一个红色报错。

> **它不会把"正常设计"报成故障。** 纯宿主侧插件（tools / skills / storage / agent loop）不渲染任何界面，本来就不会注册槽位，也不会进入 `__DSH_BOOT__.entries` —— 这是 DSH 的既定架构，不是失效。本插件对这类插件只输出一行统计说明（"K 个仅宿主侧插件，不注册界面槽位，属正常设计"），不产生告警。详见 2.1 节。

---

## 2. 它能做什么（三个探测器 + 崩溃捕获 + 构成统计 + 运行正常清单 + preset 子树）

| 探测器 | 数据源 | 检测内容 | 告警级别 |
| --- | --- | --- | --- |
| **findShadowed** | `ctx.slots.snapshot()` | 遍历每个槽位的 `occupants`，标出 `active:false` 的注册者。分两种情况：**(a)** 同单元存在活跃胜出方 → 被静默覆盖；**(b)** 同单元无任何活跃注册者 → 该条目已被渲染边界 abdicate 退出（组件崩溃） | `warn` / `error` |
| **findPatchFailures** | `pluginInventory.entries` + `agentPresets[].rows` | 标出 `enabled` 但 `fiberPhase === 'failed'` 的插件（patch 行未激活）。preset 行会额外标注来源 preset | `error` |
| **findMetadataErrors** | 同上 | 标出 `meta.error`（展示元数据解析失败）的插件。同样覆盖 preset 行 | `warn` |
| **findInert** | 同 `findShadowed` | 反向判据："在 slots 账本里有注册（说明 `client.js` 确实运行过）+ `enabled` + `active`，却已从 `__DSH_BOOT__.entries` 消失" | `warn` |
| **onEntryError** | `ctx.slots.onEntryError(...)` | 实时捕获渲染边界抛错，给出"被 abdicate 退出该单元 / 仅通知"的上下文 | `error` |
| **findHealthy** | 同 `findInert` | 反向清单：本次扫描**确认正常**的插件（`enabled` + `active` + 在启动清单里），并列出它实际注册了哪些槽位 | 非告警 |
| **StatsView**（非告警） | 同上 | 一行统计：N 个已激活插件中 M 个带浏览器半体、K 个仅宿主侧，另附 preset 子树行数。**只展示，不告警** | — |

每一个告警都带 `who`（碰撞双方插件名）、`category`、`title` 和 `fix`（"在插件 X 的 client.js 中定位该槽位组件，修复其抛错"等），而不是源文件行号。

> **关于 `pending` / `loading`**：这两个相位是**启动期的正常瞬态**（fiber 尚未创建、正在等依赖）。本插件**不对它们告警**——4 秒轮询的首次扫描几乎必然命中一片 `pending`，报出来只会制造噪音。只有 `failed` 才是确定性故障。它们也不进"运行正常"清单（尚未确认正常），但同样不算异常。
>
> **但"不告警"不等于"看不见"**：一个卡在 `loading` 两分钟的插件，和一个刚启动三秒的插件，在报告里原本完全一样。`trackStalls` 补上了这个空白——它对每个 `(preset, moduleName, phase)` 记录首次观察时间，**超过 60 秒仍在瞬态相位**时，在报告里以**纯文字、无严重级配色**的形式列出："启动相位停留过久（N）……"。它**永远不会**把瞬态升级成告警（渲染器侧仍无法区分"依赖链慢"和"真的卡住"），也**不会**影响告警计数；相位是计时 key 的一部分，所以 `pending → loading` 的翻转会重新计时，不会继承旧的停留时间。
>
> **关于 `meta.error`**：这是**展示元数据**（title/description/icon）解析失败，与"patch 层未激活"是两件不同的事，因此单列 `metadata` 分类、降为 `warn`，修复建议也指向 `package.json` 的 `meta` / `locale/*.json` / `icon` 而不是 cordis patch。
>
> **关于"浏览器半体缺失"**：`window.__DSH_BOOT__` 是宿主注入的启动清单，只包含**声明了 `dsh.client.platform === "web"`** 的包（`dsh-client-modules` 在合成时把其他包全部滤掉）。因此"inventory 里有、清单里没有"对**纯宿主侧插件是正常状态**——这正是本插件初版报出"163 个插件静默失效"全部为误报的原因。修正后的判据要求**该插件在 slots 账本里确有注册**（证明其 `client.js` 确实执行过），只有这种"运行过却又从清单消失"的行才是真缺陷。
>
> **关于 agent preset 子树**：`pluginInventory.entries` 只走**顶层** Loader 树，而 `dsh-agent-preset-registry` 把每个 preset 的 `config.plugins` 挂在**独立的 PresetTree** 上（它声明 `static [EntryGroup.key] = true`），所以这些行从不出现在 `entries` 里，而是从 `agentPresets[].rows` 单独返回。本插件读取它们并接入 `findPatchFailures` / `findMetadataErrors` / `findInert` / `findHealthy`，告警会标注来源 preset。槽位覆盖检测**不**覆盖 preset 行——slots 账本只反映顶层树的注册，preset 行的 registrant 会是假信号。

---

## 2.1 曾修复的误报：为什么"静默失效"数量会虚高

初版 `findInert` 的判据是 `enabled + fiberPhase==='active' + slots 账本里没有它的 registrant`。这个判据对**每一个纯宿主侧插件**都必然成立——宿主侧插件（tools / skills / storage / agent loop）不渲染任何界面，本来就不会注册槽位。在一个标准 profile 上，这会产生 100+ 条 info 级误报。

修正是三件事一起做的：

1. **换判据**：从"没注册槽位"改为"注册过槽位但已从 `__DSH_BOOT__.entries` 消失"。见上表 `findInert` 行。
2. **降噪**：把 host-only 插件从告警里挪出去，改为报告里的一行**统计**（StatsView），只说明"K 个仅宿主侧插件，不注册界面槽位，属正常设计"。
3. **兜底**：如果宿主没有注入 `window.__DSH_BOOT__`（embedder / CLI / 渲染先于 boot），`findInert` **返回空数组**——零告警，而不是每启用一个插件报一条。

> 无法从渲染器侧区分"纯宿主侧插件"与"声明了 `dsh.client` 但清单合成失败"的插件：`pluginInventory` 只回放展示元数据（`pluginPackages.metaOf`），不回放 `dsh.client` 声明。slots 账本里有无 registrant 是渲染器侧唯一可用的证据，这就是新判据要以它为前提的原因。

---

## 3. 工程结构（扁平化双面体）

DSH 客户端插件是"双面体（dual-face）"：`package.json` 描述整包；根目录 `index.js` 是 **Node 宿主半体**（Loader 行），`exports["./client"]` 指向的 `client.js` 是 **Web 渲染器半体**（真正的浏览器逻辑）。本工程**没有嵌套子包**，全部平铺在仓库根：

```
dsh-checkup/                       ← 整个目录就是插件工程
├── package.json                   ← 整包清单（必须含 exports["./client"] + dsh.client.platform）
├── cordis.patch.yml               ← 宿主 Loader 的一行 insert（创建插件行）
├── index.js                       ← 宿主半体（Node）。本客户端插件只需一个空 apply()。
├── client.js                      ← 渲染器半体（Web）。核心巡检逻辑 + UI，经典脚本（classic script）。
├── test/                          ← 两个回归测试，`node test/xxx.mjs` 直接跑
│   ├── health-monitor.mjs         ← 68 项逻辑断言（mock ctx 跑探测器 + 9 条回归守卫）
│   └── health-monitor-boot.mjs    ← 用真实 dsh-client-modules 模块系统跑通 apply()
├── tools/                         ← 调查/探针工具（非回归测试，见下）
└── .gitignore                     ← 排除 .ref/（约 38 MB 反编译第三方源码，不属于本插件）
```

> **关于 `tools/` 与 `.ref/`**：`.ref/` 是从已安装 DSH 的 `app.asar` 里反编译出来的第三方包副本，
> 仅作开发期的本地对照资料，已列入 `.gitignore`。`tools/` 里的探针（`asar.mjs`、`repro-163.mjs`、
> `verify-163.mjs`、`scan-asar-client.mjs`、`probe*.mjs` 等）在需要时会读取 `.ref/`，因此**克隆仓库后
> 需先重新提取才能运行**：
>
> ```bash
> node tools/asar.mjs extract "<DSH 安装目录>/resources/app.asar" dsh/ .ref/asar/
> ```
>
> 其中 `cordis-harness.mjs` 与 `probe-*.mjs` 还要求以 **Electron-as-node** 运行（它们从 asar 内部
> import cordis，普通 `node` 无法解析）：
>
> ```powershell
> $env:ELECTRON_RUN_AS_NODE=1
> & "D:\ProgramFiles\DeepSeek Harness\DeepSeek Harness.exe" tools/probe-registry.mjs
> ```
>
> **回归测试只有 `test/` 下那两个**，且 `health-monitor.mjs` 不依赖 `.ref/`；
> `health-monitor-boot.mjs` 在找不到 `.ref/` 时会打印 `SKIP` 并以 0 退出，而不是报 ENOENT。

**三个名字必须完全一致**（否则真实模块系统无法解析）：
`window.__ModuleLoader__.load({ id })` 里的 `id`、`cordis.patch.yml` 的 `name`、`package.json` 的 `name` —— 三者都等于 `@local/dsh-checkup`（与项目目录名一致，便于核对）。

> 注：宿主半体 `index.js` 留空 `apply()` 是符合规范的（官方示例 `@deepseek-ai/dsh-cordis-client-runner` 也是如此）。本插件的全部价值都在渲染器侧。

---

## 4. 安装与验证（对照《DeepSeek-Harness 插件开发指南》）

指南版本：`0.1.0-rc.6` / `@deepseek-ai/cordis` `4.0.1`（桌面 PDF）。
> 实测对照的运行环境 asar 为 `0.2.0-rc.2` / `cordis ~4.0.4`，两者的客户端插件 API 面一致，本实现对两者均兼容（详见第 7 节）。

### 4.1 作为 bundle 安装（推荐）

```bash
# 把本包放进某个 profile 的 node_modules 后，用 CLI 追加到 bundles 列表
dsh plugin --profile <profile-name> add @local/dsh-checkup

# 验证 cordis.patch.yml 的 insert 已落入已加载插件集合
dsh --profile <profile-name> --dump-config
```

`cordis.patch.yml` 的内容：

```yaml
- insert:
    - id: dsh-checkup
      name: '@local/dsh-checkup'
```

### 4.2 用 `file:` 依赖安装（开发期）

```bash
# 在 profile 目录
pnpm add file:D:/code/dsh-checkup
```

软链安装时，profile 的 `node_modules/@local/dsh-checkup` 是一个 junction；改名后必须同步更新 junction 与 `pnpm-lock.yaml`，否则宿主读到的是旧包名、patch 行静默失效。

### 4.3 验证是否真的装上了

1. `dsh --profile <profile-name> --dump-config` 里应能看到 `@local/dsh-checkup`；
2. 打开设置，应出现 **插件体检** 一节；
3. 若设置里没有，先看开发者工具 Network：`plugins/??@local/dsh-checkup/client.js` 是否 200。

---

## 5. 运行时用法

报告是**唯一界面**，位于 **设置 → 插件体检**，从上到下：

1. **操作按钮**：重新扫描 / 导出快照 / 导入对比；
2. **上次扫描时间**；
3. **构成统计**（一行）：已激活插件中带浏览器半体 vs 仅宿主侧，另附 preset 子树行数；
4. **告警区**：按严重级（`error` / `warn`）排列，每条可展开看 `who` 与 `fix`；
5. **启动相位停留过久**（仅在有行超过 60 秒仍停在 `pending` / `loading` 时出现）：纯文字、**无严重级配色**。详见 §2 的说明；
6. **运行正常清单**：默认折叠的 `▾ 运行正常（N）`，展开后每个插件标注它实际注册了哪些槽位；纯宿主侧标注"仅宿主侧，无界面注册（正常）"；来自 preset 子树的条目标注 `[preset: xxx]`；
7. **快照对比区**：导入一份旧快照后显示新增告警、已解决告警、插件相位变化。

> **为什么没有右上角常驻角标**：`shell.overlay` 是一个 additive list 槽位，与 Chat 配额通知共享。为了报告"什么都没发生"而在那里永久占一个位置，对绝大多数正常会话是纯噪音。所有信息（包括运行正常清单）都在设置页里，需要时才看。

### 扫描触发时机

- **定时**：每 4 秒一次（`setInterval`）；
- **槽位账本变动**：`ctx.on('slots/changed')`，微任务合并；
- **渲染崩溃**：`ctx.slots.onEntryError(...)` 实时；
- **手动**：点"重新扫描"。

---

## 6. 已知限制

- **只读**：不自动修复任何问题，只给出定位到"改哪一行"的建议。
- **渲染器视角**：只能看到浏览器侧能观察到的东西。宿主侧的工具注册冲突、Skill 覆盖、系统提示注入冲突都看不到——这些需要宿主半体配合，属于后续扩展点。
- **`pending` / `loading` 不告警**：启动瞬态，报出来只会制造噪音。超过 60 秒仍停留的会以**非告警**形式列出（见 §2），但不会被判定为故障。
- **无法区分"纯宿主侧"与"`dsh.client` 声明了但清单合成失败"**：见 2.1 节的说明，这是渲染器侧的固有限制。
- **4 秒轮询分辨率**：两次扫描之间的短暂故障可能漏过。

---

## 7. 兼容性

| 项 | 值 |
| --- | --- |
| DSH 桌面端 | `0.2.0-rc.2`（实测） |
| `@deepseek-ai/cordis` | `~4.0.4`（实测），指南中的 `4.0.1` 亦可 |
| Node | `22.x` |
| 浏览器 | Electron 内置 Chromium |

客户端插件 API 面（`ctx.slots` / `ctx.locale` / `ctx.remote` / `ctx.on` / `ctx.effect`）在两个版本间一致。

---

## 8. 测试

```bash
node test/health-monitor.mjs        # 逻辑：mock ctx 跑全部探测器
node test/health-monitor-boot.mjs   # boot：真实 dsh-client-modules 模块系统
```

两份测试当前均通过：

- **逻辑测试**：68 项断言。除探测器行为外，还钉死了九条契约/回归守卫——
  1. `apply` 必须走 `ctx.on('slots/changed')` 而非 `ctx.slots.onMutate`；
  2. 模块 `inject` 必须含 `'remote.pluginInventory'`；
  3. **R1**：纯宿主侧插件（slots 账本里无 registrant）**不得**被 `findInert` 报成静默失效；
  4. **R2**：注册过槽位却已从 `__DSH_BOOT__.entries` 消失的插件**必须**被报出来；
  5. **无横幅**：`apply()` **不得**再注册 `shell.overlay`（那个角标已撤，报告是唯一界面）；
  6. **运行正常清单**：只收录"已启用 + 已激活 + 在启动清单里"的插件，排除 failed / pending / inert / host-only；
  7. **P1–P5（agent preset 子树）**：preset 行里的 failed 必须被报出且标注 preset 来源；preset 行里的 `pending` 和 host-only 必须保持静默；preset 行里已激活的必须带 preset 标签进"运行正常"清单；
  8. **S1–S7（启动相位停留计时）**：首次观察的瞬态不得报；超过 `STALE_MS`（60s）必须报出且带秒数；多行分别计时；preset 行独立计时；`failed` / `active` 永不计时；离开瞬态相位即清计时器，且 `pending → loading` 的翻转**不得**继承旧计时（相位是计时 key 的一部分）；瞬态行**永不**成为告警；
  9. **安全网**：删掉 `window.__DSH_BOOT__` 后重扫，`findInert` 必须输出**零**条告警，StatsView 不渲染，其他探测器照常工作。

  mock ctx 里的 `slots` **故意不提供** `onMutate`，这样一旦回退就会立刻失败。
- **boot 测试**：9 项断言。证明手写经典脚本 `client.js` 能被真实 DSH 浏览器模块系统加载、`apply(ctx)` 只注册
  `settings.section#healthMonitor`（不碰 `shell.overlay`），并注入内联样式 `<style data-plugin data-plugin-css>`；
  末尾用一个**与真实 `SlotRegistry` 表面一致**的 ctx 重跑 `apply()`，证明没有任何对不存在方法的调用；
  再从真实 `client.js` 源码里提取 `readPresetRows` 单测，覆盖畸形 composition（`moduleName` 非字符串、无 `rows` 数组、
  `null`、类型错误）与旧宿主（无 `agentPresets` 字段）两种情况。

---

## 9. 许可

MIT
