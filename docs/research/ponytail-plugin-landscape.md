# DSH 插件生态：ponytail 同类开源插件调研

> 采集时间：2026-11-07。数据源：GitHub REST API（`gh api`）、npm registry / downloads API、仓库源码原文（raw.githubusercontent.com）。star 数与提交时间为采集瞬时值；"未找到"表示在 npm 全量搜索、GitHub 仓库搜索与 awesome 列表三处均无对应条目。

## 摘要

ponytail 主题在 DSH 上已是一个**拥挤且碎片化**的细分：npm 上至少 13 个同名派生包，GitHub 上 14 个相关仓库，全部移植同一份 MIT 上游。`@wenaixi/dsh-ponytail` 以 38★ / 周下载 1183 居首，也是唯一实现"会话基线锁定、切换档位不改前缀"（ADR-0012）的实现；代价是 turn coordinator + 状态层 + 17 份 ADR 的重量。`@maci0`、`@kb1slnlabs`、`@mengyuly` 三家在**原生设置面**与**真实宿主组合测试**上明显更成熟，`njuptlzf` 则给出 always-on 用压缩规则、完整技能按需加载的 token 经济学做法。三家都已适配 DSH 0.2.2，`@wenaixi` 仍卡在 `<=0.2.1`。

---

## 1. 上游原型：DietrichGebert/ponytail 设计意图解剖

仓库：https://github.com/DietrichGebert/ponytail · MIT · 185901★ / 10285 forks · 创建 2026-06-12 · 最后 push 2026-10-29
npm：`@dietrichgebert/ponytail` 5.3.3（2026-10-29，20 个版本，零运行时依赖），周下载 42331。

### 1.1 一句话定位

README 原话："He says nothing. He writes one line. It works." —— 它不是代码生成器，是**行为矫正层**：把"资深工程师的最小改动直觉"固化成每轮都生效的规则集，并把"哪里偷了懒"记录成可回收的债务。

### 1.2 三层结构（这是移植时必须对齐的骨架）

| 层 | 载体 | 作用 |
|---|---|---|
| 常驻规则 | `AGENTS.md` / `.agents/rules/ponytail.md`（2623 字节） / 各宿主 rule 文件 | 每次请求都进上下文的最小完整规则集 |
| 完整技能 | `skills/ponytail/SKILL.md` + 5 个 companion（`-review` `-audit` `-debt` `-gain` `-help`） | 需要时才加载的长文与工作流 |
| 状态与生命周期 | `hooks/`（activate / mode-tracker / instructions / config / subagent / map / band） | 档位读写、命令解析、子智能体注入、代码地图、状态带 |

关键设计点，逐条：

1. **六阶梯子而非七阶**。上游 `.agents/rules/ponytail.md` 写的是 "Take the first option that fully works" 共 6 条（是否存在 → 是否已有 → 标准库/平台 → 已装依赖 → 一行 → 最小实现）。DSH 侧移植普遍写成"7 阶梯子"（把"标准库"与"平台原生"拆开），这是移植时的本地化改写，不是上游原文。参考：https://raw.githubusercontent.com/DietrichGebert/ponytail/main/.agents/rules/ponytail.md
2. **懒惰的边界被显式写死**："Never cut: validation at trust boundaries, error handling that prevents data loss, security, accessibility, the calibration real hardware needs, anything the user asked for." —— 这句话是这类插件唯一的免责机制，删了就变成"教模型写不安全代码"。
3. **懒惰必须留痕**：非平凡逻辑必须留一个可运行检查（assert 自检或一个小测试文件）；已知上限的简化要写 `shortcut: <the limit>, <when to upgrade>` 注释，供 `/ponytail-debt` 收割成台账。
4. **三档强度是真实不同的 prompt 片段**，不是换一行标签：lite = 交付要求 + 一句话指出更简方案；full = 完整梯子；ultra = 先质疑需求是否该存在。上游 `skills/ponytail/SKILL.md` 第 48–52 行是一张 mode 表，DSH 各移植版都靠"过滤该表行"实现按档裁剪。
5. **子智能体是个独立战场**。`hooks/ponytail-subagent.js` 的注释直说：SessionStart 上下文只到父线程，不注入的话每个 Task 派生的 agent 都是 ponytail-unaware（上游 issue #252）；并用 `PONYTAIL_SUBAGENT_MATCHER` 正则做可选过滤。这是"注入式插件"最容易被漏掉的一层。
6. **`reuse first` 需要索引才便宜**。`hooks/ponytail-map.js` 用 `git ls-files` + 正则生成 2000 字符预算的符号地图（每语言一组正则），注释自承"regex, not a parser"，升级路径是 tree-sitter。这是把"先复用"从口号变成可执行动作的关键件。
7. **多宿主适配器矩阵**：`.claude-plugin/` `.codex-plugin/` `.cursor/rules/` `.clinerules/` `.windsurf/rules/` `.kiro/steering/` `.openclaw/skills/` `.opencode/` `.qoder/` `.grok-plugin/` `.kimi-plugin/` `.devin-plugin/` `.openclaw` `gemini-extension.json` `pi-extension/` `plugin.yaml`，加 `scripts/check-rule-copies.js` 校验各副本一致。**内容的单一真源 + 派生副本一致性检查**，是它能在 18 个宿主上不腐化的原因。
8. **benchmark 与它的边界**。README 自报 Ponytail 5（Claude Code，39 tasks，Opus 5.5，5 runs）：代码量 -53%、时间 -41%、成本 -26%、token -45%，高风险逻辑带测试率 98%（无技能时 68%），六个安全任务 30/30。方法学在 `benchmarks/results/2026-10-07-agentic.md`。**但这是 Claude Code + Opus 的测量，不能迁移到 DSH 的模型循环与 prompt 组装**——MengYuil 版 README 明确写了这一点："上游 Benchmark 仅作参考，不代表本适配版具有相同的 Token、成本或延迟收益"。我们接手后引用这组数字必须带同样的限定语。

