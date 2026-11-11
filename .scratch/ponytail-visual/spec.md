<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-TITLE: Ponytail 面板图形化：诊断链改管道、效率卡三区块、文字降级进 ? -->
<!-- DSH-STATUS: closed -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-IDEMPOTENCY-KEY: deck-a43a74ba-5981196 -->
<!-- DSH-CREATED: 2026-11-11T01:02:43.644Z -->

## Problem Statement

开发者打开「设置 → Ponytail」要回答三个问题：我在用哪档、这档是怎么被选中的、它到底管了我多少轮。现在前两个问题的答案被写成了一张**四列表格**，第三个问题被写成了一张**五行表格**，读者得先把文字在脑子里重排成一张图。

具体到面板上：

- **诊断链读不懂机制**。表格列是 `状态｜来源｜取值｜备注`，但真实机制是「env → 配置文件 → 内置默认值」三步扫描。读者得自己在行间补出这条规则——所以卡头必须写一句 `取值顺序 环境变量 → Profile 补丁 → 内置兜底，先命中的赢`，还要配五个状态标签的图例。**规则句加图例，就是表格讲不清自己的证据。**
- **「被覆盖」这个词在多数场景下是错的**。`diagnose()` 的判据是「谁的值等于最终生效值谁命中」，而内置底层永远有值，于是最常见的干净场景被显示成「生效 Profile 补丁 full / 被覆盖 内置兜底 full」。底层从没被覆盖，它只是没轮到。真正被覆盖只发生在 `overriddenBy !== null` 时。
- **非法值会被显示成「生效」**。`patchRaw` 与 `patchMode` 取自不同层，`user='bogus'` + `base='full'` 时会报 `patch: hit, value: 'bogus'`——面板报告一个不存在的档位生效了。
- **效率卡的名词没起命名作用**。`受管轮次 / 注入字节 / 切档次数` 每个都要配一句「这个数怎么算的」，说明在替名词干活。这不是字太多，是命名失败。
- **图形只是表格的配角**。环和横向条挤在表格下方，读者先读五个数字再读两张图，正好把顺序反了。
- **字数实测**：诊断卡 179 个汉字，效率卡 195 个汉字，两卡合计 374 字，其中至少一半在解释上一行。

一句话：不是「好不好看」，是**这张页面的信息密度全落在文字上，图形没有承担任何含义**。

## Solution

把两卡的文字层拆掉，让图形承担机制本身。

1. **诊断链改成一截管道**。竖线就是取值顺序，自上而下扫，第一个实心点就是生效值，值是 22px 等宽大字。

   ```
           ●  环境变量     ultra      ← 实心 = 命中
           ┊
           ○  配置文件     lite       ← 虚线空心 = 写了没赢
           ┊
           ·  内置默认值   full       ← 淡出 = 压根没轮到
   ```

   命中层之下的层整段淡出，不画状态（它们不参与比较）。命中层之上保留状态图形：虚线加 `?` 是浏览器读不到 env，空心小点是写了没赢，淡点是没写过。**值非法时这一层没有节点，上下两段红线各留一小截、中间空着**，原值标红，答案自然落到下一层。

   五态标签、图例、规则句、备注列全部删除。层名的出处（变量名、补丁路径、源码位置）挪进 `?` 和「打开配置文件」。

2. **三层改名**：`环境变量 / 配置文件 / 内置默认值`。「Profile 补丁」是宿主的术语，「兜底」暗示异常——这两个词都不该出现在「我的档位被谁改了」的答案里。

3. **效率卡改成三块图形**：`128` 主数字配注入率环；一条四档堆叠条（`off 12 · lite 38 · full 71 · ultra 7`，这一行就是全部说明）；三行共用 `−60%…0` 横轴的区间条（输出 token / 成本 / 耗时）。其余四个数压成一行等宽小字 `40.0 KB · 7 切档 · 21 命令`。五个 `说明` 全部收进 `?`。`清零统计` 从卡底挪进卡头 `⋯` 菜单。

4. **紧凑宽度（<480px）**：层名在上、值在下，管道缩成 12px 竖槽，只改字号与列宽，不改阅读顺序。

5. 五个 `?` 承载全部说明文本：档位对照、层名出处、`轮次` 口径、注入率口径、`off` 灰色含义、基准限定语与推算基数。

