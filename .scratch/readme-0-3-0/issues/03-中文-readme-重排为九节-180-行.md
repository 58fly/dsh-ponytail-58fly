<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-IDEMPOTENCY-KEY: deck-8492f1bd-5980366 -->
<!-- DSH-CREATED: 2026-11-08T03:52:28.294Z -->
<!-- DSH-BLOCKED-BY: 02 -->
# 03: 中文 README 重排为九节 ≤180 行

**What to build:** 

**Blocked by:** #02

**Status:** resolved

- [ ] `wc -l README.md` ≤ 180。
- [ ] `grep -n '^\*\*.*\*\*$' README.md` 零命中（无加粗段落式小标题）。
- [ ] `grep -c '^####' README.md` 为 0。
- [ ] 配置、技能、兼容、排障四处均为 Markdown 表格。
- [ ] 所有命令行都在 ```bash 块内，且每块首行以 `#` 开头。
- [ ] badge 四项齐全且链接可点。
- [ ] 顶部有中文/English 互链一行（English 链接指向 `docs/README.en.md`，该文件由下一张票产出）。
- [ ] 上面「必须保留的事实」逐条可检索到。

## 要交付什么

README 从 266 行压到 180 行以内，视觉上照 DietrichGebert/ponytail 首页那股清爽劲：居中标题、一行 badge、分节小标题居中、能用表格的绝不用段落、所有命令进 bash 块且首行是 `#` 注释。只讲有用的话，删掉过程叙事。

这是本案的主体产出，直接决定 GitHub 上的第一观感。

## 排版硬边界（来自已拍板的 Q6，逐条不可妥协）

- 头部：居中 h1 + 一句 tagline + 中英互链一行 + badge 行（npm version / downloads / license / `engines.dsh` 四项）。
- 分节用 `<h2 align="center"><sub>INSTALL</sub></h2>` 这类 HTML 居中标签，不用纯文本标题当视觉主角。
- 命令**全部**进 ```bash 块，且块内首行是 `# 说明` 注释。
- 配置、技能清单、兼容区间、排障四块**全表格**。
- 正文**不出现** `**加粗**` 当段落式小标题（`**xxx**` 独占一行那种一律禁用）。
- 标题层级只用 `##` / `###`，不出现 `####`。
- 排障每条压成一行「现象 → 成因 → 处置」，放表格。
- 全文 ≤180 行。

## 九节结构与行数预算

| 节 | 预算 | 要点 |
|---|---|---|
| 头部 | 14 | 居中 h1、tagline、中英互链、四个 badge |
| 这是什么 | 10 | 一句话讲清三个能力：模式分级提示、围栏感知的提示过滤、双语技能目录；不铺垫背景故事 |
| 效果 | 8 | 一句说明装了会看到什么。本版无截图，此处先留 HTML 注释占位，**不得出现坏链或 `![占位]`** |
| 安装 | 22 | 两条正式路径：按包名装、从 tarball 装；三条已知坑压成表格三行 |
| 使用 | 12 | 六个技能一张表：命令 / 一句话作用 |
| 配置 | 14 | `defaultMode` / `skillDir` / `locale` 三行表 + 档位 off/lite/full/ultra 说明（默认 full） |
| 兼容 | 8 | `engines.dsh` 区间、`node>=20`、peer 依赖；可保留一处指向 `docs/research/dsh-plugin-contract-0.2.2.md` 作为区间证据 |
| 排障 | 14 | 六条，各压一行 |
| 来源与许可 | 6 | 规则思想参考 DietrichGebert/ponytail（MIT）+ 本插件 MIT |

合计预算 108 行，上限 180，留出余量。

## 必须保留的事实（重写时不能丢）

- 配置三项：`defaultMode`、`skillDir`、`locale`；档位 `off` / `lite` / `full` / `ultra`，`DEFAULT_MODE='full'`。
- 六个技能：`/ponytail`（六阶梯子）、`/ponytail-review`（按六阶审查）、`/ponytail-audit`（扫过度设计）、`/ponytail-debt`（盘点 `shortcut:` 注释）、`/ponytail-gain`（量化省下多少）、`/ponytail-help`（用法速查）。
- 斜杠手势只认 ASCII 空白：`(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)`。
- 排障六条：无设置面板 / 短名 inject 失效 / 命名空间未服务 / 技能列表空 / 斜杠无反应 / `lib` 不进 Git。
- 安装两条已知坑：`pnpm skills` 需批准、直接 `npm install` 需手工登记 bundles。
- `cordis.patch.yml` 里 `skillDir: "${package}/skills"`。

## 要砍的（杂乱主因）

- 现「部署」节约 60 行：把本地目录安装、`skillDir` 逐行讲解压成表格或删除。
- 现「常见问题」节约 70 行：压成六行表格。

## 不做

- 不写英文版（下一张票）。
- 不放真实截图（本版暂不提供）。
- 不改任何代码或配置语义。
- 不链 `.scratch/`。

## 验收

## Comments

### local — 2026-11-08T04:02:11.561Z
已实施并验证：README.md 从 266 行压到 139 行（预算上限 180），九节结构 = 头部（居中 h1 + 双语互链 + 一句话定位 + 四枚 badge）/ INSTALL / CORE / SKILLS / CONFIG / COMPAT / TROUBLESHOOT / SOURCE，节标题统一用 `<h2 align="center"><sub>EN</sub><br>中文</h2>` 式分节，模板借 FeatherHunter/dsh-opencode-palette 的 README（已抓取 264 行原文比对）。命令全进 bash 代码块且每行带 # 注释，配置/档位/技能/兼容/排障全部表格化，排障压成「现象 / 成因 / 处置」三列一行；正文零行首加粗小标题，层级只用 ## （HTML h2 等价）。

内容取舍：新增「六道问」阶梯表与四档强度表（此前只是散文），删掉整段「部署三形态」与「发布卡口」表（发布卡口是维护者视角，使用者不需要；部署压缩成首装 + tarball 两条命令），删掉「v0.1 装完什么都没有」（0.3.0 之后无人从 0.1 升上来），删掉「仓库结构」树与「与上游的关系」（不属于使用者视角），保留并外链 docs/research/dsh-plugin-contract-0.2.2.md 作为版本区间唯一证据。

两处如实修订：①「改档位有三条等价路径」实为环境变量与 profile 补丁两层生效路径加一条 session 内斜杠命令，改为「优先级 环境变量 > profile 补丁 > 内置兜底」+ bash 与 yaml 两块示例；②`locale` 字段在 src/ 下只有 schema 声明与类型定义、零消费点，README 如实写为「Schemastery 已声明，当前无消费点」而非「提示与技能描述语言」。

验证：node scripts/verify.mjs 通过（26 源文件 / 97 产物 / 1 提醒），node --test test/*.test.mjs 244 条全绿。commit 32d35d4。


## 进度

- 进度：100%（2026-11-08T12:02:11+08:00）：中文 README 九节 139 行落地，commit 32d35d4
