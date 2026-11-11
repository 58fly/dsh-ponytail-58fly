# Ponytail 效率区块 · UI 规范

> 本文只定**数据与图形语义**：颜色 token、字阶、三态文案、命令侧对齐、验收 grep。
> **面板形态（四块图形的排布、几何、`?` 的归属）以 `docs/design/ponytail-settings-ui.md` §5 与 §8.1 为准**，
> 本文不重复描述排布，改排布只改那一份。
> 一句话：**只展示可验证的计数事实，百分比永远带着「基准推算」和出处。**

## 0. 硬约束（会被 verify 与 grep 钉住）

| 约束 | 检查方式 |
|---|---|
| 不出现写死的颜色 | `grep -nE '#[0-9a-fA-F]{3,8}' src/client/*.tsx` 必须零命中 |
| 颜色只走 `--dsw-alias-*` | 新增颜色引用必须是下表列出的 token 名 |
| 不新增依赖 | `package.json` 的 `dependencies` 保持为空/不变；图表是手写 SVG |
| 不承诺实时 | 文案里不出现「实时」；面板开着时每 2 秒自己重读一次（订阅期间轮询，不是宿主推送），卡头仍只有「刷新」按钮与「数据截至 …」 |
| 不写「你省了 X」 | `grep -rn "你省了" src/ docs/ skills/` 零命中 |

## 1. 信息层级（卡内四块，从主到次）

```
┌─ 效率统计 ──────────────── 数据截至 19:04 · [刷新] · [⋯] ┐
│                                                          │
│  128 ?         ◯ 75% ?                                   │  ← ① 主数字 + 注入率环
│                                                          │
│  ███▏░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░     │  ← ② 四档堆叠条
│  off 12 · lite 38 · full 71 · ultra 7  ?                 │
│                                                          │
│  40.0 KB · 7 切档 · 21 命令  ?                            │  ← ③ 杂项一行
│                                                          │
│  输出  ▬▬▬▬▬▬▬                                           │  ← ④ 三行共轴区间条
│  成本      ▬▬▬▬▬▬                                        │
│  耗时   ▬▬▬▬▬▬▬▬▬                                        │
│        −60%                            0%                │
│                                                          │
│  上游基准，非本机测量  ?                                   │
└──────────────────────────────────────────────────────────┘
```

- **主数字**：受管轮次（`managedTurns`）。它是「插件到底管了多少」的唯一不需要解释的数字。
- 其余五个量（注入次数 / 注入字节 / 切档 / 命令 / 推算轮次）不各占一行：注入次数进了环，
  另外三个并进第 ③ 块的一行小字。**卡面上没有指标名**，名与口径都在 `?` 里。
- **不进面板、只进命令**：`firstAt` / `lastAt` 的完整时间戳（面板只显示「数据截至 HH:MM」）、`revision`。

`受管轮次 − 注入次数` 不单独显示成第四个数字：它由环自然读出，再列一个「未注入轮次」只会让人怀疑口径。

## 2. 图形选型（逐项定案）

| 图形 | 要不要 | 理由 |
|---|---|---|
| **环形（注入率）** | 要 | 只有两个分量（注入 / 未注入），环形一眼看出「说出口的比例」。直径 64px，笔画 8px，起点 12 点方向顺时针。 |
| **堆叠条（档位分布）** | 要 | 四个档位是同一份轮次被切开，堆叠才读得出「占比」；分开四条只读得出「谁最多」。条高 10px，四段无缝，`off` 灰、其余同色递减透明度。 |
| **迷你折线（近 7 天趋势）** | **不要** | 需要按天分桶 → 需要落盘 → 与 Q12′「不落盘」直接冲突；不落盘的话折线只能画本次运行，而本次运行通常不足一天，折线退化成一条直线，是纯装饰。 |
| **区间条（基准推算）** | 要 | 三行共用一条 `−60% … 0` 轴，长短才可比。只画区间与中点，不画「约 X%」的定值——定值会被读成测量结果。 |
| 堆叠面积 / 桑基 / 仪表盘 | 不要 | 装饰性，且都要新依赖或大量 SVG 代码。 |

