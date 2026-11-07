# 技能正文真源与语言策略：上游最新 vs 冻结 commit、六阶/七阶口径、中文改写边界

> **本目录材料的定位**
> - `upstream-ponytail-source-audit.md`：```wenaixi/dsh-ponytail@5.6.2` 的机制层源码审计（缺陷分级 + `file:line`）。
> - `ponytail-plugin-landscape.md`：13 个 npm 派生包 / 14 个 GitHub 仓的生态横向对比。
> - `dsh-plugin-contract-0.2.2.md`：宿主 0.2.2 的插件契约实测。
> - **本文**：回答「技能正文该以谁为真源、中文正文能不能落地」这组前置问题，供 #08 票定案，也是后续重写 `skills/*/SKILL.md` 的内容基线。

> 对象一：真上游 `github.com/DietrichGebert/ponytail`，实测 HEAD `96608e0`（2026-10-29 12:59:31 +0100），最新 tag `v5.3.3` = `7801d06`（2026-10-29 04:04:54 +0100）。浅克隆在 `/tmp/dietrich-ponytail`。
> 对象二：派生 `github.com/Wenaixi/dsh-ponytail`，commit `7223820` / v5.6.2，副本在 `/tmp/dsh-ponytail-upstream`。
> 对象三：本机宿主 DSH `0.2.2-rc.1`，`/Applications/DeepSeek Harness.app/Contents/Resources/app/dsh/node_modules/@deepseek-ai/`。**该三包内无 `*.dshpurge.bak`**（全 app 共 63 个 bak，均不在 `dsh-skill` / `dsh-tool-skill` / `dsh-skill-filesystem` 内），故技能面可作官方语义引用。
> 全文结论均带 `file:line` 或可复现命令与输出；无一处「我认为」。

## 摘要

六条实测结论，四条推翻既有前提：

1. **真上游仍在维护，但技能正文自 2026-10-08 起冻结**：HEAD 距离最新 tag `v5.3.3` 仅 1 个提交，且 `skills/` 与 `.agents/rules/ponytail.md` **零变更**（`git rev-list --count` = 0，`diff --stat` 空输出）。冻结 tag 与跟随 main 在内容上等价，tag 引用可作确定性锚点。
2. **Wenaixi 的技能正文不是中文改写，是英文原文**：6 个文件 CJK 字符数全部为 0；`README.zh-CN.md:71` 自述「技能正文全部取自上游 v4.10.3，按原样保留英文」——与实测一致。票面「Wenaixi 做了中文改写」的前提证伪。
3. **Wenaixi 落后上游一个大版本**：其 6 个正文对应上游 `b6c0448`（v4.10.3 期）快照，逐字节相同的有 4 个；上游 `01cbf81`「Ponytail 5」重写后 ponytail 正文从 120 行降到 52 行。Wenaixi 的 7 阶梯子即 v4.10.3 原文。
4. **六阶是上游当前口径，七阶是上游 2026-10-08 之前的原文**——不是「社区本地化改写」。但上游 README 配图的 alt 文本仍写七阶，上游自己口径不统一。
5. **`catalogDescriptionMaxLength` 默认 500，计量单位是 UTF-16 code unit**，截断为 `slice(0, max-3) + "..."`。当前 12 条描述全部未超（最险 `en/ponytail` = 492，余量 8）。
6. **宿主技能匹配不是检索，是把描述渲染成文本给模型读**：两个包内 `embedding|fuzzy|levenshtein|similarity|scoreSkill|matchSkill|rankSkills` 零命中。真正的字面匹配只有用户 `/name` 手势正则，且只认 kebab-case ASCII。

---

## 一、真源策略：冻结 tag 还是跟随 main

### 1.1 上游真实状态（2026-11-07 实测）

| 项 | 值 | 命令 |
|---|---|---|
| HEAD sha | `96608e078b2d5ea607c5c3b8b5a54d1c1fba6846`（`refs/heads/main`） | `git ls-remote https://github.com/DietrichGebert/ponytail refs/heads/main` |
| HEAD 提交时间 | 2026-10-29 12:59:31 +0100 | `git log -1 --format='%H %cI %s'` |
| HEAD 标题 | `docs: add PhotoReunion to Already built with Ponytail (#1313)` | 同上 |
| 最新 tag | `v5.3.3` = `7801d06`，2026-10-29 04:04:54 +0100 | `git for-each-ref --sort=-creatordate refs/tags` |
| HEAD 距 tag 的提交数 | 1（纯 README docs） | `git rev-list --count v5.3.3..origin/main` |
| 对技能正文的变更 | **0** | `git diff --stat v5.3.3 origin/main -- skills/ .agents/rules/ponytail.md`（空输出，exit=0） |

tag 时间线（同一命令输出）：`v5.0.0 b088b2d` 10-08 05:51 → `v5.1.0 9cc65d0` 10-08 18:19 → `v5.1.1 6135ace` 10-13 01:14 → `v5.2.0 2961b52` 10-13 03:46 → `v5.3.0 742e0ab` 10-16 09:46 → `v5.3.1 6f1c2bf` 10-16 15:20 → `v5.3.2 16352ac` 10-17 01:04 → `v5.3.3 7801d06` 10-29 04:04。**自 10-08 起共 8 个 tag，无一改动 `skills/`**（见 §1.2 树指纹）。