---

## 2. 同类插件清单

### 2.1 ponytail 直系移植（同功能、同主题）

| 名称 | 地址 | 活跃度（2026-11-07） | 形态 | 可借鉴点 |
|---|---|---|---|---|
| **@wenaixi/dsh-ponytail**（接管对象） | https://github.com/Wenaixi/dsh-ponytail | 38★ / 3 forks · push 2026-10-24 · npm 5.6.2 · 周下载 1183 · 2 个 open issue（均为"适配 0.2.2"） | always-on section（函数式 text，按档裁剪）+ 6 技能 + **零 tool**（ADR-0002）+ client 设置卡/技能开关/描述语言 + Typert 只读快照通道 | 唯一做"前缀缓存保护"的实现（ADR-0012 基线锁定 + 轮末追加 system-reminder）；四层配置优先级（env > profile 补丁 > flag > 兜底）与诊断链 |
| **@maci0/dsh-ponytail** | https://github.com/maci0/dsh-ponytail | 0★ · push 2026-11-04 · npm 0.20.2（8 版）· 周下载 292 | section + 6 技能 + **注册 ponytail tool** + `/ponytail` 命令 + 设置卡 + composer chip；TS 源码 + `lib/` 预构建 | **代码围栏感知的 mode 过滤**；`tests/composition.test.ts` 真 Cordis 组合测试；README 声明 install-as-bundle 与 peer 精确姿势 |
| **@kb1slnlabs/dsh-ponytail** | https://github.com/KB1SLN-Labs/dsh-ponytail | 1★ · push 2026-11-04 · npm 5.3.3-dsh.6 · 周下载 504 | section + 6 技能 + 原生设置页签 + 状态带 + usage dashboard + session projection `ponytailStats` + Fetch 路由 `/api ponytail/state` | **settings + slots + commandUi 三件套的完整样板**（`DESIGN.md`）；3 OS × 3 版本兼容性矩阵 CI；projection 折叠口径的诚实注释 |
| **@mengyuly/dsh-ponytail** | https://github.com/MengYuil/dsh-ponytail | 17★ / 3 forks · push 2026-10-17 · npm 0.4.3（17 版）· 周下载 531 | section + 6 技能 + `/ponytail` 命令 + client 设置 | **4 进程持久化/重启/SIGKILL 恢复测试**（`scripts/test-persistence.mjs` + `docs/v4-persistence.md`）；`measure-prompt.mjs` 单品尺寸测量；`check-bundle.mjs` 产物纯度检查；`dsh-invariants` companion；peer 区间放到 `>=0.0.1-rc <2` |
| **@gongyijie85/dsh-ponytail** | https://github.com/gongyijie85/dsh-ponytail | 20★ / 4 forks · push 2026-09-10 · npm `dsh-ponytail-skills` 0.1.7 · 周下载 426 | section + 6 技能（上游 verbatim）+ 无 client | **`scripts/sync-upstream.sh`**：clone 上游后按目录整份复制技能，排除 `agents/` 与 `openai.yaml`；`dsh.compatibility.dshReleases` 逐版本兼容矩阵（注：宿主并不读此字段，见 §5） |
| **@njuptlzf/dsh-ponytail** | https://github.com/njuptlzf/dsh-ponytail | 0★ · push 2026-09-07 | **不 vendor 任何技能正文**：从上游 raw 抓一次落 `~/.dsh/skills/`，always-on 只用上游 2623 字节 compact 规则；companion 标 `disable-model-invocation` | **两层 token 经济学**：常驻用压缩规则、完整技能只做用户可调用，避免技能目录常驻成本；按 `agent.id` 存档位（DSH 单进程多会话） |
| **@hoyyang/dsh-best-ponytail** | https://github.com/hoyyang/dsh-best-ponytail | 1★ · push 2026-09-21 · npm `dsh-best-ponytail` 0.1.0 · 周下载 186 | section + 6 技能，仓库内嵌完整 `upstream/` 子树 + `.sanitize-allow.json` | **把上游整树 vendor 进仓**并做 sanitize 白名单，离线可复现 |
| mirelconstantin/dsh-ponytail-sync | https://github.com/mirelconstantin/dsh-ponytail-sync | 2★ · push 2026-10-10 | 手写 `src/{prompt,skill,command,runtime,config}.js` 分层 + `scripts/check-{pack,patch,plugin}.mjs` | 三个 `check-*.mjs` 把"清单/补丁/产物"分开校验，发布前卡口清晰 |
| Sepolian/dsh-ponytail | https://github.com/Sepolian/dsh-ponytail | 0★ · push 2026-10-07 | 薄适配器 | —— |
| BorisLoveDev/dsh-plugin-ponytail | https://github.com/BorisLoveDev/dsh-plugin-ponytail | 0★ · push 2026-09-21 | 单文件 `lib/index.js` + 自检测试 | 极简单文件形态，可做"最小可维护版"参照 |
| Stijnus/dsh-ds-ponytail | https://github.com/Stijnus/dsh-ds-ponytail | 0★ · push 2026-09-02 | 技能族移植 | —— |
| clawsu/ponytail-dsh | https://github.com/clawsu/ponytail-dsh | 0★ · push 2026-09-28 | npm `ponytail-dsh` 0.1.0 单版 | —— |
| xiaoyueD2009/dsh-ponytail | https://github.com/xiaoyueD2009/dsh-ponytail | 0★ · push 2026-10-30 | section + 6 技能 + locale + `descriptions.zh.json` | 复制了 Wenaixi 的目录骨架（含 `icon.svg`、`locale/`），可作为"骨架被复用的证据" |
| makuralymi/dsh-plugin-ponytail | https://github.com/makuralymi/dsh-plugin-ponytail | 7★ · push 2026-08-16 | **非同功能**：Web GUI 的 pom-pom 彩蛋 | 不计入同类，列在此处以免误判 |
| saqie803/ponytail | https://github.com/saqie803/ponytail | 2★ · push 2026-10-13 | **非 DSH 专用**：面向 20+ agent 的 skill 分发 | 多宿主 skill 打包思路 |

