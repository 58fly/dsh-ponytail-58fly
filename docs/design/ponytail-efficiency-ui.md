# Ponytail 效率区块 · UI 规范

> 05 票的产出。给 06（SVG 图表与面板接线）与 07（`/ponytail-gain` 文案）用。
> 一句话：**只展示可验证的计数事实，百分比永远带着「基准推算」和出处。**

## 0. 硬约束（会被 verify 与 grep 钉住）

| 约束 | 检查方式 |
|---|---|
| 不出现写死的颜色 | `grep -nE '#[0-9a-fA-F]{3,8}' src/client/*.tsx` 必须零命中 |
| 颜色只走 `--dsw-alias-*` | 新增颜色引用必须是下表列出的 token 名 |
| 不新增依赖 | `package.json` 的 `dependencies` 保持为空/不变；图表是手写 SVG |
| 不承诺实时 | 文案里不出现「实时」「自动更新」；只有「刷新」按钮与「数据截至 …」 |
| 不写「你省了 X」 | `grep -rn "你省了" src/ docs/ skills/` 零命中 |

## 1. 信息层级（一屏内三块，从主到次）

```
┌─ 效率 ───────────────────────────── 数据截至 19:04 · [刷新] ┐
│                                                              │
│  本机运行期累计：受管 128 轮 · 真正注入 96 次 · 切档 7 次      │  ← 主行（一行三数）
│                                                              │
│  ┌ 环形 75% ─┐   按档位分布（横向条）                          │
│  │ 注入率    │   off   ▍ 12                                    │
│  └──────────┘   lite  ▍▍▍ 38                                  │
│                 full  ▍▍▍▍▍ 71                                │
│                 ultra ▍ 7                                     │
│                                                              │
│  比没用 ponytail 的情况（基准推算）                            │
│  输出 token   约 −45%   [−54%, −35%]                          │
│  成本         约 −26%   [−36%, −16%]                          │
│  耗时         约 −41%   [−49%, −32%]                          │
│  基线：上游 39 任务 × 5 次 × 三臂，Claude Code + Opus 5.5 · 方法论 ↗ │
│                                                              │
│  [清零]                                                       │
└──────────────────────────────────────────────────────────────┘
```

- **主数字**：受管轮次（`managedTurns`）。它是「插件到底管了多少」的唯一不需要解释的数字。
- **同权重副数字**：注入次数（`injections`）、切档次数（`modeSwitches`）、`/ponytail-*` 调用次数（`commandCalls`）、注入字节（`injectedBytes`，格式化成「≈ N KB」）。
- **第二层**：注入率环形 + 按档位横向条。
- **第三层**：基准推算三行 + 基线出处 + 清零。
- **不进面板、只进命令**：`firstAt` / `lastAt` 的完整时间戳（面板只显示「数据截至 HH:MM」）、`revision`。

`受管轮次 − 注入次数` 不单独显示成第四个数字：它由前两个数自然读出，再列一个「未注入轮次」只会让人怀疑口径。

## 2. 图形选型（逐项定案）

| 图形 | 要不要 | 理由 |
|---|---|---|
| **环形（注入率）** | 要 | 只有两个分量（注入 / 未注入），环形一眼看出「说出口的比例」。直径 64px，笔画 8px，起点 12 点方向顺时针。 |
| **横向条（按档位分布）** | 要 | 四个档位的相对量，条形比饼图好读；同时也是「你在哪档待得最多」的答案。条高 8px，`--dsw-radius-sm` 圆角，行间距 6px。 |
| **迷你折线（近 7 天趋势）** | **不要** | 需要按天分桶 → 需要落盘 → 与 Q12′「不落盘」直接冲突；不落盘的话折线只能画本次运行，而本次运行通常不足一天，折线退化成一条直线，是纯装饰。 |
| 堆叠面积 / 桑基 / 仪表盘 | 不要 | 装饰性，且都要新依赖或大量 SVG 代码。 |

