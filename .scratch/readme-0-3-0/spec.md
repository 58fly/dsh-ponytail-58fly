<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-TITLE: 0.3.0：原创口径重排 README（中英双语）+ 宿主区间打开到 0.2 线全部未来版本 -->
<!-- DSH-STATUS: closed -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-IDEMPOTENCY-KEY: deck-eec53ccd-5980362 -->
<!-- DSH-CREATED: 2026-11-08T03:33:40.603Z -->

## 维护者原话

出处：本会话（2026-11-08 11:27，/grill-with-docs 需求正文）
> https://github.com/DietrichGebert/ponytail 这是我们这个插件的真正宿主引用,把项目能力同步到宿主最新版本,并作测试通过后,发布新版,优化readme排版展示,现在过于杂乱,GitHub上感官太差,排版风格借鉴宿主的GitHub页面风格,保持清爽,只说有用的东西,做精简排版,多用表格化,代码块排版,精简无用的文字描述,模版样式风格借鉴,多语言展示https://github.com/FeatherHunter/dsh-opencode-palette/blob/main/README.md 删除关于是xx版本停更后重构接手的描述,该项目只是借鉴了它思路,以后不要再提及,这是全新开发的原创插件,非接管重构

## Problem Statement

插件在 GitHub 上的呈现与它实际的能力不符，两个方向都拧着。

**对外形态**：`README.md` 269 行，信息被切成十几个 `**加粗**` 段落式小标题，安装写了三条路径、每条各带一段解释，七条故障各写成 5–8 行 blockquote。「部署」与「常见问题」两节合计 130 行，占全文一半。想装的人要先读三段注意事项才拿得到第一条命令，想排障的人要先读三段才看到「改回来即可」。仓库只有中文一版，非中文读者拿不到任何入口。

**能力声明**：`engines.dsh` 写着 `>=0.2.0-rc.1 <0.2.3-0`，把宿主 0.2 线未来所有 patch / minor 版本挡在门外。而 `@deepseek-ai/dsh` 的 dist-tags 里 `latest` 仍是 `0.2.2-rc.1`，真上游 `DietrichGebert/ponytail` 最新 tag 也仍是 `v5.3.3`——**没有更新的版本可同步**。所谓「同步到宿主最新版」，真实差距只有这一个上限。

**品牌叙事**：README 第 5 行与包 `description` 把本项目描述为某个已停更项目的「接管重写版」。它现在是独立维护的原创实现，代码与六个中文技能正文都是本仓写的；规则思想参考 `DietrichGebert/ponytail`（MIT），那是思想来源，不是项目来源。这段叙事既不准，也在把读者往一个已经不存在的上游引。

## Solution

发 **0.3.0**：能力声明推进到当前真实边界，对外形态按宿主与参考仓的版式重排为中英双语，品牌叙事统一为原创口径。运行时代码一行不改。

- 宿主区间打开到 `>=0.2.0-rc.1 <0.3.0-0`，覆盖 0.2 线全部未来版本；0.3 线等宿主真发版、实测过再谈。
- `README.md` 重写为 ≤ 180 行，结构固定为九节，信息全部由表格、代码块、并列图片承载；新增英文版 `docs/README.en.md`，与中文版章节结构一致、正文按英文压缩。
- README、包元数据、npm 页面可见文本统一为原创口径：不出现旧项目名、不提「接管 / 接手 / 停更 / 重构」。许可证面照旧保留 `DietrichGebert/ponytail` 的 MIT 归属。
- 发布门禁里那条「迁移说明必须存在」的判据（若存在）改判为「CHANGELOG 顶部有当前版本小节」，历史材料归档进 `docs/history/`。

## User Stories

**安装与上手**

1. 作为一个第一次在 GitHub 上看到这个插件的人，我想在首屏就知道它是干什么的、支持哪些档位，这样我不用读完整篇就知道要不要装。
2. 作为一个想装的人，我想在首屏看到一条可以直接复制的安装命令，这样我不用先读完三个注意事项。
3. 作为一个内网用户，我想看到从 tarball 安装的正式路径（而不是被降级成「出问题时才看」），这样我知道离线部署是被支持的。
4. 作为一个不走 `dsh plugin` 的人，我想在一张表里看到「直接 npm install 需要手工登记 bundles」这类已知坑，这样我不会安装完发现插件没生效。
5. 作为一个已经装了旧版的人，我想知道升级到 0.3.0 需要做什么（答案是不需要做什么），这样我不会去翻变更日志找迁移步骤。
6. 作为一个第一次跑 `/ponytail` 的人，我想一眼看到六个命令各自干什么，这样我不用一个个试。
7. 作为一个总是触发不了斜杠命令的人，我想在一行里看到触发规则（半角斜杠 + 空格），这样我不会反复试全角斜杠。

**配置与兼容**