**空数据时**：主数字照画 `0`（0 也是真的），环形不画进度弧，堆叠条退化成一条空槽，区间条三行不画、改印一句「还没有非 off 档位的轮次」。

## 3. 字阶与栅格

宿主没有暴露字号 token，官方 primitives 用的是固定 px 阶。沿用同一套：

| 用途 | 字号 / 行高 | 字重 | 颜色 token |
|---|---|---|---|
| 区块标题「效率」 | 与现有 `<h3>` 一致（继承，不覆盖） | 600 | `--dsw-alias-label-primary` |
| 主数字（128） | 20px / 28px | 600 | `--dsw-alias-label-primary` |
| 主数字单位（轮 / 次） | 12px / 18px | 400 | `--dsw-alias-label-tertiary` |
| 副数字 | 14px / 22px | 500 | `--dsw-alias-label-primary` |
| 说明文字、图例、轴标签 | 12px / 18px | 400 | `--dsw-alias-label-secondary` |
| 极小注脚（基线出处、数据截至） | 11px / 17px | 400 | `--dsw-alias-label-tertiary` |

- **数字用等宽数字**：`fontVariantNumeric: 'tabular-nums'`，避免刷新时数字跳动。
- **间距**：区块内 `gap: 12`；主行与图表之间 `gap: 16`；卡片内边距 `padding: 12`（与现有面板的 `gap: 12` 同一档）。
- **区块与既有内容的关系**：与「优先级诊断链」**同级**——用 `<h3>`，不套卡片、不加重边框。整块面板已经有三个 `<h2>/<h3>` 层级，再加一层卡片会碎。（**已被新规范取代**：本次重构改为三张独立卡片、清零移到卡底左对齐，见 `docs/design/ponytail-settings-ui.md`。原句保留，供对照演变。）
- **分隔**：区块顶部 `borderTop: '0.5px solid var(--dsw-alias-border-l3)'` + `paddingTop: 12`，与上面的诊断链分开。0.5px 与 `Tag` 的边框一致。
- **圆角**：仅图表条与按钮用 `--dsw-radius-sm` / `--dsw-radius-md`，容器不加圆角。

## 4. 图表颜色（只用 token）

| 语义 | token |
|---|---|
| 环形「已注入」弧 / 横向条已填充 | `--dsw-alias-state-business-primary` |
| 环形底环 / 横向条空槽 | `--dsw-alias-border-l3` |
| 数字与标题 | `--dsw-alias-label-primary` |
| 说明与图例 | `--dsw-alias-label-secondary` |
| 注脚 | `--dsw-alias-label-tertiary` |
| 「基准推算」标签 | 复用 `Tag` 组件，`tone="quiet"` |
| 错误态 | `--dsw-alias-state-error-primary` |
| 分隔线 / 环比边框 | `--dsw-alias-border-l3` |

**四档不用四种颜色**：四个档位是同一条轴上的量，涂成四个色会被误读成四个类别。横向条全部用 `--dsw-alias-state-business-primary`，靠长度区分。

## 5. SVG 结构草图（06 照这个写）

**Ring — `viewBox="0 0 64 64"`，`width/height: 64`，`role="img"` + `<title>`。**

```
<circle cx=32 cy=32 r=28  stroke=--dsw-alias-border-l3  stroke-width=8 fill="none" />
<circle cx=32 cy=32 r=28  stroke=--dsw-alias-state-business-primary stroke-width=8
        fill="none" stroke-linecap="round"
        stroke-dasharray="{ratio*175.93} 175.93"
        transform="rotate(-90 32 32)" />
<text x=32 y=36 text-anchor="middle" font-size=16 font-weight=600
      fill=--dsw-alias-label-primary>{pct}%</text>
```

- 周长 `2πr = 175.93`；`ratio = injections / managedTurns`，`managedTurns === 0` 时不渲染进度环。
- 环内文字用 `%` 整数（四舍五入）。旁边另起一行 12px 说明「注入率 · 96 / 128」。