### 1.2 内容快照指纹（可直接当冻结基准）

| 快照 | `skills/` 树对象 | `.agents/rules/ponytail.md` blob |
|---|---|---|
| 上游 `v5.3.3` / `HEAD` | `269bc3e0e49c5b2613ea83775f9cade599cc4021` | `b314fa6ea92e5ee4f3557f374e9d64213c95bb61`（2623 B，sha256 `ca99e5958383063029b206c7c50a0eaad1c29914a362bedd46033ec16b537e1e`） |
| 上游 `b6c0448` / `ef8ca48`（v4.10.3 期） | `d15d0642cedda91d97cd882333d2c70c564c6f52` | `0af61d583fbd42e8900fce9183d68167eb3d93e6` |

逐文件 sha256（`v5.3.3`，`git show v5.3.3:skills/<n>/SKILL.md | shasum -a 256`）：

| 技能 | 行数 | 字节 | sha256 前 16 |
|---|---|---|---|
| `ponytail` | 52 | 3496 | `9badd22a32e19cb8` |
| `ponytail-review` | 101 | 5143 | `33fe4ebe22a46092` |
| `ponytail-audit` | 103 | 5417 | `2b3223a02c386d12` |
| `ponytail-debt` | 44 | 1769 | `b5ec2762f6ba8c4a` |
| `ponytail-gain` | 52 | 2164 | `231034a896d6762e` |
| `ponytail-help` | 76 | 3188 | `86ab0ce0af70cbee` |

`AGENTS.md`（v5.3.3）32 行，sha256 `b98b15e1d683ee205e124b52b8d330128593f4a87b545cf8185e2712cd1bb25f`。

### 1.3 确定性 raw URL 与字节一致性（实测 HTTP 200）

`main` 与 `v5.3.3` 的规则文件**字节完全相同**，因此引用 tag 不损失新鲜度：

| URL | HTTP | 大小 | sha256 前 16 |
|---|---|---|---|
| `https://raw.githubusercontent.com/DietrichGebert/ponytail/main/.agents/rules/ponytail.md` | 200 | 2623 B | `ca99e59583830630` |
| `https://raw.githubusercontent.com/DietrichGebert/ponytail/v5.3.3/.agents/rules/ponytail.md` | 200 | 2623 B | `ca99e59583830630` |
| `https://raw.githubusercontent.com/DietrichGebert/ponytail/main/skills/ponytail/SKILL.md` | 200 | 3496 B | `9badd22a32e19cb8` |

→ **可确定性引用模板**：`https://raw.githubusercontent.com/DietrichGebert/ponytail/v5.3.3/<repo-relative-path>`。tag 是不可变引用，sha 与字节都可复算；`main` 随时可能前进。

### 1.4 策略建议

**冻结 `v5.3.3` 的内容快照为正文真源，CI 每日 diff 报警（不做自动 sync）。**

理由，逐条有据：

1. **冻结不损失新鲜度**：`skills/` 自 10-08 起零变更（§1.2 树指纹 `269bc3e…` 覆盖 v5.3.3 与 HEAD 两端），冻结 tag 与跟 main 当前等价。
2. **自动 sync 会引入不可控变更面**：`01cbf81` 一次提交改了 7 个文件、267 insertions / 241 deletions（ponytail 134 行、review 153、audit 121、debt 8、gain 33、help 17、规则 42），技能语义整体换血。这类改动必须走人工评审，不能自动合并。
3. **上游没有 DSH 适配层可抄**：上游仓根无 `src/`、无 `*.ts` 入口（`find` 只命中 `hooks/band/*.ts` 与 `.opencode/plugins/index.js`）；`grep -r 'deepseek|dsh-'` 只命中 `docs/agent-portability.md`。所以不管冻结还是跟随，DSH 侧胶水都得自写，跟随上游不能省这部分工作。
4. **我们的正文本来就要改**（见 §二：上游 v5 是英文且与 Wenaixi 结构不同），冻结基准比跟 main 更利于审 diff。

### 1.5 一条能验证「没漏掉变更」的命令

装进 CI（每日 09:00），三项任一非零即报警：

```bash
set -euo pipefail
UP=https://github.com/DietrichGebert/ponytail
PEG=v5.3.3                                             # 冻结锚点
EXPECT_TREE=269bc3e0e49c5b2613ea83775f9cade599cc4021   # v5.3.3:skills
EXPECT_RULE=b314fa6ea92e5ee4f3557f374e9d64213c95bb61   # v5.3.3:.agents/rules/ponytail.md

git -C "$CACHE" fetch --quiet --tags --force "$UP" '+refs/heads/main:refs/remotes/origin/main'
echo "upstream HEAD = $(git -C "$CACHE" rev-parse origin/main)"

# (1) 正文是否被改（答案必须为空）
git -C "$CACHE" diff --stat "$PEG" origin/main -- skills/ .agents/rules/ponytail.md

# (2) 树与规则 blob 是否漂移（两条 test 都必须通过）
test "$(git -C "$CACHE" rev-parse "$PEG:skills")" = "$EXPECT_TREE"
test "$(git -C "$CACHE" rev-parse "$PEG:.agents/rules/ponytail.md")" = "$EXPECT_RULE"

# (3) 期间是否出现新 tag（新 tag 必须人工过一遍）
git -C "$CACHE" tag --sort=-creatordate | head -3
```

