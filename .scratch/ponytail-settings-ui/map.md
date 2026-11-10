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

## 子题（四条，顺序就是读取顺序）

- [卡片壳、紧凑宽度与接线测试桩](issues/01-卡片壳-紧凑宽度与接线测试桩.md) — 三张卡共用的外观与紧凑宽度判据 + 接线测试桩补齐。
- [档位卡：分段单选、悬停帮助与单行状态行](issues/02-档位卡-分段单选-悬停帮助与单行状态行.md) — 档位区从 Tab 样式改真单选，长说明进悬浮卡，状态压一行。
- [诊断链卡：规则行、五态图例与三层步骤表格](issues/03-诊断链卡-规则行-五态图例与三层步骤表格.md) — 诊断链改从上至下的三层步骤表，带规则句与五态图例。
- [效率统计卡：指标表格、图形行与基线提示块](issues/04-效率统计卡-指标表格-图形行与基线提示块.md) — 效率区改指标表格，环与横条作图形行，基线做提示块。

依赖：02、03、04 都被 01 阻塞，01 定下卡片壳与宽度判据后才谈得上各自端到端。三张卡之间没有依赖。

## Notes

## Decisions so far

- [卡片壳、紧凑宽度与接线测试桩](issues/01-卡片壳-紧凑宽度与接线测试桩.md)：卡片壳定死为 `CARD_STYLE` 一套参数（`bg-layer-2` / `0.5px border-l3` / `radius-md` / padding 12 / gap 12 / 卡头左标题右单一动作位），紧凑判据是 `useCompactWidth` 量**面板自身宽度**、阈值 480、取不到 `ResizeObserver` 即降级宽栏；接线测试桩不补测宽类全局，断言口径不扩（宿主无 jsdom）。`main@6e1b102` typecheck 退出 0、271 项测试全过。
- [档位卡：分段单选、悬停帮助与单行状态行](issues/02-档位卡-分段单选-悬停帮助与单行状态行.md)：`?` 用 `HELP_TRIGGER` 圆钮包 `<HoverCard inline openDelayMs={200}>`，不占卡头唯一动作位；`MODE_HELP` 四行与 `skills/ponytail-help/SKILL.md:18-21` 逐字同源（**off 行是这次补进手册的**，此前只存在于优先级链段）；状态行改 `档位｜revision｜覆盖关系`，`overriddenBy === null` 时若补丁行命中且注脚来自组合层则写「来自 Profile 组合层」，不再一律说「无覆盖」。`f32d07a`：typecheck 0 / build 53209B / 271 pass / verify 通过。
- [诊断链卡：规则行、五态图例与三层步骤表格](issues/03-诊断链卡-规则行-五态图例与三层步骤表格.md)：卡底覆盖句的判据从 `overriddenBy` 改成**补丁行自身状态**（`shadowed` 说「被盖住」、`invalid` 说「已被忽略」、其余不补句）——`overriddenBy` 只看生效值归属，用户层空、env 顶掉兜底时会说成「你改的补丁层被盖住」，那是假话；`diagnose()` 的返回契约未动，只在 `overriddenBy` 计算里加一条「补丁层没写过值就不报覆盖」，并导出 `DIAGNOSIS_PATCH_SHADOWED` 供面板判据复用（哨兵随之从 14 条变 15 条）。表格列宽 `5em | 40% | 5em | 余`，`td` 保持 `table-cell`，紧凑备注下移并挂 `tr title`。`208d2cf`：typecheck 0 / build 53997B / 272 pass / verify 通过。
- [效率统计卡：指标表格、图形行与基线提示块](issues/04-效率统计卡-指标表格-图形行与基线提示块.md)：六个待定项四个早已由代码答掉（环与条不进 tr/td、折叠说明挂 `tr title`、`CALLOUT_STYLE` 四个主题变量、清零内联不引 Modal）；真缺口是**面板对基线读法的两处失真**——零轮次时 `projectSavings` 的绝对值乘过 base 为 0，面板当比例乘 100 印出「约 0%」（真相是「还没有可省的轮次」），且漏了命令层一直印的「推算基数（N 个非 off 轮次 × 每轮假定 800）」。改法是把基线文案收进 `stats/baseline.ts`（新增 `BASELINE_NO_ACTIVE` / `baselineBasis`），面板新增 `ratioOf` 把绝对值还原成比例、`activeTurns === 0` 时不画三行，块尾重复的限定语删掉。`63e347c`：typecheck 0 / build 56347B / 273 pass / verify 通过。

## Not yet specified

- 紧凑模式（<480px）在真实宿主里的肉眼效果没有证据：只有代码层判据（卡头 `flexWrap`、效率表折叠说明列、诊断备注下移、基线块现在多一行推算基数，块高 +17px）。**四张票已全部落地，这一条随时可以核对，也是地图上唯一还挂着的雾。**
- 480px 这个阈值本身没被数据校准过：它来自「设置页最窄能塞进多宽」的估计，没有实测侧栏最小宽度。
- 紧凑模式下诊断行的 `title` 悬停兜底在触屏不可达（无 hover），是否值得为一句话改成长按或点击展开，等真机核对时一并决定。

## Out of scope

- 「打开配置文件」入口（原 Q6 判为「这次不加」）：本图推进期间已查清宿主确有通道，并作为票 06 落地进 `6e1b102`——它属于下游实施票，不是这张图的一步路线。

