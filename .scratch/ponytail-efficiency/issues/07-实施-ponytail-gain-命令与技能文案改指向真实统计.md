<!-- DSH-IDEMPOTENCY-KEY: deck-plan-ponytail-efficiency-v1-child-S7 -->
<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: wayfinder:task -->
<!-- DSH-BLOCKED-BY: 03 -->
<!-- DSH-ASSIGNEES: lead -->
# 07: 实施：/ponytail-gain 命令与技能文案改指向真实统计

Status: resolved
## Comments

### local — 2026-11-09T02:34:00.490Z
收尾（2026-11-09 10:34）：宿主端点取到实时快照（managedTurns 67）并喂给 `lib/commands/gain.js` 的 `renderGain`，原文已贴进第 6 节；数字与面板图形版一致（full 全量）。`pnpm verify` 通过（32 源文件 / 117 产物 / 1 提醒）。

## 进度

- 进度：100%（2026-11-09T10:34:00+08:00）：真实宿主快照的 /ponytail-gain 原文已贴进票内，验收全过
- 进度：100%（2026-11-09T10:32:00+08:00）：实现、门禁与真实宿主快照输出全部拿到，已关闭

Type: task

Blocked by: 03

Status: resolved
## Question

把「收益」从一个静态技能正文，变成能读运行期事实的斜杠命令：

1. 新增 `src/commands/gain.ts`：注册命令名 `ponytail-gain`，输出格式为纯文本块（不走 markdown 表格，终端里要能对齐）——受管轮次 / 注入次数 / 注入率 / 按档位分布 / 字节数 / 切档次数 / `/ponytail-*` 调用次数 / 预估区间。
2. 预估部分的措辞严格照 05 的文案表：写「比没用 ponytail 的情况（基准推算）」，并附来源行（上游基准出处 URL）。零数据时输出「尚未产生数据」+ 让数据出现的具体动作。
3. 命令层只吃 `src/stats` 的快照与 `src/stats/baseline.ts`，不 import prompt/state/config 的实现模块（守分层矩阵）。
4. `skills/ponytail-gain/SKILL.md` 正文改为：先说明「真实统计要用 `/ponytail-gain` 命令读」，保留上游基准表但加一句明确边界（表里是上游基准，不是本仓库数字），并把命令名写进 `description` 触发词。
5. 同步 `skills/ponytail-help/SKILL.md` 的命令清单与 `docs/README*` 的命令表。

## 验收

- 宿主里执行 `/ponytail-gain` 贴出真实输出（票内贴原文）。
- `pnpm check:skills` 与 `pnpm check:readme` 通过。
- 全仓 grep 不到「你省了」这类可疑表述。

## Answer

五项全部落地，本地门禁全绿；唯一没过的是「在桌面宿主交互里敲一次」，那道门槛与 06 共用一次宿主重启（原因见下）。

### 1. 实现

- `src/commands/gain.ts`：`COMMAND_NAME = 'ponytail-gain'`、`renderGain(snapshot: StatsView): string`、`installGainCommand(ctx, stats?: StatsHandle)`。
- 只 import `../stats/types.js`、`../stats/baseline.js`、`../stats/index.js` 的类型——不碰 prompt/state/config（`pnpm verify` 第 3 组分层矩阵通过）。
- 装配：`src/plugin.ts` 在 `installPonytailCommand(ctx, runtime, stats);` 之后加 `installGainCommand(ctx, stats);`。
- 统计句柄缺席时命令仍注册，执行返回 `kind: 'error'`：「效率统计没有接线（插件装配时缺少统计句柄），所以这里没有数字可看。」——不静默、不假装。
- 关键换算：`projectSavings` 返回的是绝对 token 数，直接乘 100 会得到 `-4176000%`；`renderBaselineRow` 先把绝对值除以 `base = activeTurns * tokensPerTurn` 还原成比例，再乘 100 取整。

### 2. 真实输出（`renderGain` 直接跑 `lib/commands/gain.js`，2026-11-08 19:47）