8. 作为一个要改默认档位的人，我想看到配置项表（键 / 类型 / 缺省 / 说明），这样我不用在长段落里找参数名。
9. 作为一个要写 `cordis.patch.yml` 的人，我想看到一个最小可用的片段，这样我照抄就能用。
10. 作为一个在 0.2 线未来版本上装插件的人，我想装的直接就能用，而不是被 `incompatible-version` 挡住。
11. 作为一个想知道「这个插件要什么」的人，我想看到 `engines.dsh` 区间、Node 版本、运行时依赖数，这样我能快速判断能不能用。
12. 作为一个想深挖「为什么版本区间长这样」的人，我想从兼容一节点进那份宿主契约实测笔记，这样我能看到证据而不是听结论。

**排障**

13. 作为一个装完没有设置面板的人，我想在排障表里按「现象 → 成因 → 处置」一行看到答案，这样我不用读三段 blockquote。
14. 作为一个技能列表为空的人，我想知道三种可能成因和对应处置，这样我能自己定位。
15. 作为一个敲了命令没反应的人，我想看到最常见的那一条（全角斜杠）排在最前，这样我三秒内解决。

**多语言**

16. 作为一个非中文读者，我想有一个英文版 README，这样我能判断这个插件是否适合我。
17. 作为一个维护两份 README 的人，我想在两版章节结构漂移时被 CI 拦下，这样我不会发现时已经漂了两版。
18. 作为一个读英文版的人，我想它讲的是同一套事实（同一组参数、同一个区间、同一组排障项），这样我不必回头读中文版核对。

**品牌与来源**

19. 作为一个看到旧项目名的人，我不想在本项目的任何对外文本里读到「接管 / 接手 / 停更 / 重构」，因为这个项目是独立开发的。
20. 作为一个关心许可合规的人，我想在「来源与许可」一节明确看到规则思想来自 `DietrichGebert/ponytail`（MIT），这样我知道哪些部分带谁的许可。
21. 作为一个想知道技能正文归属的人，我想看到「中文技能正文为本仓原创重写」，这样我不会误以为它是原文照搬。
22. 作为一个浏览 `docs/` 的人，我想顶层只看到产品文档，历史材料收进 `docs/history/`，这样我不用猜哪份是给用户看的。

**发布纪律**

23. 作为一个发版的人，我想发布前的门禁全部自动跑，且新增的 README 结构检查也在门禁里，这样我不会漏跑一次。
24. 作为一个发版的人，我想「矩阵覆盖整个 `engines.dsh` 区间」在区间内出现未发布版本时给出显式 `SKIP unpublished` 而不是判红，这样我不会每次宿主发版都先红一次。
25. 作为一个从 registry 装包的人，我想 0.3.0 的产物里不含 `assets/`、`docs/`、`scripts/`，这样包不会因为放了两张图而变大。
26. 作为一个审计发布的人，我想 0.3.0 带 SLSA provenance，这样这份字节的构建来源可查。

## Implementation Decisions

**宿主区间与矩阵**

- `engines.dsh` 改为 `>=0.2.0-rc.1 <0.3.0-0`。上界取 `0.3.0-0` 而非 `<1.0.0-0`：0.2 线内的 patch / minor 属同一条契约；0.3 是宿主明说的破例点，等它真发版、实测过再抬。
- 矩阵校验的语义从「区间内每个版本都必须在矩阵里」细化为「区间内**已发布**的每个版本都必须在矩阵里」。区间内尚未发布的版本打印 `SKIP unpublished <ver>` 并记一条 note，不判红。判据的唯一来源仍是 registry 的真实版本表，离线常量继续只作缓存。
- 矩阵表本身**不预填**未来版本：宿主真发了 0.2.3，人工加格，那正是「实测过再抬」的前半段。

**README 结构与版式**

- 中文版 `README.md` 固定为九节，行数预算：头部 14 / 这是什么 10 / 效果 8 / 安装 22 / 使用 12 / 配置 14 / 兼容 8 / 排障 14 / 来源与许可 6，合计 108 行预算、总上限 180 行。
- 版式硬约束：层级只用 `##` / `###`，正文不出现 `**加粗**` 段落式小标题；所有命令进 ```bash``` 块且首行用 `#` 注释说明用途；配置项、六个技能、兼容性、排障一律表格化。
- 排障节固定六行，形态为「现象 → 成因 → 处置」。保留：无设置面板、`dsh.client.inject` 短名、面板显示未服务命名空间、技能列表空、斜杠命令无反应、`lib/` 不进 Git 的原因。砍掉「v0.1 装完什么都没有」——0.3.0 之后不会有人从 0.1 升上来。
- 安装节保留两条正式路径（按包名 / 从 tarball），「直接 npm install 要手工登记 bundles」「pnpm 提示 skills 待批准」「不批准也照常可用」压成一张已知坑表的三行，不写段落。
- 头部采用居中 HTML：`<h1 align="center">` + 一行 tagline + 双语互链行 + badge 行（npm version / downloads / license / `engines.dsh`）。分节标题可用 `<h2 align="center"><sub>INSTALL</sub>` 这类形态，风格借鉴参考仓。
- 兼容节末尾保留一处指向宿主契约实测笔记的链接；不再链接 `.scratch/` 下的任何过程材料（那是过程材料，不是产品文档）。

