# 插件体检（dsh-checkup）

一个**只读**的 DSH 客户端插件：把插件的静默失效变成设置页里明确的、可操作的告警，并同时列出**确认正常**的插件。

安装后打开 **设置 → 插件体检**。

---

## 安装

```bash
dsh plugin --profile <profile> add https://github.com/DQ-Deng/dsh-chekup.git
```

重启 DSH，设置里就会出现 **插件体检** 一节。

`<profile>` 是你的 profile 名（`desktop` / `web` / `tui` …，见 `~/.dsh/profiles/`）。
这条命令会同时把它加进 profile 的 `dependencies` 和 `dsh.profile.bundles`。

> 已 clone 到本地的话，也可以直接装目录：
>
> ```bash
> dsh plugin --profile <profile> add ./dsh-chekup
> ```

### 验证是否装上

```bash
dsh --profile <profile> --dump-config | grep dsh-checkup
```

如果设置里没出现，打开开发者工具看 Network 里 `plugins/??dsh-checkup/client.js` 是否返回 200。

### 卸载

```bash
dsh plugin --profile <profile> remove dsh-checkup
```

---

## 它能查出什么

| 探测器 | 查什么 | 级别 |
| --- | --- | --- |
| **槽位覆盖** | 多个插件注册同一个槽位单元，后到的被静默顶掉；以及条目被自己的渲染崩溃 abdicate 退出 | `warn` / `error` |
| **patch 层未生效** | `enabled` 但 `fiberPhase === 'failed'`，patch 行根本没激活。**包含 agent preset 子树里的行** | `error` |
| **展示元数据损坏** | `meta.error`（title/description/icon 解析失败） | `warn` |
| **浏览器半体消失** | `client.js` 确实运行过（slots 账本有注册），却已从启动清单 `__DSH_BOOT__.entries` 中消失 | `warn` |
| **组件崩溃** | 渲染边界抛错的实时捕获 | `error` |
| **运行正常清单** | 反向清单：已启用 + 已激活 + 确实在启动清单里的插件，以及它实际注册了哪些槽位 | — |
| **启动相位停留过久** | 停在 `pending` / `loading` 超过 60 秒的插件。**纯文字提示，不是告警** | — |

每条告警都带**是谁撞了谁**、**撞的是哪个槽位**、**改哪一行能解决**，而不是一个红色报错。

---

## 它不会误报什么

这是本插件最主要的设计约束——初版把 105 个纯宿主侧插件（tools / skills / storage / agent loop）全报成了"静默失效"，因为它们本来就不注册任何界面槽位。修正后：

- **纯宿主侧插件不告警**：不渲染界面的插件注册不到槽位，这是 DSH 的既定架构，不是失效。只在统计行里说明一句。
- **`pending` / `loading` 不告警**：启动瞬态，4 秒轮询的首次扫描必然命中一片。超过 60 秒仍停留的会以非告警形式列出，方便看出"卡住了"，但不会被判定为故障。
- **没有 `window.__DSH_BOOT__` 时闭嘴**：宿主没注入启动清单（embedder / CLI / 渲染先于 boot）时，相关探测器输出零条告警，而不是每个插件报一条。

---

## 界面

报告是唯一界面，就在 **设置 → 插件体检**，从上到下：

1. 重新扫描 / 导出快照 / 导入对比
2. 上次扫描时间
3. 构成统计（一行）
4. 告警区
5. 启动相位停留过久（有才显示）
6. 运行正常清单（默认折叠）
7. 快照对比区

**没有右上角常驻角标**——那会和 Chat 配额通知抢 `shell.overlay` 的位置，为了报告"什么都没发生"而永久占一块地方不值当。

扫描时机：每 4 秒一次；槽位账本变动时立即重扫；渲染崩溃实时捕获；也可手动点重新扫描。

---

## 已知限制

- **只读**：只告诉你改哪一行，不自动改。
- **只看浏览器侧**：宿主侧的工具注册冲突、Skill 覆盖、系统提示注入冲突看不到——那需要宿主半体配合。
- **4 秒轮询分辨率**：两次扫描之间的短暂故障可能漏过。

---

## 开发

```bash
node test/health-monitor.mjs        # 68 项逻辑断言（mock ctx）
node test/health-monitor-boot.mjs   # 用真实 dsh-client-modules 模块系统跑通 apply()
```

两个测试都不依赖外部资料，克隆即可跑。

### 结构

```
├── package.json        ← 整包清单
├── cordis.patch.yml    ← 宿主 Loader 的一行 insert
├── index.js            ← Node 宿主半体（本插件留空 apply）
├── client.js           ← Web 渲染器半体（全部逻辑与 UI，经典脚本）
├── test/               ← 两个回归测试
└── tools/              ← 开发期调查探针，非回归测试
```

三个名字必须完全一致，否则真实模块系统无法解析：
`__ModuleLoader__.load({ id })` 的 `id`、`cordis.patch.yml` 的 `name`、`package.json` 的 `name`，均为 `dsh-checkup`。

---

## 许可

MIT