实测基线（2026-11-07，在 `/tmp/dietrich-ponytail` 跑）：(1) 空输出、(2) 两条 test 通过、(3) 首行 `v5.3.3`。

---

## 二、两边技能正文逐文件对比

### 2.1 目录结构差异

| 形态 | 上游 DietrichGebert | Wenaixi |
|---|---|---|
| 技能目录 | `skills/<name>/SKILL.md`（6 个）+ `skills/plugin.json` | 同左，**另加** `skills/descriptions.en.json`（2302 B）、`skills/descriptions.zh.json`（2368 B） |
| 常驻规则 | `AGENTS.md`（32 行）+ `.agents/rules/ponytail.md`（30 行）+ 各宿主 rule 副本（`.cursor/` `.kiro/` `.windsurf/` `.clinerules` 等） | 无独立规则文件，规则改由 `ctx.systemPrompt.section` 注入（`src/ponytail.ts:369-374`） |
| 版本 | `package.json` name `\@dietrichgebert/ponytail`，version `5.3.3` | `\@wenaixi/dsh-ponytail` 5.6.2 |
| 描述真源 | SKILL.md frontmatter `description` | `descriptions.{zh,en}.json` 优先，frontmatter 兜底（`src/ponytail-skills.ts:348`） |
| 上游 `descriptions.*.json` | **不存在**（`git ls-tree -r --name-only v5.3.3 | grep -i descriptions` → 无输出） | 存在，是本仓自造 |

### 2.2 六个文件横向对比

行数 / 字节为 `wc -l` / `wc -c`；「中文改写」由 CJK 正则 `/[\u4e00-\u9fff]/g` 计数判定。

| 文件 | 上游 v5.3.3 行/字节 | Wenaixi 行/字节 | 上游 CJK | Wenaixi CJK | 是否中文改写 | 结构差异要点 |
|---|---|---|---|---|---|---|
| `skills/ponytail/SKILL.md` | 52 / 3496 | 120 / 6637 | 0 | 0 | **否** | 上游：`# Ponytail` / `## Before you write` / `## The smallest complete change`（六阶）/ `## Levels`。Wenaixi：`## Persistence` / `## The ladder`（七阶）/ `## Rules` / `## Output` / `## Intensity` / `## When NOT to be lazy` / `## Boundaries`——完全不同代 |
| `skills/ponytail-review/SKILL.md` | 101 / 5143 | 57 / 2383 | 0 | 0 | **否** | 上游四段式 `## 1. Understand first` / `2. Look for` / `3. Check before you report` / `4. Output`（101 行，清单密集）。Wenaixi 五段 `## Format` / `## Examples` / `## Scoring` / `## Boundaries`（57 行，示例驱动） |
| `skills/ponytail-audit/SKILL.md` | 103 / 5417 | 41 / 1652 | 0 | 0 | **否** | 同上换主语（`## 1. Map first` 起）。Wenaixi `## Tags` / `## Hunt` / `## Output` / `## Boundaries`（41 行） |
| `skills/ponytail-debt/SKILL.md` | 44 / 1769 | 44 / 1703 | 0 | 0 | **否** | 段名完全一致（`## Scan` / `## Output` / `## Boundaries`），差异在标记词：上游收 `shortcut:` 与旧 `ponytail:`，Wenaixi 只收 `ponytail:` |
| `skills/ponytail-gain/SKILL.md` | 52 / 2164 | 50 / 2009 | 0 | 0 | **否** | 段名一致；Wenaixi 把 `benchmarks/` 路径改成 `assets/benchmark-3model.svg` / `assets/benchmark-agentic.svg`（2 行差异） |
| `skills/ponytail-help/SKILL.md` | 76 / 3188 | 81 / 2878 | 0 | 0 | **否** | 段名基本一致；Wenaixi 把 `Config file` 一段换成 `Profile patch cordis.patch.yml`，`## Update` 段改为 `dsh plugin --profile <name> add \@wenaixi/dsh-ponytail`（26 行差异） |

**判定**：Wenaixi 的 6 个 SKILL.md **全部是英文正文**，CJK 计数全 0。全仓 `grep` CJK（排除 `locale/`、`README*`、`lib/`、`CHANGELOG`、`CONTEXT`）亦零命中。票面「Wenaixi 版把技能正文做了中文改写」不成立。

### 2.3 Wenaixi 的真实来源：上游 v4.10.3 快照

`cmp` 逐文件对照 Wenaixi 与上游 `b6c0448`、`ef8ca48`（v4.10.3 release）：