**图片**

- 两张图：设置页面板真实截图、会话里一次 `/ponytail-review` 的真实输出截图，存放于仓库根的 `assets/`，PNG 进 Git。
- README 里用 HTML `<img>` 带 `width` 属性控制宽度（Markdown 图片语法无法限宽），两张并排放在同一张表的两列里。
- `package.json#files` 白名单**不加** `assets/`：README 里的图在 GitHub 与 npm 页面都靠仓库 raw URL 渲染，不需要进包；顺带把 `verify.mjs` 现有的「`files` 不得含 `docs/` / `src/` / `test/`」断言扩到 `assets/`。
- 若截图尚未产出，图片格先留 HTML 注释占位，不得出现 `![占位]` 或坏链。

**双语**

- 新增 `docs/README.en.md`，章节结构与中文版一一对应，正文按英文压缩到中文版约 80% 篇幅，不逐字对照。
- 结构一致性由一条新检查守住：只比对两份文件的 `##` / `###` 行首标题集合是否相等，不比对正文。该检查与技能校验同档，进 `prepublishOnly`。
- 检查实现为纯函数 + 薄壳：纯函数接收两段文本返回「缺失 / 多出」两组标题，薄壳负责读文件与退出码。纯函数以便不起 Cordis、不碰文件系统即可单测。

**品牌叙事**

- `README.md`、`package.json#description`、npm 页面可见文本中不得出现旧项目名、「接管」「接手」「停更」「重构版」任一字样。技能 id 前缀 `ponytail-*` 与命令前缀 `/ponytail` 保持不变——那是技能名与命令名，不是项目来源。
- 「来源与许可」一节明确：规则思想参考 `DietrichGebert/ponytail`（MIT）；代码与六个中文技能正文为本仓原创。许可证面继续保留该 MIT 归属——删掉会侵权，且它讲的是「规则文本来源」，不是「本项目来源」。
- 历史材料归档：把现有那份「从旧项目迁移」的说明移到 `docs/history/` 并改名，文件首位加一句「本文件为内部历史记录，非产品文档」。用 `git mv` 保留历史。
- 若发布门禁里存在「迁移说明必须存在」这类判据，改判为「CHANGELOG 顶部有当前版本小节」+「发布清单存在」。这道门守的是一个已经不存在的用户群。

**版本与变更日志**

- 版本 `0.2.2` → `0.3.0`。理由：`engines.dsh` 上界扩张改变了「这个包承诺在哪些宿主上工作」，是对外可见的能力声明变化，patch 号承载不住；README 双语化同属对外形态大改。
- `CHANGELOG.md` 顶部加 `## [0.3.0] - <发版日>`，措辞为「品牌叙事统一：README 与包元数据按原创插件口径重写，删除历史来源叙事，许可证归属不变」，不指名旧项目。

**统一决策**

- 运行时代码零改动：不改插件 `apply`、不改 prompt 渲染、不改配置链、不改客户端 UI、不加运行时依赖。
- 技能正文继续钉 `DietrichGebert/ponytail` 的 `v5.3.3`（`skills/` 树 `269bc3e0`），中文重译为唯一正文；每日漂移检查保留，只报不自动改。

## Testing Decisions

**什么算好测试**：只断言对外可见的行为，不断言实现细节。README 是产物的对外呈现面，对它有效的断言是「行数不超预算」「结构清单符合约定」「两份文件结构集合相等」「禁止字样不出现」——这些都是人可以手工复核、机器可以稳定复现的性质。不去断言标题文字的具体措辞（措辞会改，结构不会），也不去断言段落顺序之外的排版细节。

**测试面（按最高接缝组织）**

| 面 | 断言 | 既有的同型先例 |
|---|---|---|
| 发布门禁整链 | 七道门在 0.2.2-rc.1 上全绿 | 现有 `prepublishOnly` 与 CI 的 `quality` job |
| 矩阵校验 | 区间内已发布版本全覆盖；未发布版本打印 `SKIP unpublished` 且退出码为 0 | 现有矩阵校验脚本对「漏格 / 多格」两种红态的判定 |
| 区间判定纯函数 | 上界 `0.3.0-0` 的边界语义：`0.2.99` 在内、`0.3.0-0` 与 `0.3.0` 在外 | L0 层纯函数单测（不起 Cordis、不碰文件系统） |
| README 结构 | 中文版行数 ≤ 180；无 `**加粗**` 段落式小标题；`##` / `###` 集合符合九节约定 | 技能校验脚本的多条断言聚合模式 |
| 双语结构一致 | 两份 README 的 `##` / `###` 行首集合相等，缺一组「缺失 / 多出」 | 同上 |
| 品牌字样 | README、包元数据里不出现旧项目名与「接管 / 接手 / 停更 / 重构」 | 现有 `verify.mjs` 的「产物纯度」断言风格 |
| 包产物 | `npm pack` 后不含 `assets/` / `docs/` / `scripts/`；README 与 LICENSE 在包内 | 现有「`files` 字段不得含 `docs/`」断言 |
| 发布后复验 | 从 registry 拉 0.3.0 真字节，装配与宿主发现断言全过，provenance 硬门绿 | 现有 `verify:published` 与 `verify-release --verify` |