**堆叠条 — `display:flex`，`height: 10`，轨道 `--dsw-alias-bg-layer-3`，`overflow: hidden`。**

```
轨道  100% 宽 × 10px
每段  flex: 0 0 (value / total * 100)%      ← 不是 width：段是 flex 子项
      off  → --dsw-alias-border-l3
      lite → business-primary @ 0.32 / full @ 0.62 / ultra @ 1
total === 0 → 一个段都不画，留空槽
```

- **不上 SVG**：段全是矩形，div 更短也更好测（`test/client-mini.test.mjs` 直接测比例函数）。
- 四段顺序固定 `off / lite / full / ultra`，与档位强弱一致；零值段不渲染（零宽段会画出 1px 脏边）。

**区间条 — 每行 `display:flex`，行名 32px 固定，横槽 `flex:1; height:14`。**

```
绝对定位：条  top=5  height=4  left=(from*100)%  width=((to-from)*100)%
          中点 top=0  height=14  left=(center*100)%  width=2  margin-left=-1
轴：仅在条下方写两端 −60% / 0%，中间不画刻度线
```

- 条的 `left/width` 由 `axisPercent()` 把比例域夹到 `[BAND_MIN, BAND_MAX] = [-60, 0]` 再换算，
  端点外的一律贴边，不溢出横槽。
- `from > to` 时先排序，宽度不会是负数。

## 6. 基线标注的呈现

**三行共轴区间条 + 卡底一行限定语。**

- 只画区间与中点，**不画「约 −45%」这类定值**：定值会被读成「本机测出来的」。
- 三行只出 **outputTokens / cost / time** 三项。`loc`（代码行数）与 `gzip` 面积没法归因到「本机这些轮次」，`turns` 与 `cheaperOnTasks` 是基准本身的统计量，都不进面板。
- 卡底只留一行 11px：`上游基准，非本机测量`，后跟一个 `?`。
- `?` 里依次是：`BASELINE_CAVEAT` 原文、`baselineBasis(activeTurns, tokensPerTurn)`（推算基数）、
  上游方法论链接（`--dsw-alias-link`、`target="_blank"` + `rel="noreferrer"`）、以及一句
  `三行区间取自上游 39 个任务、每个 5 次、三臂对照的结论，不是这台机器上发生的事。`
- **「基准推算」Tag 与「比没用 ponytail 的情况（基准推算）」长标题都不再上卡面**。
- 系数与区间全部从 `src/stats/baseline.ts` 读，面板里**不出现任何裸系数**。

## 7. 三态文案（逐字照抄）

| 态 | 触发 | 显示 |
|---|---|---|
| 加载中 | `status === 'loading'` | `正在读取统计…`（12px，`label-secondary`，不占位骨架） |
| **空态** | `managedTurns === 0` | 主数字 `0`、环不画进度弧、堆叠条空槽、杂项一行全 0；区间条位置印一句 `还没有非 off 档位的轮次，所以没有可推算的量。`。「每个经过 pre-step 的轮次都算一次」这句进主数字的 `?` |
| 读不到 | `connection.rpc` 抛错 / 通道 404 | `统计暂时读不到（宿主没提供这个通道，或插件刚重启）。` + `[重试]` 按钮；本地已缓存的数字若存在，继续显示并标 `数据截至 HH:MM` |
| 通道不支持 | `ctx.get('connection')` 为 `undefined` 或 `rpc.call` 抛「未知通道」 | 与「读不到」同一句，不额外解释；**绝不**把错误对象原文甩给用户 |
| 清零中 | 二次确认后 awaiting | 菜单项文案变 `正在清零…` 且 disabled |
| 面板不可用 | 既有 `configForms === undefined` | 整块面板（含效率区）不出现，沿用现状，不新增降级 |

**空态与错误态的区别必须可见**：「还没开始计数」是正常的；「读不到」是异常的。两者都用一句完整的话，不用感叹号、不用警告三角。

## 8. 响应式（设置页窄栏 360–420px）