| 技能 | 与 `b6c0448` | 与 `ef8ca48`（v4.10.3） |
|---|---|---|
| `ponytail` | IDENTICAL | IDENTICAL |
| `ponytail-review` | IDENTICAL | IDENTICAL |
| `ponytail-audit` | IDENTICAL | IDENTICAL |
| `ponytail-debt` | IDENTICAL | IDENTICAL |
| `ponytail-gain` | DIFFERS 2 行 | — |
| `ponytail-help` | DIFFERS 26 行（`b6c0448` 是 71 行，Wenaixi 81 行） | — |

且 `git rev-parse b6c0448:skills` 与 `ef8ca48:skills` 同为 `d15d0642cedda91d97cd882333d2c70c564c6f52` → v4.10.3 的 6 个正文与 `b6c0448` 完全一致。

**结论**：Wenaixi 正文 = 上游 **v4.10.3 英文原文** + 2 处 DSH 适配（`gain` 的资源路径、`help` 的安装命令）。`README.zh-CN.md:71` 的自述与此完全吻合。所谓「6 个中文原生技能」是 `locale/zh.json:25` 的营销话术，实为**描述中文、正文英文**。

### 2.4 frontmatter 差异（两边都只有 `name` / `description`）

| 项 | 上游 v5.3.3 | Wenaixi |
|---|---|---|
| `name` | 6 个，与目录名一致 | 同 |
| `description` | 折叠块（`>`），含英文触发词与等级说明 | 折叠块，含英文触发词、`Do NOT use for` 负例 |
| `argument-hint` | 仅 `ponytail` 有：`[lite|full|ultra|off]` | 仅 `ponytail` 有：`[lite|full|ultra]`（去掉 `off`） |
| `license` | 仅 `ponytail` 有 `MIT` | 同 |
| `disable-model-invocation` | **6 个都无** | **6 个都无**（`grep -rn` 在 `skills/` 零命中） |
| `user-invocable` | 无 | 无 |

`grep -rn 'disable-model-invocation|user-invocable|disableModelInvocation|userInvocable' /tmp/dsh-ponytail-upstream/skills` → 无输出，即两个仓都吃宿主默认 `{modelInvocable:true, userInvocable:true}`。

---

## 三、六阶还是七阶

### 3.1 上游当前是三处同文的六阶

三份规则文件，段名与编号条目完全一致：

| 文件 | 段标题行 | 引导句 | 编号条目行 |
|---|---|---|---|
| `AGENTS.md`（v5.3.3） | `:9` `## The smallest complete change` | `:11` `Take the first option that fully works:` | `:13`–`:18` |
| `.agents/rules/ponytail.md`（v5.3.3） | `:9` | `:11` | `:13`–`:18` |
| `skills/ponytail/SKILL.md`（v5.3.3） | `:23` | `:25` | `:27`–`:32` |

六条原文（`.agents/rules/ponytail.md:13-18`）：

1. `Does it need to exist?`
2. `Already in this codebase (a helper, component, service, pattern)?`
3. `Standard library or a platform feature?` ← **两条并成一条**
4. `An installed dependency?`
5. `Can it be one line a reader gets at a glance?`
6. `Otherwise: the minimum code that works.`

`grep -cE '^[0-9]+\. ' .agents/rules/ponytail.md` = 6。

### 3.2 七阶是上游自己的旧原文

| 快照 | 段名 | 条数 | 关键差异 |
|---|---|---|---|
| `b6c0448`（v4.9.0–v4.10.3 期）`skills/ponytail/SKILL.md:32-42` | `## The ladder` | **7** | 第 3 条 `Stdlib does it?` 与第 4 条 `Native platform feature covers it?` **分列** |
| 上游 HEAD `skills/ponytail/SKILL.md:27-32` | `## The smallest complete change` | 6 | 二者合并为 `Standard library or a platform feature?` |

转折点：`01cbf81` = `01cbf815429e89dcf37b7d2d2a8b593e886fcae1`，2026-10-08T05:49:34+02:00，`feat: Ponytail 5, rebuilt rules, review and audit (#1061)`。该提交里 `skills/ponytail/SKILL.md` 是 33 insertions / 101 deletions——**删得比加得多**，就是把长文压成短规则。

七阶原文（Wenaixi `skills/ponytail/SKILL.md:32-42`，与上游 `b6c0448` 逐字节相同）：`1 Does this need to exist at all?` / `2 Already in this codebase?` / `3 Stdlib does it?` / `4 Native platform feature covers it?` / `5 Already-installed dependency solves it?` / `6 Can it be one line?` / `7 Only then: the minimum code`，`grep -cE '^[0-9]+\. '` = 7。

### 3.3 「七阶」这个说法为什么还在流通

两处独立来源，都不是「社区改写」：

**（a）Wenaixi 照 v4.10.3 移植后未跟上游重写**。仓内仍写七阶的地方：

| 位置 | 原文 |
|---|---|
| `locale/zh.json:23`、`:25` | 「七阶梯子」 |
| `locale/en.json:23`、`:25` | `7-rung ladder`、`seven-rung ladder` |
| `README.md:16`、`:42`、`:62` | seven-rung |
| `README.zh-CN.md:16` | 七阶 |
| `package.json:4` | 七阶 |
| `docs/adr/0002-zero-model-tools-pure-system-prompt.md:15` | 「梯子七阶」 |
| `docs/adr/0012-*.md:42` | 七阶 |
| `scripts/behavior.test.mjs:110` | `assert(out.includes('## The ladder'))` ← 测试把旧段名写死了 |