npm 侧同名派生包共 13 个（`@wenaixi` / `@mengyuly` / `@maci0` / `@kb1slnlabs` / `@linsam262` / `dsh-ponytail-skills` / `dsh-ponytail` / `ponytail-dsh` / `dsh-best-ponytail` / `@ziduup/dsh-programming-mode` 内含 6 个 ponytail 技能 …），完整清单可用 `registry.npmjs.org/-/v1/search?text=ponytail%20dsh` 复现。

### 2.2 相邻主题（非 ponytail，但抢同一心智）

| 名称 | 地址 | 活跃度 | 形态 | 与我们相关的点 |
|---|---|---|---|---|
| @maci0/dsh-caveman | https://github.com/maci0/dsh-caveman | npm 0.18.2 · 周下载未测 · 同一作者的姊妹产品 | 压缩"说话方式"而非"代码量"：14 个技能 + tool + 卡 + chip + 本地无模型压缩命令 | 与 ponytail 同一套 host/client 骨架，可对照其**同一作者如何抽象出通用骨架** |
| KurutoDenzeru/tersio | https://github.com/KurutoDenzeru/tersio | 22★ · push 2026-11-07 · topics 含 ponytail | 跨宿主（dsh/opencode/pi/MCP）的 token 节省套件：caveman 文体 + RTK shell 压缩 + **lean Ponytail 代码** + gain 看板 | 说明"ponytail 只是 token 经济学的一个组件"，我们若只做代码量纪律，天花板有限 |
| ziduup/dsh-programming-mode | https://github.com/ziduup/dsh-programming-mode | 12★ · push 2026-11-06 · npm 0.5.1（11 版） | **组合包**：14 个 superpowers 技能 + 6 个 ponytail 技能 + `engines.dsh >=0.2.1-rc.5` | 直接竞争关系：用户可选"装一个组合包"而不装我们；也证明 ponytail 更适合作为**纪律组件**被组合 |
| @michengai/dsh-simplify | https://github.com/MichengAI/dsh-simplify | npm 1.0.7 · mod 2026-11-05 | Git 变更范围限定的代码简化（未跟踪文件、跨平台路径） | "简化"落成**具体命令+范围语义**，比纯 prompt 更有交付感 |
| dsh-simplify | npm 0.1.5 · mod 2026-10-04 | 由 pi-simplify 迁移，评审最近改动 | —— |