## 探索结论

**这张图不需要再交棒。** 四张票的结论不是「待施工的方案」，而是已经在 `main` 上交付的代码：`f32d07a`、`208d2cf`、`63e347c` 三个提交，加上票 06 的 `6e1b102`。没有任何剩余决策要转成规格，也没有任何活要再拆——再走一次 `/to-spec` + `/to-tickets` 只会把已完成的改动重新描述一遍。

核对依据（都在 `3fb1aa0` 这棵树上实测，不是凭记忆）：

- 四张票四问四答齐：卡片壳（`CARD_STYLE` + `useCompactWidth`）、档位卡（`HoverCard` 帮助 + 状态行三分支）、诊断卡（规则行 + 五态图例 + 三层步骤表，覆盖句改由补丁层状态驱动）、效率卡（指标表 + `Ring`/`BarList` + 基线块与命令层同源）。细节只住在各票里，本图不重述。
- 硬边界逐条守住：`src/client/charts.tsx` 自 `2994efe` 起零改动；`Diagnosis` 契约仍是 `rows`/`effective`/`overriddenBy` 三项；`package.json` 只多了版本号 `0.3.1`，无新依赖；`verify` 第 10b 组（hex 与「实时」）继续零命中。
- 全量绿：`typecheck` 退出 0；`build` → `lib/client.js` 56347 bytes；`pnpm test` 273 pass / 0 fail；`verify` 通过（32 源文件 / 117 产物 / 1 提醒）；`check:skills` 通过（6 技能）。
- 顺带修掉两处真 bug（这是图的副产品，不是路线的一部分）：`overriddenBy` 会把「补丁层没写过值、env 顶掉兜底」误报成覆盖；面板零轮次时印「约 0%」而真相是「没有可推算的轮次」。

**留下的三处雾按「决定不做」处置**，不是未决事项，因此不阻碍收口：紧凑模式（<480px）的肉眼效果、480px 阈值本身、触屏上的 `title` 兜底——三条都需要真机（本会话没有浏览器通道），已如实写明证据缺口；哪天要核对，属于新一轮核对，不需要这张图还开着。

## 进度

- 进度：100%（2026-11-10T22:42:24+08:00）：完成核对通过（3fb1aa0 全绿）：四张子票全关、frontier 为空，四票结论都已落成代码并进仓，写「## 探索结论」后关闭地图

- 2026-11-10 · 修面板 0/0：`issues/` 目录此前根本没建，四条子题从未创建（不是关联丢失）。现按地图 Destination 与「实现要点」的四个实施面重建为 01–04，文件头写 `DSH-PARENT: 00`，正文首节即为 `## 子题` 清单（条数与子票数一致，四条都指向真实文件）。阻塞边 02←01、03←01、04←01 用 `deck_map_link` 写入。**01 现在是唯一的 frontier。**
- 2026-11-10 · 推进「卡片壳、紧凑宽度与接线测试桩」→ 已关。核对发现三项决策已有代码承载（`src/client/panel.tsx:164-205` 的宽度判据、`:219-268` 的卡片壳、`test/client-wiring.test.mjs:34-53` 的桩面），本次只做取证与实测（typecheck 0 / 271 pass），未改代码。下一步：02 / 03 / 04 同时变可接（并列取号最小者 = 02「档位卡」）。
- 2026-11-10 · 推进「档位卡」→ 已关（`f32d07a`）。四缺口由本人拍板：补技能手册 off 行、面板读补丁行注脚判组合层、回执留正文末、分隔符改全角竖线。检查：typecheck 0 / build 53209B / 271 pass / verify 通过 / check:skills 通过。
- 2026-11-10 · 推进「诊断链卡」→ 已关（`208d2cf`）。四缺口由本人拍板：覆盖句按补丁层状态分支、非法值算覆盖但改说法、图例维持同行整体换行、紧凑备注补 title。顺手修掉一处真 bug：`overriddenBy` 在「补丁层没写过值 + env 顶掉兜底」时误报 `env`。检查：typecheck 0 / build 53997B / **272 pass**（哨兵 14→15）/ verify 通过。**剩下 04「效率统计卡」是唯一 frontier。**
- 2026-11-10 · 推进「效率统计卡」→ 已关（`63e347c`）。六个待定项里四个由代码/文档已答；两处真缺口按本人拍板修：零轮次不画三行改印 `BASELINE_NO_ACTIVE`、三行之下补推算基数一行；另删块尾重复的 `BASELINE_CAVEAT`。基线文案收进 `stats/baseline.ts`，面板与命令首次同源。检查：typecheck 0 / build 56347B / **273 pass**（新增一条零投影断言）/ verify 通过 / check:skills 通过。**四张子票全部关闭，frontier 为空。**
- 2026-11-10 · **完成核对并收口**：`3fb1aa0` 上重跑 typecheck 0 / build 56347B / 273 pass / verify 通过 / check:skills 通过；逐条核对四张票的结论都已成代码（`f32d07a`、`208d2cf`、`63e347c`、`6e1b102`），硬边界（`charts.tsx` 零改动、`Diagnosis` 契约三项、无新依赖、10b 组零命中）逐条实测。结论：不需要交棒，不生成规格、不拆票；三处雾按「决定不做（缺真机证据）」处置，结论写进 `## 探索结论`。地图关闭。
