<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-TITLE: Ponytail 设置页 UI 重构：三卡片、五态图例、双表格与帮助提示 -->
<!-- DSH-STATUS: ready-for-agent -->
<!-- DSH-LABELS: wayfinder:map -->
<!-- DSH-IDEMPOTENCY-KEY: deck-e7bc5b72-5980661 -->
<!-- DSH-CREATED: 2026-11-09T04:28:48.511Z -->

# Map：Ponytail 设置页 UI 重构

## Destination

设置页 `Ponytail` 面板从「一堆同级 `<h3>` + 裸列表」变成**三段式开发者调试面板**：三张独立卡片（档位配置 / 优先级诊断链 / 效率统计），每张卡片带小标题与统一内边距；档位改成**真分段单选**并把长说明收进悬浮帮助；诊断链改成**从上至下的优先级步骤表**，带前置规则说明与五种状态图例；效率改成**指标表格**，环形与横向条作为表格里的图形行保留。

一句话验收：打开设置页，用户能在不读任何文档的情况下回答三个问题——「我在用哪档、这档是怎么被选中的、它到底管了我多少轮」，且每个状态标签的含义在同一屏内能找到解释。

**硬边界**：保留全部原有功能、数据、文案与逻辑，不删任何诊断信息；`diagnose()` 与 `charts.tsx` 的契约零改动；不新增任何 `package.json` 依赖；不出现写死颜色。

## 已定的判断（四轮 grilling，17 题，用户全部同意）

| # | 判断 | 结论 |
|---|------|------|
| Q1 | 卡片 vs 旧笔记 | **重写** `docs/design/ponytail-efficiency-ui.md` §3「不套卡片」的结论：三区各一张卡片（`bg-layer-2` 底 + `border-l3` 0.5px 边框 + padding 12）。§3 与 §9 标注「已被新规范取代」 |
| Q2 | 帮助提示原语 | `SegmentedControlOption.title` 给四段各一句短说明 + 一个自绘 `?` 按钮包在官方 `HoverCard` 里放四档完整对照。**不新装组件**（primitives 无 HelpIcon，`?` 用 `<span>` 画） |
| Q3 | 图例形态 | **五种状态全出，不用 emoji**：生效=`success` / 被覆盖=`warning` / 值非法=`danger` / 未设置=`quiet` / 不可观测=`info`，图例本身就是五个 `Tag` 实例 |
| Q4 | 状态行内容 | 只报覆盖关系不报 user 存在性：`生效 full · revision 12 · 被环境变量覆盖`（无覆盖写 `无覆盖`）；「用户层有没有值」由「清除用户层覆盖」按钮的 disabled 体现 |
| Q5 | 效率「表格」要不要留图 | **`<table>` 承载五个指标，环形与横向条作为两个图形行并入同一张表**（数值列 `96 / 128`，图形列 64px 环；分布行 `colSpan`） |
| Q6 | 「打开配置文件按钮」 | **这次不加**（现状根本不存在这个按钮，`PonytailPanelProps` 无 openPath 类回调，`slots.register` 参数也无此字段）。路径一律用 `PathLabel`（已装原语，悬停全文 + 自带复制）。真做「打开文件」另开票查宿主通道 |
| Q7 | 标题与 SECTION_ID | `<h2>` 改 `Ponytail`；`SECTION_ID = 'ponytail-58fly'` 与所有 `ponytail-58fly: …` effect 标签**不动**（是注册键与命名空间）。`unavailable` 段措辞去掉品牌前缀，但**保留配置路径事实** |
| Q8 | 诊断三列窄栏 | `<table>` 列固定「状态｜来源｜取值」，备注列宽栏显示、窄栏折叠到行下方小字（**不删数据**）；路径单元格用 `PathLabel`，**禁止 `word-break` 硬塞** |
| Q9 | 效率表窄栏 | 只折叠「说明」列，**图形列永不折叠**；`< 420px` 环形与 bar 各占整行 `colSpan=2`。说明文字折叠后仍留在 `title` |
| Q10 | 卡片头按钮 | 统一一个主操作位：档位卡头「清除用户层覆盖」，效率卡头「刷新」，「清零统计」留卡片底部左对齐。**不引入 `⋯` 菜单**。卡片内按钮一律 `variant="outline" size="sm"`，不再出现裸 `Button` |
| Q11 | 图例位置 | 只在诊断卡标题行下方，「前置规则说明」的下半句：`取值顺序 环境变量 → Profile 补丁 → 内置兜底，先命中的赢 · 图例：[五个 Tag]`；放不下整体换行不拆两处 |
| Q12 | 基线备注形态 | blockquote 式提示块：`bg-layer-2` 底 + 左侧 `state-warn-primary` 2px 竖条 + 12px 内边距；正文「这是上游基准，不是本机测量」，小一号写出处与方法论链接。**不用单 Tag 承一句话** |
| Q13 | token 真名（纠正前两轮的错名） | `--dsw-alias-surface-raised` / `state-empty` / `state-warning-primary` 均**不存在**。改用 `--dsw-alias-bg-layer-2`（卡片底）、`--dsw-alias-state-warn-primary`（竖条）、`--dsw-font-mono`（等宽路径与档位代号） |
| Q14 | 响应式机制 | 不用 CSS 容器断点（宿主无先例，`@media` 测视口而设置页在侧栏/大屏里等宽无关）：面板根节点挂 `ResizeObserver`，`width < 480` 切紧凑模式。多一个 hook + `useState`，零依赖 |
| Q15 | 语言控件 | **不加**。这次是纯 UI 重构，`writeMode`/`resetMode` 就是全部写操作面；加语言控件会扩 `PonytailPanelProps` 契约 |
| Q16 | 落地形态 | `diagnose()` 与 `charts.tsx` 零改动，只重写 `panel.tsx` 渲染层；新规范写 `docs/design/ponytail-settings-ui.md`；14 条诊断哨兵与 `verify` 第 10b 组一行不改；**不为 UI 补 DOM 测试**（宿主无 jsdom） |
| Q17 | 跨入口文案 | `/ponytail-gain` 末行改 `设置 → Ponytail → 效率统计`；`/ponytail` **不动**（宿主侧拿不到覆盖信息，硬加就是猜）。卡片标题定名 **`效率统计`**，旧笔记 §1 的「效率」标为旧名 |