原型与实测：![方案](../docs/design/prototype-shots/next-v3.png)，对照现状 ![现状](../docs/design/prototype-shots/current-v2.png)。方案细节、病根分析、不动清单见 `docs/design/ponytail-visual-proposal.md`。

| 卡片 | 现状汉字 | 方案汉字 |
| --- | --- | --- |
| 优先级诊断链 | 179 | 22 |
| 效率统计 | 195 | 31 |

## User Stories

1. 作为一个第一次打开设置页的开发者，我希望诊断链的阅读顺序就是取值顺序，好让我不用先读一句规则再看表。
2. 作为一个想知道「现在到底用哪档」的人，我希望生效值就是那颗实心点上的大字，好让我一眼找到答案而不是逐行比对状态列。
3. 作为一个写了 `defaultMode: bogus` 的人，我希望面板告诉我这一层不通、原值标红，好让我知道该改哪里。
4. 作为一个被环境变量悄悄改掉档位的人，我希望管道在环境变量那一层实心、下面两层虚掉，好让我不用读文字就看出「有人在我上面写了值」。
5. 作为一个在干净安装里打开面板的人，我希望底层那行淡到几乎看不见，好让我知道它没参与比较而不是被谁盖住了。
6. 作为一个不知道 `PONYTAIL_DEFAULT_MODE` 是什么的人，我希望层名就写「环境变量」，好让我不必认识变量名也能读。
7. 作为一个不知道「Profile 补丁」指哪份文件的人，我希望层名叫「配置文件」，出处放在 `?` 里，好让我不必先学会宿主的术语。
8. 作为一个需要改配置文件的人，我希望「打开配置文件」还在原位，好让我读完诊断就能直接动手。
9. 作为一个想知道某层具体写了什么的人，我希望把鼠标放到 `?` 上能看到变量名与补丁路径，好让我不必翻文档。
10. 作为一个只关心结论的人，我希望卡面上没有任何备注文字，好让我在十秒内读完一屏。
11. 作为一个第一次看效率卡的人，我希望主数字是受管轮次，好让我先知道面板管了多少轮再谈其他。
12. 作为一个想知道注入率的人，我希望环里直接写 `75%`、旁边写 `96/128`，好让我既能看比例也能看原始分母。
13. 作为一个想按档位看分布的人，我希望一条堆叠条就画完四档，好让我一眼看出哪档用得最多。
14. 作为一个以为 `off` 灰色代表「没算」的人，我希望 `off` 后面挂个 `?` 说明它只是不注入，好让我不误解总数。
15. 作为一个想看基准推算的人，我希望三行区间条共用一根横轴，好让我直接比较长短而不是读三组括号。
16. 作为一个不想被营销话术冒犯的人，我希望卡面只写「上游基准，非本机测量」，好让我知道这些数不是本机实测。
17. 作为一个想知道「−45% 是怎么来的」的人，我希望 `?` 里给出推算基数与算法链接，好让我能自己复核。
18. 作为一个想把字节数、切档次数、命令调用次数放在手边的人，我希望它们压成一行小字而不是占三行表格，好让我不占屏。
19. 作为一个怕误点清零的人，我希望清零进 `⋯` 菜单并保留二次确认，好让我不会顺手清掉运行期累计。
20. 作为一个在 420px 侧栏看面板的人，我希望管道变成细竖槽、层名在上值在下，好让我不用横向滚动。
21. 作为一个用屏幕阅读器的人，我希望管道有 `role="group"` 与一句说全三层结局的 `aria-label`（哪层写了什么、谁生效、谁没赢），好让我也能知道这三层各自怎么了，而不是听到一串没有意义的 SVG。
22. 作为一个切到暗色主题的人，我希望三种状态色在暗色下依然分得开，好让我不用切回亮色才敢读。
23. 作为一个维护这个面板的人，我希望改完之后诊断数据结构、统计口径、清零、打开配置文件的行为一行都没动，好让我不必重新验证整条链路。
24. 作为一个运行 `pnpm verify` 的人，我希望诚实纪律的哨兵全部保留，好让我不会在删字的过程中把「不承诺实时」「不写你省了」这两条一起删掉。
25. 作为一个回看历史的人，我希望 `CHANGELOG` 里能读到这次改的是呈现方式而不是数据口径，好让我不会怀疑数字变了。
26. 作为一个读规格的工程师，我希望归因规则单独记在规格里、有单测钉住，好让我不会在渲染层第二次猜错。