**（b）上游自己的 README 图注仍是七阶**（配图没跟着正文重画）：

| 位置 | 内容 |
|---|---|
| `README.md:135` | img alt 明文列出 7 条：does this need to exist / already in this codebase / does the standard library do it / a native platform feature / an installed dependency / can it be one line / only then the minimum that works |
| `i18n/README.zh-CN.md:133` | 「1 这东西需要存在吗…7 只有到这一步才写能跑的最少代码」 |
| `i18n/README.ja.md:133`、`README.ko.md:133`、`README.es.md:133` | 同 7 条 |
| 配图 | `assets/v5/ladder.png`（v5.3.3 blob `d76da033efdfe7d170a46875bb19db856ac63505`） |

→ **上游正文与图注自相矛盾**：规则三处六阶，配图与 alt 七阶。任何引用上游 README 的人都会读到七阶。

### 3.4 对外文案口径建议

| 场景 | 建议表述 |
|---|---|
| 主文案（一句话介绍） | 「按『最小完整改动』的六阶梯子推进：先问要不要做，再依次找现成实现、标准库/平台能力、已装依赖、单行写法，最后才写最小代码。」 |
| 提到阶梯数量时 | 统一说 **六阶**，并注明「对应上游 v5.3.3 正文；上游 README 配图仍为旧版七阶图注，以正文为准」。 |
| 引用图片时 | 要么重画六阶图，要么在图下加一行「图注为上游 v5.3.3 之前的旧版七阶，规则正文已合并第 3、4 阶」。 |
| 迁移兼容说明 | 文档里保留一句「v4.10.3 及之前的七阶（标准库与平台原生分列）在 v5 合并为第 3 阶」——这是唯一该出现「七阶」的地方。 |

---

## 四、`descriptions.*.json` 的 500 字符上限

### 4.1 宿主实际默认值（0.2.2-rc.1 实测）

票面写的 `dsh-tool-skill/lib/index.js:52` **是错的**，真实位置：

| 项 | 值 | 位置 |
|---|---|---|
| 常量 | `const DEFAULT_CATALOG_DESCRIPTION_MAX_LENGTH = 500;` | `dsh-tool-skill/lib/index.js:768` |
| 配置 schema | `z.object({ catalogDescriptionMaxLength: z.number().default(500) })` | `:777` |
| 生效 | `config.catalogDescriptionMaxLength ?? DEFAULT_CATALOG_DESCRIPTION_MAX_LENGTH` | `:785` |
| 合法范围 | `assertPositiveInteger("catalogDescriptionMaxLength", catalogDescriptionMaxLength, 3)` → **最小 3** | `:786` |
| 文档记载 | README.zh.md:48 默认 500、最小 3 | — |

`DEFAULT_CATALOG_DESCRIPTION_MAX_LENGTH` 在包内仅两处引用（`:768` 定义、`:777` 作为 default），无别名覆盖。

### 4.2 截断实现与计量单位

```js
// dsh-tool-skill/lib/index.js:1094-1096
function catalogDescription(value, maxLength) {
	const normalized = value.replaceAll(/\s+/g, " ").trim();
	return normalized.length <= maxLength
		? normalized
		: normalized.slice(0, maxLength - 3) + "...";
}
```

三个必须知道的行为：

1. **先归一化**：所有空白（换行、制表、多空格）压成单空格并 `trim`。折叠块 `>` 写的多行 description 到这里变成一行，长度按折叠后算——**不是按 YAML 源文件字节**。
2. **计量单位是 JS `.length`，即 UTF-16 code unit**。不是 grapheme cluster，也不是 Unicode code point。
3. **截断后追加 `...`（3 个 ASCII 点）**，所以实际保留 `maxLength - 3` 个 code unit。

（上面最后一行在源码里是模板字符串；此处改写为 `+` 字符串拼接，语义完全等价。）

实测（与上面实现同构的脚本，在 `/tmp/dsh-ponytail-upstream` 下跑）：

| 输入 | `out.length` | code point 数 | 结果 |
|---|---|---|---|
| 600 个汉字 | 500 | 500 | 以 `...` 结尾，汉字未被切坏（BMP 单 code unit） |
| U+1F680（火箭 emoji）重复 300 次 = 600 code units | 500 | 252 | 尾部留下**半个代理对** → 渲染为 `U+FFFD` 乱码 |

→ 代理对会被切坏是真实风险，但只在混入非 BMP 字符（emoji、部分中日韩扩展区）时出现。

### 4.3 当前素材的实测长度

在 `/tmp/dsh-ponytail-upstream` 下按上述 `catalogDescription` 实现计算（`u16` = `.length`，另算出 code point 与 grapheme 作对照）：

