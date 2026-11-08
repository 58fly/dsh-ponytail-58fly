<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-IDEMPOTENCY-KEY: deck-5bf8f2cc-5980366 -->
<!-- DSH-CREATED: 2026-11-08T03:52:42.909Z -->
<!-- DSH-BLOCKED-BY: 03 -->
# 04: README 结构门禁 + 英文版双语一致性检查

**What to build:** 

**Blocked by:** #03

**Status:** ready-for-agent

- [ ] 故意把 README 改到 181 行，`pnpm run check:readme` 报红并指明「超出行数上限」。
- [ ] 故意加一行 `**小标题**`，报红并指明行号。
- [ ] 故意删掉「排障」一节，报红并指明缺失章节。
- [ ] 故意删掉英文版的「兼容」一节，报红并列出「缺失/多出」的标题。
- [ ] 恢复后全绿，输出一行通过语。
- [ ] `checkStructure` 与 `compareHeadings` 各有 `node:test` 单测覆盖上述违规与通过两类样本，`pnpm test` 全绿。
- [ ] `pnpm run prepublishOnly` 链路里能看到 `check:readme` 被执行。
- [ ] `node scripts/verify.mjs` 全绿。

## 要交付什么

README 的排版规则不再靠人肉遵守，而是一条**可执行的门禁**：行数超了、加粗当小标题了、章节被删了、英文版和中文版章节对不上，都会在 `prepublishOnly` 和 CI 里直接红。

同时产出英文版 `docs/README.en.md`，结构与中文版一一对应，正文压到约 80%。

用户已裁决把原计划的「双语一致性」票并入本票——两者共用同一个检查脚本，分开做会撞同一份文件。

## 要做的三件事

### 1. 新建 `scripts/check-readme.mjs`

照 `scripts/check-skills.mjs` 的既有形态写：`failures[]` + `warnings[]` 聚合，末尾一次性打印失败项并 `process.exit(1)`，通过时打印一行通过语。

核心判定抽成**纯函数**（本仓惯例，参照 `verify-published.mjs` 里 `classifyMissing` / `judgeDigest` 的注释「抽成纯函数是为了能离线测」），薄壳只负责读文件。纯函数至少两个：

- `checkStructure(text)` → 违规清单
- `compareHeadings(zhText, enText)` → 缺失/多出的标题清单

`checkStructure` 要查：

- 行数 > 180
- 出现 `**xxx**` 独占一行（加粗段落式小标题）
- 出现 `####` 及以上（只允许 `##` / `###`）
- 九节清单缺项
- badge 四项缺失
- 中英互链行缺失
- 出现 `.scratch/` 链接
- 出现 `![占位]` 形式或指向不存在文件的图片引用

### 2. 写 `docs/README.en.md`

- 章节与中文版**完全一致**（同一组 `##` / `###` 行首标题，标题文字可翻译但层级与顺序必须对齐）。
- 正文压到中文版约 80%，不逐字对照翻译。
- 同样遵守：无加粗小标题、无 `####`、命令进 bash 块、四处表格。

### 3. 挂进门禁

- `package.json#scripts` 加一个 `check:readme`。
- 并进 `prepublishOnly` 链路，与 `check:skills` / `check:matrix` 同级。
- `.github/workflows/ci.yml` 的 `quality` job 里加一步执行它。

## 已验证的既有先例（照抄形态即可）

- `check-skills.mjs`：`failures[]` + `warnings[]` 聚合 + `process.exit(1)`。
- `verify.mjs`：`check(condition, message)` 收集失败、一次性报出。
- `test/l0.test.mjs`：`import assert from 'node:assert/strict'; import { test } from 'node:test';` 直接 import 纯函数，不起 Cordis、不碰文件系统。

## 不做

- 不改中文 README 的内容（下一张票定稿后本票只管守）。
- 不加第三语言。
- 不引入任何新依赖（node 内置能力足够）。

## 验收


## 进度