## Implementation Decisions

### 模块与边界

- **新增 `src/client/attribution.ts`**：把「三层各自处于什么状态」从 `diagnose()` 的原始报告里算出来，供管道渲染。它和 `l0/diagnosis.ts` 的区别是：`diagnose()` 回答「谁的值等于生效值」，归因回答「扫到哪一层停下、每一层该画什么」。这两个问题今天的代码混在一起，是两个病根的共同来源。
- **`src/client/panel.tsx`**：`DiagnosisCard` 与 `EfficiencySection` 重写渲染；`ModeCard` 只改 `?` 的内容组织，几乎不动。
- **`src/client/charts.tsx`**：新增 `Pipeline`（三层管道 SVG）与 `RangeBars`（共轴区间条）。`Ring` 与 `BarList` 保留——`BarList` 被四档堆叠条取代后若无其他调用方则删除，不保留死代码。
- **`src/l0/diagnosis.ts` 不动**。这是硬边界：本次不改判据、不改 `DiagnosisRow` 形状、不改三层顺序。
- `projectSavings()`、`BASELINE`、`StatsStore` 全部不动。

### 归因规则（本次的核心契约）

```ts
export type AttributionState = 'hit' | 'miss' | 'past' | 'invalid' | 'unknown';

export interface Attribution {
  /** 最终生效档位；snapshot 不带值时回落 DEFAULT_MODE，与 diagnose() 一致。 */
  effective: RuntimeMode;
  /** 生效值来自哪一层，用于 aria 描述；卡面不显示。 */
  from: 'env' | 'patch' | 'fallback';
  /** 恒三层，顺序恒 env → patch → fallback。 */
  levels: Array<{ level: PriorityLevel; state: AttributionState; value: string | null }>;
}
```

规则：

1. **`env` 层**：`diagnosis.rows` 里 env 是 `hit` → `hit`，值是 `row.value`；是 `unknown` → `unknown`，值渲染为 `?`（浏览器读不到 `process.env`，这一层永远只能反推）。
2. **`patch` 层**：`row.value` 存在且**`coerceMode()` 归一化后仍不是档位** → `invalid`（不看 `diagnose()` 报的 `hit`）。归一化必须走 `coerceMode`，不能比字面量：诊断报告保留原样写法（`FULL` / ` full ` 都合法），比字面量会把合法档位判成非法、把答案指到错误的层。这是对既有判据缺陷的渲染层防御：现状会把非法值报成 hit，面板照抄就会显示一个不存在的档位「生效」。合法且等于 `effective` → `hit`；合法但不等于 → `miss`；无值 → 落到第 3 条。
3. **`fallback` 层**：`env` 与 `patch` 都未命中时 → `hit`，值 `DEFAULT_MODE`；否则 → `past`。
4. **`invalid` 不阻断扫描**：非法值被忽略，扫描继续往下一层走。因此 `env=unknown + patch=invalid + fallback=hit` 是合法组合，管道在 patch 处断开、答案落在 fallback。
5. **`past` 不画状态**：命中层之下、**没写值**的层是 `past`，渲染时整行淡出。**写了值但没赢的层保留 `miss` / `invalid`，不淡出**——这是这张卡唯一能说、别处看不到的信息（「你写了 ultra，但环境变量更横」）。兜底层永远有值，它没被采用时也是 `past`。
6. `from` 只用于无障碍描述与 `?` 内容，**卡面不出现「来自 XX」这句文字**——管道本身就表达了这个。

这套规则是「渲染层不再第二次猜」的唯一出口：渲染只看 `Attribution`，不回头读 `DiagnosisRow.state`。

### 渲染契约