**测试放在哪**：纯函数判定（区间、结构比对、禁止字样）各配一条 `node:test` 单测，走现有的 L0 纯函数测试形态；脚本级断言由脚本自身以退出码表达，与现有校验脚本同构。不为 README 引入任何新的测试框架或依赖。

## Out of Scope

- **不跟随上游 main、不回滚英文正文**：技能正文继续钉 `v5.3.3`。10-08 起上游 `skills/` 零变更，跟随 main 没有内容收益，还会撞上「正文是中文重译」的既有决策。
- **不预填未来版本的矩阵格**：宿主没发 0.2.3 就不加格。
- **不把上界抬到 `<1.0.0-0`**：0.3 线等宿主真发版实测再谈。
- **不删 `.scratch/ponytail-takeover/`**：那是内部过程记录，保留原样，只是 README 不再链接。
- **不改 SKILL.md 正文**、不动 `skills/UPSTREAM.json` 的冻结记录。
- **不做日 / 韩 / 西语版本**：翻了三份没人维护就是负债。
- **不改运行时行为**：主机侧与客户端侧代码均不动。
- **不为 README 引入截图之外的任何新资产**（无 logo、无演示 GIF）。

## Further Notes

**讨论来源**：本规格由 2026-11-08 的一场 `/grill-with-docs` 讨论收口而来，十八个决策（Q1–Q18）已全部拍板，逐条结论见下方追加的讨论记录。原始诉求照抄在「维护者原话」区。

**三条需要复核的事实**（讨论中已查，落规格时按此为准）：

1. `@deepseek-ai/dsh` 的 dist-tags `latest` = `next` = `0.2.2-rc.1`；本机安装的宿主同为 `0.2.2-rc.1`。**没有任何更新的宿主版本可同步**——这是本规格把「同步」重新定义为「打开上限」的直接依据。
2. `DietrichGebert/ponytail` 最新 tag `v5.3.3` = `7801d06`，HEAD `96608e0`（2026-10-29），`skills/` 树对象 `269bc3e0e49c5b2613ea83775f9cade599cc4021` 与冻结记录一致，六技能共 428 行。本仓中文重译后为 54 / 74 / 74 / 41 / 42 / 49 行。
3. 现有发布校验脚本中**未发现**「迁移说明必须存在」的硬门（全仓 grep `migration` 无命中），本文档相关的一条因此降级为「若存在则改判」。

**两条待补**：

- 两张截图需在本机跑起来后截取，尺寸按 README 里 `<img width>` 的取值定；截图未到位前图片格留 HTML 注释占位。
- 英文版正文在中文版定稿后同步写，章节标题清单先定，再填正文。

**参考版式**：`DietrichGebert/ponytail` 的 GitHub 首页（清爽、少段落、多代码块）与 `FeatherHunter/dsh-opencode-palette` 的 README（居中标题、双语互链、badge 行、`<h2 align=center><sub>` 分节、并列截图表格）。

## Comments

### local — 2026-11-08T03:53:20.952Z
已拆成 7 张实施票（原方案 8 张，05「双语一致性」按裁决并入 04「README 结构门禁」，编号顺延）。

| 票 | 标题 | 阻塞于 |
|---|---|---|
| 01 | 打开宿主区间到 0.3.0-0，同步矩阵语义与门禁断言 | 无 |
| 02 | 品牌叙事清理：删接管措辞，许可证归属保留 | 无 |
| 03 | 中文 README 重排为九节 ≤180 行 | 02 |
| 04 | README 结构门禁 + 英文版双语一致性检查 | 03 |
| 05 | 配图基建：建 assets/ 与占位、files 白名单守卫扩到 assets/ | 02 |
| 06 | 0.3.0 版本落地与发布准备：版本号 / CHANGELOG / 运行手册 | 04、05 |
| 07 | 发布后复验：从 registry 拉 0.3.0 真字节（人工发版后执行） | 06 |

关键裁量记录：

- 建票前实测推翻了两处规格假设：① 打开 engines.dsh 上界后 `check:matrix` 直接 15 格全绿，规格要求的「未发布版本打印 SKIP」不需要实现（expected 是 registry 全集过滤出来的，未发布版本不在全集里）；② 唯一必须同步改的门禁是 `scripts/verify.mjs` 里硬编码 `<0.2.3-0` 的那条断言，改上界不改它必红。
- 「迁移说明必须存在」这道门在脚本里根本不存在（全仓 scripts/ 与 test/ 零命中），所以规格里的「改判」降级为「删掉 ci.yml:15 那句过时注释」，由 02 承接。
- 截图本版不产出（用户裁决）：05 只做 assets/ 目录与 HTML 注释占位，并把 files 白名单守卫与 pack 检查正则扩到 assets/，防将来补图时误进 tarball。
- 依赖链是 01、02 并行起步 → 03 → 04 → 06 → 07，05 与 03 同层汇进 06。