### 2.3 成熟 DSH 插件（架构参照，非同类功能）

| 名称 | 地址 | 活跃度 | 为什么看它 |
|---|---|---|---|
| dsh-context | https://github.com/bowenliang123/dsh-context | npm 0.82.1 · mod 2026-11-06 | **host/client 双面拆分的标准姿势**：`src/client/{assemble,agentTree,apiRoutes,attachmentSource}.ts` 各自成模块，`dsh.client.inject` 声明 7 个客户端包；8 语言 locale 分包 |
| dsh-market | https://github.com/dsh-market/dsh-market | 11183★ · push 2026-11-06 | 生态分发入口；插件发现的真实渠道 |
| awesome-dsh-plugin | https://github.com/awesome-dsh-plugin/awesome-dsh-plugin | 23373★ · push 2026-11-06 · 收录 9305 个插件（badge 端点 `count.json`） | 收录标准与评审清单（`contributing.md`），可作为我们对外描述的事实基线 |
| @wenaixi/dsh-superpower | https://github.com/Wenaixi/dsh-superpower | 28★ · push 2026-10-17 | 同一作者的姊妹实现，共用"bundle patch + client.js + locale + skills"骨架——**接管时的现成参照系** |

---

## 3. 横向对比（功能矩阵）

列含义：注入 = 是否 always-on 注入 system prompt；技能 = 随包技能数；tool = 是否给模型注册工具；UI = 是否有浏览器半面；持久 = 配置落盘方式；会话 = 是否支持会话级切换；缓存 = 是否显式保护 prompt 前缀缓存；CI = 是否有真实宿主测试；范围 = 声明的宿主版本区间。

| 实现 | 注入 | 技能 | tool | UI | 持久 | 会话 | 缓存 | CI | 范围（engines / peer） |
|---|---|---|---|---|---|---|---|---|---|
| @wenaixi 5.6.2 | 是（函数式 section，按档裁剪） | 6 | **否**（ADR-0002） | 设置卡 + 技能开关 + 描述语言 | volatile 字段 + profile 补丁 + `.ponytail-active` + `session-states.json` | 是 | **是**（ADR-0012 基线锁定） | 113 行为测试（PR #5 声明，未复核） | `>=0.2.0-rc.1 <=0.2.1` ← **已越界** |
| @maci0 0.20.2 | 是（围栏安全裁剪） | 6 | **是**（`ponytail` tool） | 设置卡 + composer chip | `ponytail` settings 命名空间（`defaultMode` volatile） | 是（`review` 仅会话） | 未声明 | 真组合测试 + 单元 | `>=0.2.2-alpha.3 <0.3.0` |
| @kb1slnlabs 5.3.3-dsh.6 | 是 | 6 | 未见 | 设置页签 + 状态带 + dashboard | `configForms`（revision 冲突保护） | 是（inherit/覆盖） | 未声明 | 3 OS × 3 版本矩阵 + tarball 集成 | `>=0.2.1-rc.3 <0.3.0` |
| @mengyuly 0.4.3 | 是 | 6 | 否（用命令） | 设置卡 | `config.json` + 会话内存 override | 是（重启回默认） | 未声明 | 4 进程持久化 + 9 producer pack 矩阵 | `>=0.0.1-rc <2`（宽） |
| @gongyijie85（npm dsh-ponytail-skills 0.1.7） | 是 | 6（上游 verbatim） | 未见 | 无 | 未声明 | 否 | 未声明 | verify-provider smoke | 无 engines；`dsh.compatibility.dshReleases` 矩阵（宿主不读） |
| @njuptlzf（无 npm） | 是（上游 compact） | 6（写 `~/.dsh/skills`） | 未见 | 无 | 无（内存 Map） | 是（按 `agent.id`） | 未声明 | 无 | 无声明 |
| @hoyyang 0.1.0 | 是 | 6 | 未见 | 无 | 无 | 否 | 未声明 | smoke | 无声明 |
| ziduup/dsh-programming-mode 0.5.1（组合包） | 是 | 20（14+6） | 未见 | 有 client | 未声明 | 未声明 | 未声明 | 未核实 | `>=0.2.1-rc.5` |

