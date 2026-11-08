<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-IDEMPOTENCY-KEY: deck-8492f1bd-5980366 -->
<!-- DSH-CREATED: 2026-11-08T03:52:28.294Z -->
<!-- DSH-BLOCKED-BY: 02 -->
# 03: 中文 README 重排为九节 ≤180 行

**What to build:** 

**Blocked by:** #02

**Status:** ready-for-agent

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


## 进度