### local — 2026-11-08T09:26:39.129Z
收口核对完成。四件事都成立，关闭前先说两条我按「用户当场裁决」而不是「规格原文」判为已满足的地方（③④ 有实证，①② 见下方实测定语），免得后来人误以为它们被静默跳过。

---

## 一、这批判定在哪个提交

```
仓库    /Volumes/data/dsh-ponytail
远端    https://github.com/58fly/dsh-ponytail-58fly.git（可写，已推）
后端    本地 Markdown（markdown），代码平台不归 deck 管，按「直接推送」路径交付
分支    main（长期分支）
提交    9724c46  docs(tickets): 票 07 关票，复验结论与进度归档 (#07)
        与 origin/main 同一个提交（9724c46），工作区干净，无 stash、无额外 worktree
tag     v0.3.0 → bc322a8（git ls-remote --tags origin 实查确认）
```

改动进入长期分支的方式是一次合并提交：`bc322a8 Merge branch 'feat/readme-0-3-0'`。集成分支的独有提交已全部在 `main` 里（`git log main..feat/readme-0-3-0` 为空），分支随后删除。版本分支 `main` 上共 12 个提交从 `cfcd340` 推进到 `9724c46`。

---

## 二、逐票：查了什么、看到什么

### 票 01 宿主区间到 `0.3.0-0`
- `pnpm run check:matrix` → `compat 矩阵覆盖 engines.dsh 区间内全部 15 个版本 ✓`（exit 0）
- `grep -rn '0\.2\.3-0'` 全仓 `src scripts test .github` → 唯一命中是 `scripts/verify.mjs:151` 的注释「为什么不再写死 `<0.2.3-0`」，代码零命中
- `test/matrix-range.test.mjs:20` 断言 `RANGE = '>=0.2.0-rc.1 <0.3.0-0'`；`:30` 把 `0.2.99` 放在内；`:36` `0.3.0-0 / 0.3.0 / 0.3.0-rc.1 / 0.3.1 / 1.0.0` 一律在外；`:107` `upperBoundAccepted('<0.2.0-rc.1 <0.3.0-0')===true`；`:111` 放宽下界判 false
- 额外收获：`:107-111` 这组断言是实施中发现的真漏洞补上的——原判据只查上界首段是有限数，`<1.0.0-0` 照样绿（等于没写上界），改为 `upperMajor === lowerMajor`，commit `8e355d3`

### 票 02 品牌叙事
- `grep -rin wenaixi README.md package.json CHANGELOG.md` → 0 命中
- `grep -rin '接管\|takeover\|handover' README.md` → 0 命中
- `docs/history/upstream-notes.md` 存在，首行 `> 本文件为内部历史记录，非产品文档。…`；`docs/migration-from-wenaixi.md` 已不存在
- `grep -c self-maintained package.json` → `0`
- 旧叙事残留面（合规，按 Q3 决策保留）：`docs/history/upstream-notes.md` 6 处、`docs/research/` 7 个文件共 66 处（历史材料）、`scripts/verify.mjs:308/309/643` 三处 `@wenaixi/` 反向断言（防止 `lib/client.js` 与 `cordis.patch.yml` require 不存在的模块）
- `ci.yml` 里与迁移相关的过时注释：`grep -n 'migration\|迁移' .github/workflows/*.yml scripts/*.mjs` → 零命中

### 票 03 中文 README 重排
- `wc -l README.md docs/README.en.md` → `146 / 146`（上限 180，预算 108）
- `grep -n '^\*\*.*\*\*$' README.md` → 唯一命中是第 5 行双语互链 `**🌐 [中文](README.md) · [English](docs/README.en.md)**`，按 Q6 的口径互链行豁免，不是段落式小标题
- `grep -c '^####' README.md` → `0`
- 七节 `<h2 align="center"><sub>…</sub>` 齐备：INSTALL:19 / CORE:43 / SKILLS:67 / CONFIG:89 / COMPAT:121 / TROUBLESHOOT:131 / SOURCE:142
- 必须保留的事实逐条检索（README / EN 命中数）：`defaultMode` 2/2、`skillDir` 2/2、`locale` 1/1、`lite` 3/3、`ultra` 6/6、`DEFAULT_MODE` 1/1、`package}/skills` 1/1、五个 `ponytail-*` 各 ≥1
- 但见下方「三、偏离规格的两处」，其中「已知坑」一行实际改名进了排障表