三条可直接用于决策的观察：

1. **"零 tool"是 Wenaixi 版独有的坚持**。maci0 版直接注册 `ponytail` tool 让模型自切档位；这在功能上更强（模型能主动升档），但每轮多一份 tool schema，与"零缓存破坏"的初衷存在张力。接管时这是一个要明确表态的分歧点。
2. **"缓存保护"是全生态只有一家做的事**。其余实现的档位切换都会改动 section 文本，即改写系统提示词前缀。Wenaixi 版的 turn coordinator（`ponytail-commands.js`）+ 状态层（`ponytail-state.js`）+ 存储适配器，全部是为这一条服务的复杂度。**保留 ADR-0012 就等于继承整套重量；放弃它则项目退化为又一个 @maci0。**
3. **宿主版本范围是当前最紧的生存问题**。三家里有 2 家已到 `0.2.2`，我们卡在 `<=0.2.1`，而本机正是 `0.2.2-rc.1`。

---

## 4. 可择优借鉴的 8 条具体做法

**（1）把 mode 过滤做成"围栏感知"的，而不是逐行正则。**
Wenaixi 版 `lib/ponytail-instructions.js` 的 `filterSkillBodyForMode()` 只按两种行首正则（`| **label** |` 与 `- label: "`）删行，没有代码围栏状态机；一旦技能正文在 fenced block 里出现 `lite`/`full` 示例，会被误删。
来源：https://github.com/maci0/dsh-ponytail/blob/main/src/modes.ts —— 它显式维护 `FENCE` 正则与"每行是否处于围栏内"的标记，注释写明理由："Fenced text is literal, so a mode-shaped line inside it is an example of the syntax, not a ruleset row: the filter must leave it alone."
落地：在我们 `ponytail-instructions` 里加围栏状态机；配一条单测（正文含围栏内 mode 行 → 必须保留）。

**（2）用真实 Cordis 组合做冒烟测试，而不是 mock。**
`tests/composition.test.ts` 直接 `new Context()` + `ctx.plugin(SkillRegistry)` + `ctx.plugin(Ponytail.apply, Ponytail.Config({defaultMode:'full'}))`，断言 `ctx.skills.list()` 返回 6 个技能的 name/provider/source，并在 dispose 后清空；注释说明"其他服务是 optional，所以它们的回调不会执行，这正是六个技能成为断言对象的原因"。
来源：https://github.com/maci0/dsh-ponytail/blob/main/tests/composition.test.ts
落地：把"6 技能进/出注册表"作为接管后的第一个红灯测试。

**（3）持久化要按"重启 + SIGKILL"验收，而不是按"字段写进去了"。**
`docs/v4-persistence.md` 记录了用 4 个独立宿主进程验证：档位切换/重置/保存默认 → 正常重启并逐字节比对已提交事件前缀 → 再恢复并继续写 → 在真实 flush 屏障后 SIGKILL → 恢复并续写；参考运行的事件序列 63 → 105 → 147 → 189，12 个完成轮次；并诚实标注"session override 故意留在内存，重启回默认不是丢配置"。
来源：https://github.com/MengYuil/dsh-ponytail/blob/master/docs/v4-persistence.md · https://github.com/MengYuil/dsh-ponytail/blob/master/scripts/test-persistence.mjs
落地：我们的 `session-states.json` + `.ponytail-active` 双写通道，必须过这一关；否则 ADR-0017 的"自愈"没有证据。