- **管道容器**：`role="group"`（不用 `role="img"`——`img` 会把子树从无障碍树里换掉，层名与值就读不到了），`aria-label` 形如 `取值顺序环境变量 → 配置文件 → 内置默认值。环境变量不可观测；配置文件写 full，生效；内置默认值没轮到。当前生效 full。`层与层之间的连线由**上一层**的状态决定形状：`hit` 之后不再往下扫；`miss` 走虚线（警告色）；`unknown` 走虚线（信息色）；`invalid` 空一段（扫描继续）。
- **横向几何**：常规 32px 槽、行高 40、节点半径 7；紧凑 12px 槽、行高 46、节点半径 5。这套尺寸来自原型，直接作为常量。
- **值排版**：命中层 `600 22px/26px` 等宽，紧凑 19px；其余 12px；无值渲染为 `—`，`unknown` 层渲染为 `?`（`past` 层保留值但整体 `opacity: .32`）；`invalid` 层用危险色加 600 字重，不划删除线。
- **效率卡四块**（自上而下）：主数字 + 注入率环 → 四档堆叠条 + 一行 mono 图例 → 四个杂项一行 mono 小字 → 三行共轴区间条 + 轴刻度。卡底只留限定语一行加 `?`。
- **堆叠条分段**：按 `turnsByMode` 真实比例（不是等宽），`off` 用 `--dsw-alias-border-l3`，其余三档同 token `--dsw-alias-state-business-primary`、透明度依次递减；总数为 0 时退化为一条空槽，不留空白洞。
- **区间条**：固定横轴 `−60%…0`，区间矩形取 `from/to`，中心点取 `center`；三项来自 `projectSavings()` 的 `outputTokens / cost / time`，不多不少。
- **`清零统计`**：挪进卡头 `⋯` 菜单，菜单内仍是原样的二次确认。不许改成单击。
- **浮动帮助**：全部沿用宿主的 `HoverCard`（`anchor` 为 `?` 按钮，`inline`），不新造工具提示组件。

### 文案

- 三层名：`环境变量 / 配置文件 / 内置默认值`。
- 删除的卡面文字：规则句、五态图例、每行备注、`说明` 列标题、`来源` 列标题、`按档位分布（受管轮次）`、`基准推算` 小节标题。
- 保留的卡面文字：卡片标题（`档位` / `优先级诊断链` / `效率统计`）、`刷新`、`打开配置文件`、`清除用户层覆盖`、`off · 关闭 / lite · 最轻 / full · 默认 / ultra · 最狠`、`上游基准，非本机测量`、`轮次`、`注入 96/128`、四档名与数字、三个区间条标签。
- `TAGLINE` 保留不动。

## Testing Decisions

### 什么算好测试

只测外部可观察的行为：给定一份快照，归因结果是什么；给定归因结果，渲染出的管道节点状态序列是什么。不测 SVG 内部的坐标、不测颜色值、不测字号。

### 要测的模块

1. **`attribution`（新，主力测试对象）**。它是纯函数、零 IO、零 `node:`，和 `diagnose()` 一样可以在 Node 里直接跑。覆盖：
   - 三层恒在、顺序恒 `env → patch → fallback`；
   - `user='bogus'` + `base='full'` → patch 是 `invalid` 而不是 `hit`，`effective` 仍为 `full`，fallback 是 `hit`；
   - env 命中 → fallback 一律 `past`，哪怕它也有值；
   - env `unknown` + patch 无值 → fallback `hit`；
   - 空快照 → 三层齐全，不抛。
2. **`@internal` 渲染辅助**：管道节点状态序列（`['unknown','hit','past']` 这类数组）由一个纯函数产出、组件只负责画。测这个序列，不测 JSX。
3. **哨兵测试**：断言 `panel.tsx` 的卡面字符串里**不再出现**规则句、五态图例、`来源`/`说明` 列标题；断言 `attribution` 与 `diagnose()` 对同一份快照给出相同的 `effective`——两条链不许漂移。

### 既有先例

- `test/client-diagnosis.test.mjs`：纯函数 + 按层名取行 + `states()` 把状态压成对象再断言，让断言读起来像句子。新测试照这个写。
- `test/client-wiring.test.mjs`：用假 `window` 抠出 `lib/client.js` 的 factory 再断言注册形状。**本次不新增这条链的测试**——渲染层没有 DOM 可测，硬测会把宿主桩写进测试里，成本大于收益。
- `test/stats.test.mjs`：断言数字而不是断言渲染。区间条的数值来源已有覆盖，本次不重复。

### 为什么不在 DOM 里测

宿主的 `HoverCard`、`SegmentedControl` 依赖真实的 primitives 包，而本仓 `node_modules` 里那份只有类型；上一轮已经证明在 Node 里 import 它会因为缺 `clsx` / `react-dom` / `@deepseek-ai/dsh-util-*` 而失败。为渲染测试引入 jsdom 会打破「零新增依赖」这条硬边界。**结论：渲染层不写 DOM 测试，用纯函数守卫 + 原型截图人眼验收。**

## Out of Scope