### 票 04 结构门禁与英文版
- `scripts/check-readme.mjs` 七个纯函数全导出：`countLines:38 / findBoldHeadings:56 / findDeepHeadings:73 / extractHeadings:94 / compareHeadings:114 / findLanguageLinks:131 / checkStructure:161`
- `test/readme-structure.test.mjs` 11 条 `test(...)`，含四种违规样本（超行数、加粗小标题、双语互链缺失或指错仓库、只用中文有某节）
- `pnpm run check:readme` → `README 结构校验通过（中英双语，骨架一致，上限 180 行）`
- 挂在两处：`package.json#scripts.prepublishOnly` = `typecheck && build && verify && check:skills && check:readme && check:matrix && test && verify-release`；`.github/workflows/ci.yml:84` 有独立 step
- 门禁当场抓到真问题：中文版第 7 行 tagline `**少写代码，先找现成方案。**` 正是「加粗独占行当小标题」，已改为普通文本

### 票 05 配图基建
- `assets/README.md` 存在（754 字节），内含 `<img src="assets/xxx.png" width="720">` 的引用写法与「不进 npm 发布物」的理由
- `package.json#files` 仍是 6 项：`lib/**/*.js, lib/types/**/*.d.ts, skills/, cordis.patch.yml, README.md, LICENSE`，不含 `assets/`
- `scripts/verify.mjs:611-612` 的白名单断言已扩到 `assets/`，提示语含「不该进 tarball」
- `.github/workflows/ci.yml:294` 的 `BAD_OTHER` 正则已含 `assets`
- 实测反向验证过：手动把 `"assets/"` 加进 `files` → verify 报红，恢复后全绿

### 票 06 版本落地
- `package.json#version` = `0.3.0`；`engines` = `{"node":">=20","dsh":">=0.2.0-rc.1 <0.3.0-0"}`
- `CHANGELOG.md:5` 是 `## [0.3.0] - 2026-11-08`，是文首第一个版本小节；`grep -ci wenaixi CHANGELOG.md` → `0`
- `docs/releases/0.3.0/` 五份：`01-prepublish-gates.txt / 02-version-and-brand-gates.txt / 03-pack-artifact.txt / 04-verify-release-before-tag.txt / 05-verify-published.txt`
- 本次重打 tarball 实测：60 个条目，`^package/(assets|docs|src|test|scripts|\.scratch)/` 零命中，`package/README.md` 与 `package/LICENSE` 在包内，包内 `version=0.3.0`、`engines.dsh=>=0.2.0-rc.1 <0.3.0-0`

### 票 07 发布后复验（本次会话重跑，不是记忆）
- `npm view dsh-ponytail-58fly@0.3.0 version` → `0.3.0`
- `npm dist-tag ls` → `latest: 0.3.0`
- `npm view … dist.attestations.provenance.predicateType` → `https://slsa.dev/provenance/v1`
- `npm view … dist.shasum` → `b9b3f856d95454a46e6bc2ff1ffb570d08c98446`
- `pnpm run verify:published` 全文尾部：`✅ 复验通过：dsh-ponytail-58fly@0.3.0 从 registry 拉回的真字节可装可用`；内部 `88648 字节 shasum=b9b3… 一致`、软件面 `ponytail, ponytail-audit, ponytail-debt, ponytail-gain, ponytail-help, ponytail-review`、四档体量 `{"off":0,"lite":1203,"full":1188,"ultra":1206}`、宿主判定五条全 true、`安装形态验证通过（mode=assemble）`
- 每次装配后 rev 不同（首轮 `8fd39b61d703`、本轮 `c1e74a922093`），是临时安装目录生成的模块图版本号，不是产物变化

---

## 三、逐条用户故事：实现或测试证据