**4）给"提示词体积"配一个可复现的测量脚本，且拒绝伪造 token 数。**
`scripts/measure-prompt.mjs` 对 4 个档位输出 `{bytes, chars, estimated_tokens: null, note}`，注释直说"没有统一 tokenizer，estimated_tokens 为 null；这些数字不是 provider usage，也不是计费保证"。
来源：https://github.com/MengYuil/dsh-ponytail/blob/master/scripts/measure-prompt.mjs
落地：我们的 README 若要讲"零缓存破坏省了多少钱"，必须先有这个诚实基线，否则就是营销。

**（5）对发布产物做纯度检查：外部依赖白名单 + 禁止动态求值。**
`scripts/check-bundle.mjs` 三条：① 产物里 `from "@…"` 的外部模块必须**恰好**是 `@deepseek-ai/cordis` 与 `@deepseek-ai/schemastery`（其余 dsh-* 全部内联）；② 产物不得含 `new Function` / `eval(`；③ `dsh.bundle.patch` 必须声明。它的取舍解释很值得抄：**故意不内联 schemastery**，因为其 schema DSL 用 `new Function` 编译 callback 字符串，内联会让发行物带上动态代码执行。
来源：https://github.com/MengYuil/dsh-ponytail/blob/master/scripts/check-bundle.mjs · https://github.com/MengYuil/dsh-ponytail/blob/master/package.json
落地：我们有 `yaml` 依赖 + 打包产物，同样应加这两条卡口；这与 awesome 列表"安装插件等于运行第三方代码"的告警直接相关。

**（6）客户端不要读 settings 文档来显示"当前档位"，要读宿主。**
`src/index.ts` 导出了 `LEVEL_ROUTE` = `/ponytail/level`，返回 `{mode, source}`（source 为 `settings` 或 `session`），挂在 `connection` 信任栅栏后；注释说明理由："The card and the chip cannot see a session-local level, so they ask the host instead of the settings document."
来源：https://github.com/maci0/dsh-ponytail/blob/main/src/index.ts
落地：我们当前 `ponytail-remote.js` 用 Typert 快照通道方向是对的，但**必须把 session 级档位也投进快照**，否则面板显示与真实生效会分裂（这正是 Wenaixi 版 client 里 `mode.lockedHint`、`chain.shadowed` 一堆文案在补的坑）。

**（7）原生设置面用 `configForms` + `slots` + `commandUi` 三件套，并带 revision 乐观锁。**
`DESIGN.md` 把契约写成了可执行清单：`configForms.get('ponytail')` → `getSnapshot()/subscribe()/mutate(ops, expectedRevision)`（`mutate` 返回 `false` = 宿主拒绝）；`slots.inject('settings.plugins.tab', …)` 注册页签；`commandUi.decorate({ui:{kind:'popupSelect'}})` 做档位选择器并回调 `remote.commands.execute(sessionId, '/ponytail <id>')`；`slots.inject('conversation.input.dock', …)` 做状态带，数据走 `useProjection('ponytailStats')` + `connection.rpc.call('/api','ponytail/state',{sessionId})`；并明确"主题 token 只继承 `--dsw-alias-*`，从不重定义"。
来源：https://github.com/KB1SLN-Labs/dsh-ponytail/blob/main/DESIGN.md
落地：我们 client 目前是手写 `window.__ModuleLoader__.load` + React.createElement；这套契约可直接对齐，省掉自造轮子。

**（8）技能正文的单一真源 + 上游逐字同步脚本。**
`scripts/sync-upstream.sh` 只做一件事：clone 上游 → 对 `skills/*/` 逐目录 `find … ! -path '*/agents/*' ! -name 'openai.yaml' -exec cp` → 完事，并注明"技能文件逐字发行：provider 自己解析 folded `description: >` frontmatter，无需适配步骤"。
来源：https://github.com/gongyijie85/dsh-ponytail/blob/main/scripts/sync-upstream.sh
配套：`src/skills.ts` 让 `skills/` 同时充当 always-on 正文源与按需技能源（"同一批文件是两个面的单一真源"），并在 `src/index.ts` 里**加载时解析一次**、按档位缓存过滤结果。
来源：https://github.com/maci0/dsh-ponytail/blob/main/src/skills.ts · https://github.com/maci0/dsh-ponytail/blob/main/src/index.ts
落地：我们已有 6 个中文改写技能，建议保留中文化，但加一个 `sync-upstream` 脚本 + 差异报告，让上游规则变更（上游仍在活跃，2026-10-29 才 push）不会静默漏掉。