| 技能 | `zh` u16 | 余量 | `en` u16 | 余量 |
|---|---|---|---|---|
| `ponytail` | 261 | 239 | **492** | **8** |
| `ponytail-review` | 164 | 336 | 422 | 78 |
| `ponytail-audit` | 161 | 339 | 358 | 142 |
| `ponytail-debt` | 164 | 336 | 367 | 133 |
| `ponytail-gain` | 160 | 340 | 278 | 222 |
| `ponytail-help` | 103 | 397 | 200 | 300 |

12 条全部 `u16 == codePoint == grapheme`（纯 ASCII + BMP 中文，无代理对、无组合字符）→ **对当前素材三种计数法等价**；但校验脚本仍必须按 u16 算，否则换素材就与宿主不同步。

`en/ponytail` 只剩 8 个字符余量，是最危险的一条：任何一句英文补充都会触发截断，而截断点落在描述尾部——按 §4.2 的 `slice(0, max-3)` 语义，尾部正是触发词密集区（`Levels: lite, full (default), ultra.`）。

### 4.4 校验脚本口径

**规则：按宿主同一实现算，即「折叠空白 + trim 后取 `.length`（UTF-16 code unit）」，阈值取 480 而非 500。**

```js
// check-desc.mjs —— 与 dsh-tool-skill/lib/index.js:1094-1096 逐字同构
const MAX = 480;                                            // 宿主默认 500，预留 20 余量给文案微调
const normalize = (s) => s.replaceAll(/\s+/g, " ").trim();   // 先归一化，再量长度
const u16 = (s) => s.length;                                 // 宿主就是 .length
const truncate = (s, m) => (u16(s) <= m ? s : s.slice(0, m - 3) + "...");

for (const lang of ["zh", "en"]) {
  const file = "skills/descriptions." + lang + ".json";
  for (const [name, raw] of Object.entries(readJson(file))) {
    const n = normalize(raw);
    const len = u16(n);
    const ok = len <= MAX;
    console.log((ok ? "ok   " : "TRUNC") + " " + lang + "/" + name
      + " u16=" + len + " headroom=" + (MAX - len));
    if (!ok) {
      console.error("  tail-of-truncation: ..." + truncate(n, MAX).slice(-40));
      process.exitCode = 1;
    }
  }
}
```

三条附则：

1. **禁止用 grapheme 或 code point 计数**：它们与宿主的 `.length` 不一致，会在含 emoji 时给出「通过」而宿主实际截断。
2. **禁止按 YAML 源字节/源行数算**：宿主先做空白折叠，折叠块写法与单行写法量出来的长度不同。
3. **必须打印截断后的尾巴**：只报「超了」不够，要让人看见被切掉的是哪个触发词。实测把 `MAX` 改成 200 后，`zh/ponytail` 的尾巴变成 `/ 最简解法 / 最小解法 / yagni / 少做一...`——触发词正好在切口上，这就是 500 上限真正会造成的伤害。

---

## 五、`disable-model-invocation` 要不要用

### 5.1 双方实现一致（这一点无需重写）

| 实现 | 位置 | 逻辑 |
|---|---|---|
| Wenaixi | `src/ponytail-skills.ts:145-155` | `:146-148` 三个旧键 `rejectLegacyKey`；`:149-150` `frontmatterBoolean`；`:151-154` 返回 `{ modelInvocable: disableModelInvocation !== true, userInvocable: userInvocable !== false }` |
| 宿主 | `dsh-skill-filesystem/lib/index.js:863-873` | 同形（`:874-876` `rejectLegacyInvocationKey`、`:877-881` `frontmatterBoolean`） |
| 宿主默认 | `dsh-skill/lib/index.js:203-206` | `invocation: skill.invocation ?? { modelInvocable: true, userInvocable: true }` |
| 校验 | `dsh-skill/lib/index.js:504-509` | 两字段必须为 boolean，否则 `TypeError` |

**票面第 5 问的措辞要纠一处**：`src/ponytail-skills.ts` 是 **Wenaixi** 的实现，上游没有 `src/`（§1.4 第 3 条）。但「已正确处理」这个判断成立，且宿主侧同形，所以移植时**不需要自写 invocation 解析**。

### 5.2 全量 `disable-model-invocation: true` 会怎样

| 环节 | 行为 | 位置 |
|---|---|---|
| 目录渲染 | 只收 `modelInvocable` 的技能：`snapshot.skills.filter(isModelInvocable)` | `dsh-tool-skill/lib/index.js:944` |
| 模型加载 | 双重校验：`throw ... not available for model invocation` | `:875`（list 侧）、`:878`（get 侧） |
| 用户手势 | 只要求 `userInvocable`：`if (skill === void 0 || !isUserInvocable(skill)) continue` | `:911` |
| 四象限语义 | `{true,true}` 两目录都含；`{true,false}` 仅模型；`{false,true}` 仅用户；`{false,false}` 都排除 | `dsh-skill/README.zh.md:59-62` |

→ 6 个全 `disable-model-invocation: true` 的实际后果：**6 个技能全部从 `<available_skills>` 目录消失**（`:945` 拿到的 `skills` 为空 → `:955` 走「无技能」分支），模型的 `skill` 工具一调就抛错；只有用户手打 `/ponytail` `/ponytail-review` 等还能加载。