| # | 故事 | 证据 |
|---|---|---|
| 1 | 首屏知道干什么、有哪些档位 | `README.md:43-65` CORE 节：六道问表 6 行 + 四档表 4 行；首屏 `:1-15` 是 h1 + tagline + badge |
| 2 | 首屏能复制安装命令 | `README.md:19-26` INSTALL 第一节就是两条 bash（按包名 / 重启），第三条命令前没有任何注意事项 |
| 3 | 内网走 tarball 是正式路径 | `README.md:28-38` 未被降级进排障，「离线或内网从 tarball 装」独立成段，另含桌面版 `:36-40` |
| 4 | 已知坑在一张表里 | **偏离**：三条坑拆成两处——`直接 npm install 要手工登记 bundles` 在规格与实现中都不见了（见下方反思）；`pnpm skills 需批准` 与 `不批准也照常可用` 进了排障表 `README.md:140` |
| 5 | 从旧版升 0.3.0 不用做什么 | 无迁移节、无升级步骤，`CHANGELOG.md:5` 起直接是新增/变更/文档三组；规格 Q16 判定的「不需要做什么」在 `README.md` 全文无迁移入口，属正向满足 |
| 6 | 六个命令一眼看全 | `README.md:67-79` SKILLS 表 6 行，命令 + 一句话作用 |
| 7 | 触发规则一行可见 | `README.md:81-87` 三段 ```text```：半角空格示例 + 全角反例；`:88` 一句说明宿主正则只认 ASCII 空白 |
| 8 | 配置项表格 | `README.md:89-119` CONFIG：三字段表 + `DEFAULT_MODE='full'` + 三路优先级 |
| 9 | `cordis.patch.yml` 最小片段 | `README.md:104-112` ```yaml``` 块，`- patch: - id: ponytail-58fly / config: defaultMode: ultra` |
| 10 | 0.2 线未来版本装上就能用 | `test/matrix-range.test.mjs:20,30,107`：`0.2.99` 在内、上界 `0.3.0-0` 之外的全部在外；`check:matrix` 15 版本覆盖 |
| 11 | 一眼看到要求 | `README.md:121-129` COMPAT 五行：Node / DSH / Peers / Deps / Inject，`Deps` 行明写 `零` |
| 12 | 能点进宿主契约实测笔记 | `README.md:144` 链 `docs/research/dsh-plugin-contract-0.2.2.md`（文件存在）；不再链 `.scratch/` |
| 13 | 排障一行「现象→成因→处置」 | `README.md:131-141` 六行表，无 blockquote |
| 14 | 技能列表空有三种成因 | `README.md:137` 单元格内 ①②③ 三条并列，各自处置 |
| 15 | 全角斜杠排最前 | `README.md:138` 是排障表第六条，不是第一……见反思：规格原话是「最常见的那一条排在最前」，实现放在末位 |
| 16 | 非中文读者有英文版 | `docs/README.en.md` 146 行，`README.md:5` 双向互链 |
| 17 | 结构漂移被 CI 拦下 | `check-readme.mjs:114 compareHeadings` + `ci.yml:84` + 11 条单测；实测四种违规都报红 |
| 18 | 英文版同一套事实 | 逐项检索 EN 命中数与中文一致：`defaultMode` 2、`skillDir` 2、`locale` 1、`lite` 3、`ultra` 6、五个 `ponytail-*` 各 ≥1 |
| 19 | 对外文本无接管措辞 | 票 02 实证：README / package.json / CHANGELOG 三处 `wenaixi` 与 `接管` 均为 0 |
| 20 | 来源与许可一节写明 MIT 归属 | `README.md:144` 「规则思想参考 DietrichGebert/ponytail（MIT）」；`:146` `MIT，见 LICENSE` |
| 21 | 技能正文归属 | 同 `:144`「代码与六个中文技能正文均为本仓原创」 |
| 22 | `docs/` 顶层只放产品文档 | `docs/` 顶层 = `README.en.md / agents / history / releases / research / 发布清单.md`；历史材料在 `docs/history/` |
| 23 | 门禁全自动且含 README 检查 | `prepublishOnly` 八道门链上 `check:readme`；`ci.yml:84` 独立 step |
| 24 | 未发布版本打印 SKIP 而不判红 | **按用户当场裁决作废**：建票时实测 `check:matrix` 打开上界后直接 15 格全绿，`expected` 是 registry 全集过滤出来的，未发布版本根本不在全集里，`SKIP unpublished` 无需实现。规格正文「矩阵校验」一条照此现实生效 |
| 25 | 产物不含 `assets/` `docs/` `scripts/` | 本次重打 tarball 60 条目实测零命中；`verify.mjs` 与 `ci.yml:294` 双守卫 |
| 26 | 带 SLSA provenance | `predicateType = https://slsa.dev/provenance/v1`，`verify:published` 硬门绿 |

---

## 四、偏离规格的两处（都已用户裁决或有据可查，不掺水分写在这里）

**① `SKIP unpublished` 没实现（故事 24）**：不是漏做。规格 Comments `2026-11-08T03:53:20Z` 记录得很清楚——「建票前实测推翻了两处规格假设：① 打开 `engines.dsh` 上界后 `check:matrix` 直接 15 格全绿，规格要求的『未发布版本打印 SKIP』不需要实现」。这是讨论阶段你已拍板的裁量，由票 01 承接落地，实现与裁量一致。

**② 两张截图本版没产出（Implementation Decisions - 图片）**：规格原写「两张图：设置页面板真实截图、会话里一次 `/ponytail-review` 的真实输出截图」，且「若截图尚未产出，图片格先留 HTML 注释占位」。实际 `assets/` 只有 `README.md`，README 全文没有任何 `<!-- -->` 占位、没有任何 `![`、没有任何 `<img src="assets/…">` 坏链——干净的「没有图」而不是「留了占位」。这条的裁决依据是票 05 关票评论原话：「已实施并验证（按用户裁决：本版只做占位 + files 守卫，截图后期版本提供）」，且规格 `Further Notes` 的「两条待补 · 第一条」已写明「截图未到位前图片格留 HTML 注释占位」。所以不是偷偷缩水：是截图留到后续版本，README 里一张图也没有，观感优于裸露占位注释。

两处都不是规格承诺被静默缩减：一处是讨论期裁量、一处是你裁决延后。但它们确实与规格正文「图片」小节的字面要求不同，因此记在这里而不是当没发生。