- **不修 `diagnose()` 的判据缺陷**（`patchRaw` 与 `patchMode` 取自不同层）。本次用渲染层防御绕开，根因单独修；混进来会让这次 diff 说不清。
- 不改统计口径、不改 `StatsStore`、不改 `projectSavings()`、不改 `BASELINE`、不改 `ASSUMED_TOKENS_PER_TURN`。
- 不改 `ModeCard` 的分段控件、写回执、`清除用户层覆盖` 行为。
- 不改「打开配置文件」的行为与它的返回值处理。
- 不改跨入口文案一致性的哨兵（`TAGLINE`、`/ponytail-gain` 的末行指向）。
- 不新增依赖、不引入图表库、不引入 jsdom。
- 不改明暗主题 token 定义。

## Further Notes

- **原型即契约**。`docs/design/ponytail-panel-prototype.html` 是可直接打开的单文件，四格分别是「最常见」「env 赢了」「值非法」「420px 紧凑」。实施时以这四格为准，不要重新设计。
- **现状图是真的**。`docs/design/prototype-shots/current-v2.png` 由真 `lib/client.js` 渲染（宿主环境打桩，组件与 `diagnose()` 都是真代码），不是手绘。打桩脚本在 `.scratch/ponytail-visual/harness/`，`node render.mjs && node page.mjs` 可复现。
- **未验证**：`?` 悬浮卡在宿主 `HoverCard` 里的实测宽度、管道在 320px 下的表现，都只在静态原型里看过，没有在真面板里量过。实施落地后需要人眼过一遍这两处。
- **极端情形没有单独出图**：真正的干净安装（没人写过配置文件）会让命中值落在第三层，上面两行都是虚的。方案文档已按「靠字号与字重把眼睛拉过去」处理，但没有单独的截图。
- 上一轮同类讨论（`.scratch/ponytail-settings-ui/`）决定过「拆三卡 + 每个状态有名词解释」。本次不推翻它，只是认定它没解决「读懂机制」这件事。

## Comments

### local — 2026-11-11T05:46:03.932Z
## 收尾核对

代码交付在 **`main` @ `8312aca`**，其后只有 `.scratch/` 下的票与规格文档改动（`fb0a9d1`）。已推送，`git ls-remote origin main` 与本地 HEAD 一致。
下面每条都能在干净 clone 上照着重跑。

### 一、逐票核了什么

| 票 | 对照的判据 | 查的文件 / 测试 | 结论 |
|---|---|---|---|
| 01 诊断链改管道 | 归因六规则、与 `diagnose()` 生效值一致、卡面无规则句/图例/列标题、<480px 不横滚、`role` + aria、关卡 | `src/client/attribution.ts:73` `attribute()`；`test/client-attribution.test.mjs` 14 条（含 `哨兵：归因与诊断报告对同一份快照给出相同生效值`、`大小写与空白不改变归属`、`面板 bundle 里的归因与 lib/client/attribution.js 同源`） | 达成 |
| 02 效率卡四块图形 | 堆叠条真实比例、总和 0 退化、`off` 灰可辨、区间条三项共轴 `−60%…0`、卡面无表头与长标签、清零进 `⋯`、卡底只剩一行限定语、三态不出 NaN、紧凑不横滚 | `src/client/mini.ts:30` `modeSlices()`、`:47` `BAND_MIN`、`:59` `axisPercent()`；`src/client/panel.tsx:902` `ModeStack`、`:951` `SavingsBands`；`test/client-mini.test.mjs` 9 条；`test/client-efficiency-surface.test.mjs` 3 条 | 达成 |
| 03 说明收进 `?` | 七个 `?` 全在、删掉的句子一句不丢、术语统一 | `src/client/panel.tsx:340` `HelpBubble`；`test/client-panel-surface.test.mjs:76`（`HELP_ENTRIES` 七项 + 诚实说明四项）；`test/client-efficiency-surface.test.mjs:48`（`IN_HELP` 五句正面清单）；`test/surface.mjs` 的 `withoutHelp()` | 达成 |
| 04 收口 | 两份设计文档、CHANGELOG、四张 `final-*.png`、遗留登记、全关卡 | `docs/design/ponytail-settings-ui.md` §4/§5/§8.1、`docs/design/ponytail-efficiency-ui.md`、`CHANGELOG.md` 的 `[0.4.0]`、`docs/design/prototype-shots/final-{clean,env,invalid,compact}.png`、票 04 正文「## 遗留风险登记」 | 达成 |
| 05 判据缺陷 | 非法值不再被报成生效、双合法同源不变、无 base 场景不变 | `src/l0/diagnosis.ts:157-159`；`test/client-diagnosis.test.mjs` 的新增 3 条 | 达成（本批顺带修，规格原本划在 Out of Scope，已单独成票） |
| 06 三处视觉未验证 | 暗色五态可分、320px 无横滚、`?` 文字不被截 | `docs/design/prototype-shots/verify-{dark,320,help}.png`；harness 量测（`scrollWidth===clientWidth`、管道 12×46、卡片 320×213 无截断） | 达成，并顺带修掉 320px 档位折行（`8312aca`） |