- 主数字与环是 `flex-wrap: wrap` 的一行：窄栏下环换到下一行，主数字不被压。
- 堆叠条满宽，永不加最小宽度：它是比例条，压窄只是变短，不丢信息。
- 区间条的行名 32px 固定，横槽吃掉剩余宽度；窄栏下横槽仍 ≥ 200px，三行照样可比。
- 所有块都不出现横向滚动条（`scrollWidth === clientWidth`，harness 里实测四列）。

## 9. 清零入口与二次确认

- 位置：**卡头 `⋯` 菜单**，菜单里只有一项 `清零统计`（不用「重置」，避免与档位的「清除用户层覆盖」混淆）。
- 点菜单项**不执行**，只展开二次确认；确认行写在卡头下方，不弹模态：
  - `清零本机统计？`
  - `受管轮次、注入次数、注入字节、切档次数和命令调用次数都会归零，无法撤销。配置和档位不受影响。`
  - `取消` / `清零` 两个 outline 按钮（危险动作不用 primary）。
- 成功后常驻一行 `Tag tone="success"` + `已清零，从 0 重新计数。`，不接宿主 Toast。

## 10. 命令侧（给 07 对齐）

`/ponytail-gain` 输出同一份数据，纯文本块，顺序与面板一致：主数字 → 注入率 → 按档位分布 → 基准推算三行 → 出处行 + 限定语。不同点只有两处：命令里可以印完整时间戳（`从 18:47 开始计数`），以及命令末尾固定一行 `面板里有图形版：设置 → Ponytail → 效率统计。`（卡片标题定名「效率统计」，见 `ponytail-settings-ui.md`）。

## 11. 验收 grep

```bash
grep -nE '#[0-9a-fA-F]{3,8}' src/client/panel.tsx src/client/charts.tsx   # 必须零命中
grep -rn '你省了' src/ docs/ skills/                                        # 必须零命中
grep -n '实时' src/client/panel.tsx src/client/charts.tsx                  # 必须零命中
```

三条都已在 `scripts/verify.mjs` 第 10b 组机器化，`pnpm verify` 会同时跑：
写死颜色与「实时」扫 `panel.tsx` / `charts.tsx` 两个文件（`src/client/index.ts` 里说明轮询的注释不在扫描面内，它讲的是实现，不是卡面文案）；「你省了 / 实际节省」扫全部源码与技能正文，
白名单只有两处写禁令本身的位置（`src/stats/baseline.ts` 的注释、`skills/ponytail-gain/SKILL.md` 的警告）。
白名单按文件而不是按行——行号一改就漂，文件级白名单在新增出现时仍会报红。
`node scripts/verify.mjs --selftest` 里为本组喂了一条脏输入，扫描器漏报时 selftest 先红。

## 12. 实现台账（06 落地后回填）

- 二次确认没有引宿主 `Modal`：面板只用了 `Button` / `SegmentedControl` / `Tag` / `Menu` / `HoverCard` 五个 primitives，
  多引一个 `Modal` 会把宿主弹层容器也拖进客户端依赖面。改成**行内确认**——点菜单项后原地展开
  一句 `清零本机统计？` + 影响范围 + `取消` / `清零` 两个 outline 按钮。语义与 §9 相同（不可撤销、说清范围、
  危险动作不设 primary），代价是不遮挡内容，也不多一条宿主依赖。
- 清零成功的提示是常驻的一行 `Tag tone="success"`，没有接宿主 Toast：面板已经显示新的全零计数，
  再叠一条 3 秒消失的浮层只是重复。文案仍用 §9 的 `已清零，从 0 重新计数。`
- 注入率环的底环与进度弧只涂 `--dsw-alias-border-l3` / `--dsw-alias-state-business-primary` 两个变量；
  堆叠条的三档同色、靠透明度分深浅（涂成四色会被误读成四个类别）。
- 主数字与环是 `flex-wrap: wrap`；四列实测 `scrollWidth === clientWidth`（518/518/518/418）。
- 0.4.0 起：清零入口在卡头 `⋯` 菜单、四档是堆叠条、基准是共轴区间条。
  口径未变——同源 `projectSavings`、零轮次不画三行、限定语必印。