**空数据时**：环形不画（画一个 0% 的空环等于宣称「注入率 0%」，而真相是「还没有轮次」），横向条四条都渲染成空槽 + 右侧显示 `0`。

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
- **区块与既有内容的关系**：与「优先级诊断链」**同级**——用 `<h3>`，不套卡片、不加重边框。整块面板已经有三个 `<h2>/<h3>` 层级，再加一层卡片会碎。
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

**BarList — 每条 `height: 8`，容器 `display:flex; flex-direction:column; gap:6`。**

```
[标签 36px 固定宽][槽 flex:1 背景 border-l3][右侧数值 28px 右对齐 12px 字号]
填充宽度 = value / max(values) * 100%   // max 为 0 时全部 0
```

- 填充用 `<div>` + `width: pct%`，**不必上 SVG**：条形没有曲线，div 更短也更好测。
- 标签固定 `off / lite / full / ultra`，永远四条全出，零值也显示 `0`。

## 6. 基线标注的呈现

**三行定值表，不做区间条。** 一行一个指标：

```
输出 token   约 −45%    [−54%, −35%]
```

- 左侧指标名（12px，`label-secondary`），中间「约 −45%」用主数字字阶的 14px 500 权重（这是唯一允许出现在数字位的负号），右侧区间 11px `label-tertiary`。
- **不用区间条**：条形会让人把它读成「进度」或「确定性」，而这里是**别人家基准的范围**，不是本机测得的。文字区间最不容易被误读。
- 三行只出 **outputTokens / cost / time** 三项。`loc`（代码行数）与 `gzip` 面积没法归因到「本机这些轮次」，`turns` 与 `cheaperOnTasks` 是基准本身的统计量，都不进面板。
- 「**基准推算**」用一个 `Tag tone="quiet"` 放在第三层标题右侧；第三层标题原话固定为：`比没用 ponytail 的情况（基准推算）`。
- **出处行**（11px）：`基线：上游 39 任务 × 5 次 × 三臂，Claude Code + Opus 5.5 · ` + 一个 `a` 链到 `https://github.com/DietrichGebert/ponytail/blob/main/benchmarks/results/2026-10-07-agentic.md`，颜色 `--dsw-alias-link`，`target="_blank"` + `rel="noreferrer"`。
- **必须出现的限定语**（就放在出处行同一行，不折叠）：`这是上游基准，不是本机测量。`
- 系数与区间全部从 `src/stats/baseline.ts` 读，面板里**不出现任何裸系数**。

## 7. 三态文案（逐字照抄）

| 态 | 触发 | 显示 |
|---|---|---|
| 加载中 | `status === 'loading'` | `正在读取统计…`（12px，`label-secondary`，不占位骨架） |
| **空态** | `managedTurns === 0` | 标题行显示 `本机运行期累计：还没开始计数`；正文一句：`发一条消息就会开始记：每个经过 Ponytail pre-step 的轮次都算一次。`；图表区只画空槽；第三层照常显示（基准表与数据无关） |
| 读不到 | `connection.rpc` 抛错 / 通道 404 | `统计暂时读不到（宿主没提供这个通道，或插件刚重启）。` + `[重试]` 按钮；本地已缓存的数字若存在，继续显示并标 `数据截至 HH:MM` |
| 通道不支持 | `ctx.get('connection')` 为 `undefined` 或 `rpc.call` 抛「未知通道」 | 与「读不到」同一句，不额外解释；**绝不**把错误对象原文甩给用户 |
| 清零中 | 二次确认后 awaiting | `清零` 按钮 disabled + 文案变 `正在清零…` |
| 面板不可用 | 既有 `configForms === undefined` | 整块面板（含效率区）不出现，沿用现状，不新增降级 |

**空态与错误态的区别必须可见**：「还没开始计数」是正常的；「读不到」是异常的。两者都用一句完整的话，不用感叹号、不用警告三角。

## 8. 响应式（设置页窄栏 360–420px）