### 二、逐条用户故事

| # | 证据 |
|---|---|
| 1 阅读顺序即取值顺序 | `panel.tsx:683` 容器按 `attribution.levels` 恒序渲染；`test/client-attribution.test.mjs:30` 断言顺序 |
| 2 生效值是实心点上的大字 | `panel.tsx:551` `levelValue()`：`hit` 走 22px/600 等宽；`pipeLabel()` 的 aria 也说「生效」 |
| 3 非法值原值标红、该层不通 | `panel.tsx:574` `PipeSegment` 在 `invalid` 画断口；`levelValue` 用 danger 色 + 600（无删除线）；`test/client-attribution.test.mjs:59` |
| 4 环境变量赢时上下层虚掉 | `test/client-attribution.test.mjs:65`；截图 `final-env.png` |
| 5 干净安装底层淡到几乎看不见 | `panel.tsx:562` `past → opacity 0.32`；`test/client-attribution.test.mjs:92`「兜底没轮到，不是被覆盖」 |
| 6 层名写「环境变量」 | `diagnosis.ts` 的 `LABELS`；`attribution.ts` 的 `LABELS` |
| 7 层名「配置文件」、出处进 `?` | `LABELS.patch`；`panel.tsx` 的 `DIAGNOSIS_LOCATION` 进 `诊断链怎么读` |
| 8 「打开配置文件」还在原位 | `panel.tsx` 诊断卡卡头动作位；`test/client-*` 未删该按钮 |
| 9 `?` 里能看到变量名与补丁路径 | `诊断链怎么读` 内含 `PONYTAIL_DEFAULT_MODE`、`cordis.patch.yml → ponytail-58fly.config.defaultMode`、`src/l0/mode.ts → DEFAULT_MODE` |
| 10 卡面无备注文字 | `test/client-panel-surface.test.mjs:43`、`:53`（效率侧）；`withoutHelp()` 削 `?` 后扫描 |
| 11 主数字是受管轮次 | `panel.tsx` ① 块 `PRIMARY_NUMBER` + `snapshot.managedTurns` |
| 12 环里 `75%`、旁边 `96 / 128` | `panel.tsx` ① 块 `Ring` 后紧跟 `{group(injections)} / {group(managedTurns)}`；`test/client-panel-surface.test.mjs:87` 守住。**这一条在第一次自检时只有前半句，本次已补，`811b3e9`** |
| 13 一条堆叠条画完四档 | `panel.tsx:902` `ModeStack` + `modeLegend()`；截图四张都可见 |
| 14 `off` 后挂 `?` | `panel.tsx:928` `HelpBubble label="off 那段灰条是什么"` |
| 15 三行共用一根横轴 | `panel.tsx:951` `SavingsBands`，轴端 `BAND_MIN/BAND_MAX` 写死；`test/client-mini.test.mjs:36`、`:44` |
| 16 卡面只写「上游基准，非本机测量」 | `panel.tsx` 卡底；`test/client-efficiency-surface.test.mjs:53` 禁掉长标题「比没用 ponytail 的情况」 |
| 17 `?` 里给推算基数与链接 | `基准推算的依据` 里的 `BASELINE_CAVEAT` + `baselineBasis(...)` + `BASELINE.outputTokens.source` |
| 18 三个杂项压成一行 | `panel.tsx` ③ 块 `MONO_LINE`；口径进 `这一行的三个量怎么算` |
| 19 清零进 `⋯` 且二次确认 | `panel.tsx` 卡头 `Menu`；`test/client-efficiency-surface.test.mjs:58` |
| 20 420px 不横向滚动 | harness 四列 `scrollWidth === clientWidth`（518/518/518/418）；截图 `final-compact.png` |
| 21 `role="group"` + 说全三层结局的 aria | `panel.tsx:683` + `pipeLabel()`；`test/client-panel-surface.test.mjs:48` 断言 `role="group"` 且禁 `role="img"`、aria 含「没赢」「不是有效档位」 |
| 22 暗色下三态分得开 | 只用 `--dsw-alias-state-*` / `--dsw-alias-border-l3` / `--dsw-alias-label-*`，无写死色值（`verify` 扫 `panel.tsx`/`charts.tsx` 零命中）。**票 06 补了 `verify-dark.png`**：`bg rgb(30,31,33)` 下五态可辨 |
| 23 数据结构与口径一行没动 | `git diff 3fb35a1..8312aca -- src/stats` 为空；`src/l0/` 只有 `diagnosis.ts`（票 05 的缺陷修复），`StatsStore`/`projectSavings`/`BASELINE` 无改动 |
| 24 verify 的诚实纪律哨兵保留 | `pnpm verify` 通过（34 源文件 / 119 产物）；`test/client-efficiency-surface.test.mjs` 仍含「不许写你省了」那一组 |
| 25 CHANGELOG 说清是呈现方式变了 | `CHANGELOG.md` 的 `[0.4.0]`「这一版只改呈现方式，数据口径一条没动」 |
| 26 归因规则单独记在规格里、有单测钉住 | 本规格「归因规则（本次的核心契约）」六条 + `test/client-attribution.test.mjs` 14 条 |