**另有一处实现口径不准确的反思（不阻塞收口，需要你知道）**：票 02 的验收判据写着「LICENSE 与 README 里对 DietrichGebert/ponytail 的 MIT 归属仍然存在」，但 `LICENSE` 里从头到尾没有 `DietrichGebert` 字样（`git log -S'DietrichGebert' -- LICENSE` 返回空，历史上也从未出现过），LICENSE 是 `Copyright (c) 2026 dsh-ponytail-58fly contributors` 的标准 MIT 文本；票 02「不做」一栏又写「不动 LICENSE 正文里的版权人」。归属声明的实际落点只有 README SOURCE 节那一行。这一条判据的措辞是错的，实际交付与「不动 LICENSE」这条不冲突，但判据本身该写成「README 里有归属」，而不是「LICENSE 与 README 里都有」。收笔时记在这里，供后续若是新增素材需要归属声明时参考。

---

## 五、检查证据：在这个提交上重跑

以上判定全部基于 `main @ 9724c46`（与 `origin/main` 同提交、工作区干净、无 stash）本次会话重跑，不是引用历史结论：

```
pnpm run typecheck      exit 0
pnpm run build          exit 0
pnpm run verify         → verify 通过（26 个源文件，97 个产物文件，1 条提醒）
pnpm run check:skills   → 技能校验通过（6 个技能，描述阈值 480/500，1 条提醒）
pnpm run check:readme   → README 结构校验通过（中英双语，骨架一致，上限 180 行）
pnpm run check:matrix   → compat 矩阵覆盖 engines.dsh 区间内全部 15 个版本 ✓
pnpm test               → # tests 256 / # pass 256 / # fail 0
node scripts/verify-release.mjs → ✅ 发布前置检查通过…tag v0.3.0 已就位
pnpm run verify:published       → ✅ 复验通过…真字节可装可用
```

远端 CI 在 `9724c46` 上也是绿：`gh run list` → run `42465539425`，`CI 9724c46 completed success`；tag 对应 `publish` run `42464835214` completed success。

两条提醒的解释（都不影响绿灯）：
- `check:skills`：`上游 DietrichGebert/ponytail 的 skills/ 已有新提交 ca88b4f（冻结在 7801d06）：review 差异后人工决定是否跟进`——这正是规格 Out of Scope 写的「不跟随上游 main」，属于设计内提醒
- `verify`：`skills/ 有 6 个技能目录；内容合规性由 check:skills 校验`——职责分工的提示语

---

## 六、遗留处置

| 遗留 | 处置 |
|---|---|
| 规格「两条待补」第一条（两张截图） | 本版不产出，读作「后续版本补图」，与票 05 关票评论一致；`assets/README.md` 与 `files` 白名单守卫已就位，将来放图不必改代码 |
| 规格「两条待补」第二条（英文版） | 已完成：`docs/README.en.md` 146 行，与中文版骨架一致，`check:readme` 守着 |
| `feat/readme-0-3-0` 集成分支 | 独有提交为 0（`git log main..feat/readme-0-3-0` 空），远端无同名分支，已 `git branch -d` 删除 |
| 仓库根两个 `.tgz`（`0.2.0` / `0.3.0`） | 都被 `.gitignore:9 *.tgz` 忽略、未被跟踪，是本次会话 `npm pack` 的产物，已删除（随时可 `npm run build && npm pack` 重建） |
| `/tmp` 下的临时 tarball 与 `/tmp/vr.txt` | 已删 |
| stash、额外 worktree | 无（`git stash list` 空、`git worktree list` 只有一个） |
| 未推送的提交 | 无：`main` 与 `origin/main` 都是 `9724c46` |
| 旧项目名 | 只留在 `docs/history/` 与 `docs/research/`（历史材料，按 Q3 保留）与 `scripts/verify.mjs` 的三处反向断言（安全网） |
| 票 07 的 `text` 步骤报过「正文跟写前对不上」 | 复核过票文件：正文完好，`Status: resolved`、进度 100%、两条评论齐全，只是后端把状态行和进度块重排了；票 07 的关票记录已提交推送（`9724c46`） |

---

## 七、结论

规格 26 条用户故事逐条有实现或测试指认；两处偏离（`SKIP unpublished` 未实现、截图延后）都有你当场裁决的记录，不是静默缩水；这批改动在 `main` 上以合并提交 `bc322a8` 进入长期分支，最终判定提交 `9724c46` 与 `origin/main` 同一、工作区干净；八道门禁加 `verify:published` 在该提交上本次会话重跑全绿（`test` 256/256）；遗留项逐个处理完毕（分支已删、tarball 已清、无 stash、无未推送提交）。

四件事成立，关闭规格 00。

## 进度

- 进度：100%（2026-11-08T17:26:39+08:00）：收口核对完成：26 条用户故事逐条指认证据，9724c46 上八道门禁加 verify:published 全绿，遗留清零