- 主行三数在 `< 420px` 时**纵向堆叠**（每行「数字 + 单位 + 说明」），不做横向滚动。
- 环形 + 横向条并排的容器用 `flex-wrap: wrap`：窄栏下环形在上（居中）、条在下（满宽）。
- 横向条最小可用宽度 `160px`；低于此值标签从 36px 收到 28px。
- 基准三行在窄栏下右对齐的区间**换到下一行**，不截断（区间被截断就等于骗人）。
- 所有块都不出现横向滚动条。

## 9. 清零按钮与二次确认

- 位置：区块最后一行，左对齐，`Button variant="outline" size="sm"`（与「清除用户层覆盖」同款）。
- 文案：`清零统计`（不是「重置」，避免与档位的「清除用户层覆盖」混淆）。
- 二次确认用官方 `Modal` + `RiskConfirmation` 语义：
  - 标题：`清零本机统计？`
  - 正文：`受管轮次、注入次数、注入字节、切档次数和命令调用次数都会归零，无法撤销。配置和档位不受影响。`
  - 按钮：`取消` / `清零`（危险色走 `Tag tone="danger"` 的语义，主按钮用默认 outline 不用 primary）。
- 成功后：一行 `已清零，从 0 重新计数。`（`Tag tone="success"` + 文字），3 秒后自动消失由宿主 Toast 负责，面板里不留常驻提示。

## 10. 命令侧（给 07 对齐）

`/ponytail-gain` 输出同一份数据，纯文本块，顺序与面板一致：主数字 → 注入率 → 按档位分布 → 基准推算三行 → 出处行 + 限定语。不同点只有两处：命令里可以印完整时间戳（`从 18:47 开始计数`），以及命令末尾固定一行 `面板里有图形版：设置 → Ponytail → 效率。`

## 11. 验收 grep

```bash
grep -nE '#[0-9a-fA-F]{3,8}' src/client/panel.tsx src/client/charts.tsx   # 必须零命中
grep -rn '你省了' src/ docs/ skills/                                        # 必须零命中
grep -n '实时' src/client/panel.tsx src/client/charts.tsx                  # 必须零命中
```

三条都已在 `scripts/verify.mjs` 第 10b 组机器化，`pnpm verify` 会同时跑：
写死颜色与「实时」扫 `panel.tsx` / `charts.tsx` 两个文件；「你省了 / 实际节省」扫全部源码与技能正文，
白名单只有两处写禁令本身的位置（`src/stats/baseline.ts` 的注释、`skills/ponytail-gain/SKILL.md` 的警告）。
白名单按文件而不是按行——行号一改就漂，文件级白名单在新增出现时仍会报红。
`node scripts/verify.mjs --selftest` 里为本组喂了一条脏输入，扫描器漏报时 selftest 先红。

## 12. 实现台账（06 落地后回填）

- 二次确认没有引宿主 `Modal`：面板只用了 `Button` / `SegmentedControl` / `Tag` 三个 primitives，
  多引一个 `Modal` 会把宿主弹层容器也拖进客户端依赖面。改成**行内确认**——点「清零统计」后原地展开
  一句 `清零本机统计？` + 影响范围 + `取消` / `清零` 两个 outline 按钮。语义与 §9 相同（不可撤销、说清范围、
  危险动作不设 primary），代价是不遮挡内容，也不多一条宿主依赖。
- 清零成功的提示是常驻的一行 `Tag tone="success"`，没有接宿主 Toast：面板已经显示新的全零计数，
  再叠一条 3 秒消失的浮层只是重复。文案仍用 §9 的 `已清零，从 0 重新计数。`
- 注入率环的底环与进度弧只涂 `--dsw-alias-border-l3` / `--dsw-alias-state-business-primary` 两个变量；
  四档分布条四行同色（涂成四色会被误读成四个类别）。
- 主行五个指标在 `< 420px` 时按 flex-wrap 纵向堆叠，实测窄栏无横向滚动条。