### 三、与规格的两处偏差（都不是缩减，写在这里免得复核时对不上）

1. **`charts.tsx` 没有新增 `Pipeline` / `RangeBars`**。规格原写在这两个文件里，实现落到 `panel.tsx` 的 `PipeSegment` / `SavingsBands`——两者都要读 `compact`、要跟层名和值同格对齐，跟卡片排版绑死；`charts.tsx` 现在只剩 `Ring`（`BarList` 已删）。纯函数部分按规格放进新文件，但是 `src/client/mini.ts` 而不是塞进 `attribution.ts`：归因和坐标换算混在一处，测试断言会互相干扰。
2. **`?` 是七个不是五个**。规格说「五个 `?` 承载全部说明文本」，实现时把「`off` 灰段是什么」和「这一行的三个量怎么算」拆开挂——一句管三件事的 `?` 反而要读两遍。

### 四、检查（在 `8312aca` 上跑，干净工作区）

```
pnpm typecheck   → exit 0
pnpm build       → exit 0（lib/client.js 61731 bytes + lib/client/{attribution,mini}.js）
pnpm test        → # tests 307 / # pass 307 / # fail 0
pnpm verify      → verify 通过（34 个源文件，119 个产物文件，1 条提醒）
```

`git status --porcelain` 空；只有一条分支 `main`；无 stash；无未合并分支独有的提交。
`lib/`、`*.tgz`、`.dsh-*-cache/` 是 gitignore 的构建产物与宿主缓存，不属于本次交付面。

### 五、遗留

用户故事 22 当初写的「token 层面成立、没有暗色截图」，现在已经不是空口：票 06 出了三张验收图。

| 项 | 处置 |
|---|---|
| 暗色主题五态是否分得开 | 票 06 已做：`verify-dark.png`，`bg rgb(30,31,33)` / `fg rgb(242,243,245)`，实心 / 虚线空心 / 淡出 / 断口红 / 虚线问号五态可辨 |
| 320px 窄栏是否横滚 | 票 06 已做：`verify-320.png`，两列 `scrollWidth === clientWidth === 318`，管道 12×46、命中值 19px |
| `?` 悬浮卡是否被截 | 票 06 已做：`verify-help.png`，最长一段 319 字落在 320×397 里，无省略号、无滚动条 |
| 320px 档位标签折成两行 | 票 06 查出来的，当场修了：窄栏只留英文档名（`8312aca`） |
| `diagnose()` 判据缺陷 | 票 05 修复（`76a180b`），不属于遗留 |

票 06 自己也记了一条边界：`?` 的**浮层定位**（往右探出还是被视口夹紧）由宿主 `HoverCard` 决定，harness 的替身只能证明「卡片宽度与文字不截断」。这不是留给他人的缺口，是面板不该管的事。

## 进度