**与地图判据 3 的关系**：判据 3 原文（`map.md:16`）是「保持零 tool 注册；6 个技能全部经 skill provider 暴露」。字面上 `registerProvider` 仍注册了 6 个（`src/ponytail.ts:261-262`），但**模型侧不可见**——判据 3 的意图（模型能自主发现并使用这 6 个技能）被实质否定。所以「全部禁用」与判据 3 冲突。

### 5.3 建议

**6 个技能一律不加 `disable-model-invocation` / `user-invocable`，吃宿主默认 `{true, true}`。**

理由：

1. **技能的存在意义是模型可自主加载**。上游把 6 个技能的 `description` 全部写成「Use when the user says X」的触发词清单（`skills/ponytail/SKILL.md:3-8` 等），这个设计只在模型能读目录时才有用；禁用后 `description` 变成死字段。
2. **与判据 3 直接冲突**：地图已定「6 个技能全部经 skill provider 暴露」（`map.md:16`），全禁用会让判据 3 只剩字面成立、语义失效。
3. **重复内容不是靠禁用解决的**：担心「主技能正文与常驻 section 重复进上下文」是对的方向，但正确解法是**正文分层**（section 只放规则骨架，SKILL.md 放工作流与示例），不是把技能从目录里摘掉。上游 v5 已经是这个方向——`skills/ponytail/SKILL.md` 52 行里有约 30 行与 `.agents/rules/ponytail.md` 同文，但 review / audit / debt / gain / help 5 个都是纯增量内容。
4. **如果确实想让某个技能只被用户手势触发**（候选：`ponytail-help`，纯速查卡，模型主动加载价值低），那也只能**单独对它**设 `disable-model-invocation: true` + `user-invocable: true`，并把判据 3 的措辞改成「5 个模型可调 + 1 个仅用户可调」。不要整批禁。

顺带记两条移植时必须保留的细节：

- **rank 必须低于 600**：`dsh-skill/lib/index.js:23` `BUNDLED_SKILL_RANK = 600`，排序 `:520` 按 rank 升序，`:314-322` 同名先到者胜并 warn。Wenaixi 取 `PONYTAIL_RANK = 550`（`src/ponytail-skills.ts:101`）——低于宿主内置，同名时宿主赢。要与 Wenaixi 行为一致就沿用 550；要夺过宿主同名技能就得 <100（`PROJECT_DSH_RANK`，`dsh-skill-filesystem/lib/index.js:20`），但那会压过用户的 project 技能，不建议。
- **技能开关是 Wenaixi 自造的**：`src/ponytail.ts:61` `disabledSkills: Schema.array(Schema.string()).volatile()`，`:269` 注入 `isSkillEnabled`，`:359` / `:374` 在 list/get 两侧过滤，`:297` `touched.has('disabledSkills')` 触发缓存失效。宿主无此概念——要么自写，要么砍掉（判据里没要求）。

---

## 六、中文正文下英文触发词是否失效

### 6.1 宿主的技能「匹配」不是检索

完整链路，三段代码可闭环：

| 阶段 | 实现 | 位置 |
|---|---|---|
| 收集 | `snapshot.skills.filter(isModelInvocable)` | `dsh-tool-skill/lib/index.js:944` |
| 渲染 | `renderCatalogEntries`：每个条目一行「- 名字: 描述」，名字包反引号，描述经 `escapeText` | `:1028-1030` |
| 包裹 | 拼成 `<system-reminder>…<available_skills>…</available_skills>…</system-reminder>` 一条 user message | `:966-991`（首见）、`:992-1010`（变更） |
| 转义 | `escapeText` 只转义 `&` `<` `>`（`dsh-skill/lib/index.js:91-93`） | — |

**没有任何检索、向量、模糊匹配或打分**。硬证据：`grep -nE 'embedding|fuzzy|levenshtein|similarity|scoreSkill|matchSkill|rankSkills' dsh-tool-skill/lib/index.js dsh-skill/lib/index.js` → **零命中**。目录排序是纯字典序（`dsh-skill/lib/index.js:511-513` `compareSkillSummary` 调 `compareCodePoints(left.name, right.name)`），与描述内容无关。

→ **描述是纯文本给模型读的**，触发词是否生效取决于模型的语义理解，不取决于任何字面匹配。**英文触发词放在中文正文旁边仍然有效**：模型读的是「- ponytail: Lazy senior dev mode… Use on any coding task…」这一整行，语言不一致不构成机制障碍。

### 6.2 中文描述会不会失效？不会，但有一个真实代价

| 维度 | 判定 | 依据 |
|---|---|---|
| 编码/解析 | 无风险 | 宿主全程 utf8 读文件（`dsh-skill-filesystem/lib/index.js:731-733`），frontmatter 解析支持任意 Unicode |
| 转义 | 无风险 | `escapeText` 只碰 `&` `<` `>`，中文原样通过 |
| 长度 | 有风险 | 中文 u16 长度约等于字符数，500 上限对中文反而比英文宽松（实测 zh 全部 ≤ 261） |
| 模型理解 | 无风险 | 描述进上下文原文，模型直接读 |