## Notes（已查过的材料，只记路径与一句话结论）

- `src/client/panel.tsx` — 三区块已存在但全是同级 `<h3>`/`borderTop` 分隔；`TITLE = 'Ponytail 58fly'`；`STATE_TEXT` 已定义五态 tone。
- `src/client/charts.tsx` — `Ring`（r=28，周长 175.93）与 `BarList`（div 条，`minWidth 160`），契约本次不动。
- `src/l0/diagnosis.ts` — 五态 + 三层顺序恒 `env → patch → fallback`，纯函数；**浏览器侧看不到 env，只能按值归属反推**，这是 `/ponytail` 拿不到覆盖信息的根因。
- `src/client/index.ts` — `SECTION_LABEL = 'Ponytail'`（:49）已无 58fly；`SECTION_ID = 'ponytail-58fly'`（:43）是注册键与 `configForms.get` 命名空间。
- `docs/design/ponytail-efficiency-ui.md` — §3「不套卡片」与 §9「清零按钮位置」被本次推翻；§2/§5/§6/§7 仍有效。
- `.scratch/ponytail-efficiency/map.md` — Q4「档位→诊断链→效率」区块顺序、Q19「不做迷你折线」仍然有效。
- `node_modules/@deepseek-ai/dsh-client-ui-primitives` — 已装 `HoverCard` / `SegmentedControl` / `StateDot` / `Tag` / `PathLabel`；**无 Card、无 HelpIcon**。
- 宿主 primitives 只见过 `matchMedia('(any-hover: hover)')` / `(prefers-reduced-motion: reduce)`，**无宽度断点先例**。

## 迷雾 / 已知缺口

- **`/ponytail` 不显示覆盖信息**：命令侧只有 `runtime.getSnapshot()`，没有 `configForms` 的三段投影，无法反推被谁覆盖。这是已知信息缺口，本次显式保留并记入规格的「后续票」，不许悄悄留着。
- 不新增「打开配置文件」入口：宿主 `slots.register` 无 openPath 字段，未查 openPath/file 服务，单独成票。
- 未在真实宿主里实测 `ResizeObserver` 是否受 CSP 限制（`primitives` 本身用 `matchMedia`，推测无碍）。
- `bg-layer-2` 与 `bg-module-platform` 在设置页卡片上的实际取值差异未肉眼对比。

## 实现要点（给后续实施票的直接依据）

1. **面板骨架**：`<h2>Ponytail</h2>` + 一句定位说明 → 三张卡片依序排列（档位 → 诊断 → 效率统计），卡片 = `div` 带 `background: var(--dsw-alias-bg-layer-2)`、`border: 0.5px solid var(--dsw-alias-border-l3)`、`borderRadius: var(--dsw-radius-md)`、`padding: 12`，卡头小标题 + 右上角动作位。
2. **档位卡**：`SegmentedControl` 保留（`id="ponytail-58fly-mode"`），四段 `title` 各一句短说明；`?` 按钮 + `HoverCard` 放四档对照。状态行 `生效 <code>full</code> · revision 12 · 被环境变量覆盖`。其下「清除用户层覆盖」`variant="outline" size="sm"`，无 user 值即 disabled。`feedback` 行沿用 `Tag` + 文案。
3. **诊断卡**：卡头标题 + 右上角无动作；标题行下「前置规则说明 + 五态图例」一行。`<table>` 三列「状态｜来源｜取值」，状态列 `Tag`，来源列 `PathLabel`，取值列 `--dsw-font-mono`；备注宽栏第四列、窄栏移到行下方 12px 小字。`overriddenBy` 存在时表格下方一句解释。
4. **效率统计卡**：卡头标题 + 「数据截至 HH:MM」+ 右上「刷新」；`<table>` 三列「指标｜数值｜说明/图形」，指标行 `受管轮次 / 注入次数 / 注入字节 / 切档次数 / 命令调用次数`；注入率行数值 `96 / 128`、图形列 `<Ring>`；按档位分布行 `colSpan` 放 `<BarList>`。其下基线提示块（Q12 形态）再下「清零统计」（inline 二次确认保留）。三态文案（loading / empty / error）与现有一字不改。
5. **响应式**：`RefCountObserver`（`ResizeObserver`）在面板根 `<section>` 上，`< 480` 时紧凑：诊断备注下移、效率说明列折叠、图形行占整行。
6. **token 纪律**：只用 `--dsw-alias-*` / `--dsw-font-mono` / `--dsw-radius-*`；`verify` 第 10b 组的 hex 与「实时」扫描必须继续零命中。

## Notes

## Decisions so far

## Not yet specified

## Out of scope

## 进度