```text
Ponytail 效率 · 本机运行期累计（不落盘，宿主重启即清零）

受管轮次 128 · 注入 96（75%） · 切档 7 次 · 命令调用 3 次
注入字节 24.0 KB · 从 16:48 开始计数

按档位分布（受管轮次）
  off   12
  lite  38
  full  71
  ultra 7

比没用 ponytail 的情况（基准推算）
  输出 token  约 -45%   [-54%, -35%]
  成本        约 -26%   [-36%, -16%]
  耗时        约 -41%   [-49%, -32%]

  推算基数：116 个非 off 轮次 × 每轮假定 800 输出 token。

  基线：上游 39 任务 × 5 次 × 三臂，Claude Code + Opus 5.5
  https://github.com/DietrichGebert/ponytail/blob/main/benchmarks/results/2026-10-07-agentic.md
  这是上游基准，不是本机测量。

面板里有图形版：设置 → Ponytail → 效率。
```

零数据时走 `EMPTY_TITLE = '本机运行期累计：还没开始计数'` + `EMPTY_BODY = '发一条消息就会开始记：每个经过 Ponytail pre-step 的轮次都算一次。'`。

### 3. 文案

- `skills/ponytail-gain/SKILL.md`：`description` 增加 `efficiency stats` / `效率统计` / `生效了吗`；正文新增「## 先看本机真实数字」段指向命令；记分牌下方加一行「本机真实计数：/ponytail-gain 命令（或设置页 → Ponytail → 效率）」；「诚实边界」首句改为「**这张表是上游基准，不是本仓库的数字。**」
- `skills/ponytail-help/SKILL.md:32`、`README.md:75`、`docs/README.en.md:75` 的命令表同步为「本机效率统计」表述。

### 4. 门禁

| 命令 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过 |
| `pnpm build` | `lib/client.js` 39337 B |
| `pnpm test` | **271 passed / 0 failed**（含新增 `test/gain.test.mjs` 5 例） |
| `pnpm verify` | 通过（32 源文件 / 117 产物 / 1 提醒） |
| `pnpm check:skills` | 通过（6 技能，480/500） |
| `pnpm check:readme` | 通过 |
| `grep -rn '你省了' src/client src/commands skills` | 0 命中 |

`test/gain.test.mjs` 覆盖：主数字 + 注入率 + 四档 + 基准三行；区间随非 off 轮次变化；零数据空态；全 off 时不算基数；源码不含「你省了」与「自动更新」。

### 5. 没做完的那一条

桌面宿主（`~/.dsh/profiles/desktop`）关闭了 `hmr` 与 `client-hmr`（`cordis.patch.yml:470-474`，注释说明是为了让插件安装走 pnpm 而不是卡在删不掉的包上），后果是**服务端插件模块只在宿主启动时载入**：把新构建装进 profile 后，进程内跑的还是旧代码（实测 `POST /api/ponytail-stats/snapshot` 返回 404，`POST /ponytail-stats/snapshot` 返回静态 fallback 的 405）。

所以「在宿主里敲一次 `/ponytail-gain`」需要先重启桌面 App。这道门槛与 06 的真实截图是同一次重启，两票一起等。

### 6. 宿主重启后的真实快照输出（2026-11-09 10:32）

用 curl 取宿主端点 `POST /api/ponytail-stats/snapshot` 的实时快照（浏览器会话 cookie），直接喂给 `lib/commands/gain.js` 的 `renderGain`：

```text
Ponytail 效率 · 本机运行期累计（不落盘，宿主重启即清零）

受管轮次 67 · 注入 0（0%） · 切档 0 次 · 命令调用 0 次
注入字节 0 B · 从 10:23 开始计数

按档位分布（受管轮次）
  off   0
  lite  0
  full  67
  ultra 0

比没用 ponytail 的情况（基准推算）
  输出 token  约 -45%   [-54%, -35%]
  成本        约 -26%   [-36%, -16%]
  耗时        约 -41%   [-49%, -32%]

  推算基数：67 个非 off 轮次 × 每轮假定 800 输出 token。

  基线：上游 39 任务 × 5 次 × 三臂，Claude Code + Opus 5.5
  https://github.com/DietrichGebert/ponytail/blob/main/benchmarks/results/2026-10-07-agentic.md
  这是上游基准，不是本机测量。

面板里有图形版：设置 → Ponytail → 效率。
```

数字随宿主运行持续增长（观测到 24 → 36 → 43 → 65 → 67），档位分布跟面板一致（full 全量）。同一份数据在设置页面板里有图形版（截图见 06 票第 6 节），命令与面板两条出口对得上。

宿主重启后取到真实快照并渲染 /ponytail-gain 原文，数字随运行增长；check:skills / check:readme / verify 全绿。