真正的收益/代价是**触发词覆盖面**，不是技术可行性：

- 上游 `description` 的触发词是英文短语（`be lazy`、`simplest solution`、`yagni`），中文用户不会说这些。
- Wenaixi 的做法（`skills/descriptions.zh.json`）是**双语并存**：中文短句 + 保留 `/ponytail-xxx` 斜杠命令名 + 保留 `yagni` 这类英文术语作触发词。这是可复用的形态。

### 6.3 唯一会因中文而真正失效的机制：斜杠手势

```js
// dsh-tool-skill/lib/index.js:1108
const SKILL_GESTURE = /(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/g;
```

| 约束 | 含义 | 位置 |
|---|---|---|
| 只认 `[a-z0-9]` 与 `-` | 技能名必须是 **kebab-case ASCII**，中文名永远匹配不到 | `:1108` |
| 前后必须是空白或行首行尾 | 命令紧跟中文全角逗号时 `(?=\s|$)` 失败——**中文标点紧贴斜杠命令会漏匹配** | `:1108` |
| 只扫用户消息 | `if (message.source.kind !== "user") continue`，且只扫 `block.type === "text"` | `:1119-1122` |
| 消费时只校验 userInvocable | `if (skill === void 0 || !isUserInvocable(skill)) continue` | `:911` |

→ 两条必须遵守的命名/文案纪律：

1. **6 个技能名保持英文 kebab-case**，与上游一致（地图 `map.md:60` 已定这一条）。
2. **文档里教用户打斜杠命令时，命令后必须留空格或换行**，不要写成「/ponytail，试试」——全角逗号不是 `\s`，手势不触发。这是全篇唯一「中文真的会让功能失效」的地方，且与正文语言无关，只与命令相邻字符有关。

---

## 七、对重写的直接结论

| 决策点 | 结论 | 依据 |
|---|---|---|
| 正文真源 | 冻结上游 `v5.3.3`（`skills/` 树 `269bc3e…`），CI 每日 diff 报警 | §1.2、§1.4、§1.5 |
| 引用形式 | `raw.githubusercontent.com/DietrichGebert/ponytail/v5.3.3/<path>`，不用 `main` | §1.3 |
| 是否沿用 Wenaixi 正文 | **不沿用**：它是 v4.10.3 快照，已落后上游一个大版本 | §2.3 |
| 正文语言 | 以**中文重写**为主、保留英文触发词与命令名——技术上完全可行，宿主不参与语言判定 | §6.1、§6.2 |
| 阶梯口径 | 对内外统一说**六阶**；引用上游配图时加旧版七阶说明 | §3.4 |
| 描述字数 | 校验阈值 480，按「折叠空白 + .length（UTF-16）」计；`en/ponytail` 现 492 必须精简 | §4.3、§4.4 |
| invocation | 6 个全部吃默认 `{modelInvocable:true, userInvocable:true}`；若要单独收 `ponytail-help`，只对它一个设 | §5.3 |
| 技能名 | 6 个保持上游 kebab-case 英文名；文案里命令后留空白 | §6.3 |
| rank | 沿用 `550`（低于宿主 bundled 600） | §5.3 |

## 附录：覆盖范围与未核实项

**已核实（可复跑）**

- 上游 HEAD sha / 时间 / 标题、8 个 tag 的时间线、`v5.3.3..main` 对 `skills/` 与规则文件的零变更（`git ls-remote` / `git log` / `git rev-list` / `git diff --stat`）。
- 上游与 Wenaixi 6 个 SKILL.md 的行数、字节、sha256、CJK 计数、段名清单（`git show` + `wc` + `shasum` + `grep`）。
- Wenaixi 与 `b6c0448` / `ef8ca48` 的逐文件 `cmp` 结果。
- 三份规则文件的六阶原文行号、七阶历史原文、`01cbf81` 的 stat。
- 宿主三个 `\@deepseek-ai` 包的版本、无 `.dshpurge.bak`、500 默认值与截断实现、目录渲染链、`SKILL_GESTURE` 正则、rank 常量数值。
- 12 条描述的三法计数与截断行为实测。

**未核实**

1. **上游 HEAD `96608e0` 之后是否又有新提交**：本文读数取自 2026-11-07 的一次 `git ls-remote`；其后变化只能靠 §1.5 的脚本兜住。
2. **`catalogDescriptionMaxLength` 是否被 profile 配置覆盖**：本机三包是默认值；实际 profile（`~/.dsh/` 下）可能设了别的数字，未逐份查用户的 profile 文件。
3. **中文描述在真实模型上的触发效果**：本文只证明机制上「描述是纯文本给模型读、无检索」，未做「中文描述 vs 英文描述」的触发率 A/B。上游与 Wenaixi 均未提供这类数据。
4. **`ponytail-help` 单独禁模型调用的实际影响**：§5.3 的建议基于「速查卡价值低」的判断，未做用户行为统计。
5. **上游 `assets/v5/ladder.png` 是否真画了 7 阶**：只核到 blob 与 alt 文本，未渲染图片逐格确认。