**（9，可选）两层注入：常驻用压缩规则，完整技能只做用户可调用。**
`njuptlzf` 版把 always-on 收窄到上游 2623 字节的 `.agents/rules/ponytail.md`，6 个完整技能落盘并标 `disable-model-invocation`（"stays in the / palette but is never advertised to the model — no catalog cost, no auto-load"）。
来源：https://github.com/njuptlzf/dsh-ponytail/blob/main/index.js
注意：该实现**每次冷启从 GitHub raw 抓取**（"只抓一次"，删文件才重抓），是可用性风险，不要照抄网络部分，只借鉴分层。

**（10，可选）发布前用"清单 / 补丁 / 产物"三份独立校验脚本卡口。**
`scripts/check-pack.mjs`、`check-patch.mjs`、`check-plugin.mjs` 分开校验 tgz 内容、补丁行、插件入口。
来源：https://github.com/mirelconstantin/dsh-ponytail-sync/tree/main/scripts
落地：与我们"不往家目录写垃圾文件、卸载删干净"的承诺配套——需要 check-pack 断言 `files` 白名单。

---

## 5. 生态风险

### 5.1 DSH 版本演进：当前最硬的约束

- 本机 DSH 为 **0.2.2-rc.1**（`@deepseek-ai/dsh-desktop-runtime 0.2.2-rc.1`），随包 `cordis 4.1.0`、`dsh-skill 0.2.2-rc.1`、`dsh-settings 0.2.2-rc.1`、`dsh-system-prompt 0.2.2-rc.1`。
- `@wenaixi/dsh-ponytail@5.6.2` 声明 `engines.dsh = ">=0.2.0-rc.1 <=0.2.1"`，peer 中 `dsh-skill`、`dsh-typert-protocol` 同样是 `<=0.2.1`。**在当前宿主上属于"不兼容"。**
- 宿主的判定不看插件自建的 `dsh.compatibility` 字段：`@deepseek-ai/dsh-plugin-manager/lib/index.js` 第 491、513–514、1479、1493–1494 行显示，它通过 `pnpm view <name>@<version> name version engines peerDependencies deprecated dsh --json` 只取 `engines` 与 `peerDependencies`，产出 `incompatible-version` 拒绝（错误对象带 `incompatible` 包名列表，见第 297–314 行）；`typert.host.js` 第 59 行的 `requirements` 说明也写明"以 `engines.dsh` 或 DSH peer 包名为键"。宿主另有 `setProfileVersionExemption`（精确版本豁免）机制。
  → **推论：@gongyijie85 那份 `dsh.compatibility.dshReleases` 矩阵是自建元数据，宿主不读；不能作为兼容性保障。** 真正有效的只有放宽 `engines.dsh` + peer 区间，并用真实宿主矩阵 CI 证明。
- 已有两块现成补丁：#4（issue，请求适配 0.2.2-rc.1）与 #5（PR，把区间放到 `<=0.2.2`、把构建基线移到 0.2.2-rc.1 batch）。**PR #5 至今 open、未合并**（state=open，merged_at=null）。PR 正文的破坏性变更审计结论（`dsh-skill` / `dsh-typert-protocol` 的 `lib/index.js` 与 0.2.1-rc.2 逐字节相同；`schemastery 3.19.0` 与 3.18.4 逐字节相同；cordis 4.1.0 的改动只在内部 update/config 事件与 Reflect.apply 派发路径）是**PR 作者声明，我们尚未独立复核**，接管时应重跑验证脚本再采信。
- 上游仍在动：DietrichGebert/ponytail 2026-10-29 还在 push（5.3.3）。上游规则文本变更会通过技能正文影响行为，但**不会**通过版本号告知我们——这是"移植型插件"的隐性腐化源。

### 5.2 API 稳定性：宿主半面稳，客户端半面不稳

- 宿主侧用到的扩展点是稳定的公开面：`ctx.systemPrompt.section({name, order, text})`（`order` 必须有限数，否则抛 `TypeError`，见 `dsh-system-prompt/lib/index.js` 第 255–257 行）、`ctx.skills.registerProvider`、`settings` + `loader/volatile-update`。Wenaixi 版 `inject = ['skills', 'systemPrompt']` 且对 `settings` 用 `try/catch` 探测（因为 cordis 的 ctx 是 Proxy，读未 inject 的服务会抛而不是返回 undefined）——这段"为什么要 try/catch"的注释是接管时最该保留的知识。
- **客户端面是真正的漂移区**。同为 2026-11 更新的三个实现，`dsh.client.inject` 集合各不相同：@maci0 用 `ui-renderer + ui-settings + ui-plugin-manager`；@kb1slnlabs 用 `ui-settings-plugins + ui-commands + ui-conversation + ui-sidebar + ui-layout + ui-workspace + api-session-controller + connection`；@mengyuly 用 `ui-settings-plugins + ui-commands`；@wenaixi 用 `ui-settings + ui-primitives + locale`；dsh-context 用 `api-remotes + ui-conversation + ui-sidebar-right + …`。slot 名（`settings.plugins.tab` / `conversation.input.left` / `conversation.input.dock` / `sidebar.panellist` / `main`）也不统一。**结论：把客户端 UI 做成可降级的可选增强，宿主侧零 UI 也能完整工作**，是唯一稳妥的架构选择。
- 宿主依赖的精确版本面窄：@maci0 把 `@deepseek-ai/dsh-skill` 写成 `dependencies: 0.2.2-alpha.3`（硬钉 alpha），@kb1slnlabs 把 `cordis` 钉 `~4.0.5`、`schemastery` 钉 `~3.18.5`，@mengyuly 自己 bundle 内联 `dsh-llm`/`dsh-skill`（"npm 无兼容版本"）。**没有一种做法是干净的**，我们必须在"钉死"与"区间 + 矩阵 CI"之间选一个并写进 ADR。

### 5.3 社区规模与竞争格局

- 平台侧：官方仓库 deepseek-ai/deepseek-harness 275028★（push 2026-11-04）；awesome 列表 23373★、收录 9305 个插件；npm `keywords:dsh-plugin` 命中 13017 个包。生态很大，**被发现**本身是难题。
- 主题侧：ponytail 直系在 npm 上有 13 个包，周下载分布为 @wenaixi 1183 > @mengyuly 531 > @kb1slnlabs 504 > dsh-ponytail-skills 426 > @maci0 292 > dsh-best-ponytail 186。上游 @dietrichgebert/ponytail 42331/周。**我们握有最大的存量，但作者已停更 14 天且两个适配 issue 无人响应**——这是接管窗口，也是用户流失窗口。
- 组合包是更强的竞争者：ziduup/dsh-programming-mode（12★，20 技能，含全部 6 个 ponytail 技能）与 KurutoDenzeru/tersio（22★，跨宿主）都在把"代码量纪律"降级为一个组件。**我们的差异化只能落在"缓存经济学 + 中文原生 + 唯一保留零 tool"这三条上**，靠"又一个 ponytail 移植"无法竞争。
- 质量门槛已被抬高：@kb1slnlabs 有 3 OS × 3 版本矩阵 CI + tarball 集成测试，@mengyuly 有 4 进程持久化测试 + 产物纯度检查。**接管后如果测试低于这个水位，issue 会被"为什么不如 XX 稳"占满**。

---

## 附：未找到 / 存疑项

1. **未找到**官方（deepseek-ai 组织下）的 ponytail 或"最小代码/复杂度审计"类内置插件；`gh api repos/deepseek-ai/deepseek-harness/contents/packages/community` 返回 404，`search/code?q=repo:deepseek-ai/deepseek-harness+path:packages/community/ponytail` 命中 0。@mengyuly README 提到的 `packages/community/ponytail` 作为"历史内联依赖基线"无法在公开仓库中定位。
2. **未找到**非 ponytail 的独立"过度设计审查 / 复杂度审计"DSH 插件；该语义位置基本被 ponytail 系与 `dsh-simplify`（代码简化）占据。
3. **未找到** ponytail 主题的付费/商业实现。
4. **存疑**：Wenaixi 版 113 个行为测试、PR #5 的字节级相同结论，均来自 PR 正文自述，本调研未复跑。
5. **存疑**：`@kb1slnlabs`、`@hoyyang`、`@njuptlzf` 是否给模型注册了工具，未逐行核实（矩阵中记为"未见"）。
6. **口径说明**：本文件"7 阶梯子"沿用 DSH 社区通行说法；上游原文是 6 阶（标准库与平台原生合并为一条）。我们对外文案若强调"忠实移植"，需说明这一处拆分。
