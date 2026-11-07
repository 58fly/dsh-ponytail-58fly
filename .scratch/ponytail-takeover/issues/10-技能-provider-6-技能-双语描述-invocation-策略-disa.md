<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: wayfinder:task -->
<!-- DSH-IDEMPOTENCY-KEY: deck-plan-ponytail-takeover-v1-child-T4 -->
<!-- DSH-CREATED: 2026-11-07T03:34:34.157Z -->
<!-- DSH-BLOCKED-BY: 08, 03 -->
# 10: 技能 provider：6 技能、双语描述、invocation 策略、disable-model-invocation

Type: task

Blocked by: 08, 03

Status: resolved
## Question

实现 6 个技能的 provider，并把描述语言与调用策略定死。

## 要做的事

1. **provider 协议**：`skills.registerProvider((control) => ({ list, get, ... }))`。`list()` 只读 frontmatter（便宜），`get()` 才读正文并给 directory resource base。**`get()` 收到的参数是 candidate 而不是 name**（#02 已在真 Cordis 组合测试上固化这条），照 `name` 取会拿到 undefined。
2. **6 个技能**：`ponytail` / `ponytail-review` / `ponytail-audit` / `ponytail-debt` / `ponytail-gain` / `ponytail-help`。正文按 #08 的结论落地：**真源钉上游 DietrichGebert/ponytail v5.3.3**（tag `7801d06`，HEAD `96608e0` 对 skills/ 零差异，树 `269bc3e0e49c5b2613ea83775f9cade599cc4021`），**中文重写正文但保留英文触发词与 kebab-case 技能名**，CI 每日 diff 报警、不自动 sync。**阶梯统一说六阶**（上游三处同文：`AGENTS.md:13-18`、`.agents/rules/ponytail.md:13-18`、`skills/ponytail/SKILL.md:27-32`），不用七阶。
3. **rank 定 550**：低于宿主 `BUNDLED_SKILL_RANK = 600`（`dsh-skill/lib/index.js:23`），同名时宿主内置赢——这是上游的取舍，保留。rank 必须 < 600，这是硬上限不是建议值。
4. **invocation 策略**：`disable-model-invocation` / `user-invocable` 两键要吃默认值 `{modelInvocable:true, userInvocable:true}`。**6 个技能一律不设 `disable-model-invocation: true`**：全设会走 `dsh-tool-skill/lib/index.js:945` 的空集分支 → `:955` 无技能段，6 个技能全部从模型目录消失、`skill` 工具调用直接抛错（`:875/:878`）。旧键（`disableModelInvocation` / `modelInvocable` / `userInvocable`）**报错而非静默忽略**（上游做法，保留）。
5. **frontmatter 解析**：支持折叠标量 `description: >`（多行 join 空格）；这是 gongyijie85 版补上、而上游 provider 也必须处理的点。
6. **描述长度口径（#08 实测，与票面旧说法不同）**：`catalogDescriptionMaxLength` 默认 **500**（`dsh-tool-skill/lib/index.js:768` 常量、`:777 z.number().default(500)`、`:785-786` 最小 3），**不是 52**。校验口径 = **先 `replaceAll(/\s+/g," ").trim()` 再比 UTF-16 `.length`**（截断实现 `:1094-1096` 先 `slice(0, max-3)` 再 `+"..."`，会切半代理对）。**我们的阈值定 480**（留 20 余量；当前最长 en/ponytail 已到 492）。校验脚本按同一口径实现，不许用 `[...str].length` 或 `Buffer.byteLength`。
7. **单技能开关（#12 定案：官方无原语）**：宿主 `dsh-skill` 的 Config 没有 `enabled` 字段（`dsh-skill/lib/index.js:120`）。**本票不实现技能级禁用**，只做 provider 级：要么整行 disable，要么改 `customSkillDirs` 把该技能目录移出。**v0.1 不提供单技能开关**，等宿主出原语再做（记进地图迷雾，已由 #12 交叉确认为宿主缺口而非我们的实现选择）。

## 硬约束

- 技能正文是**内容**，不是代码。正文改动不应该要求改 TS。
- 描述必须包含中文触发词。**机制上完全有效**：宿主不做任何检索匹配——`dsh-tool-skill/lib/index.js:944 filter(isModelInvocable)` → `:1028-1030` 每行「- `name`: description」→ `:966-991` 包成 `<available_skills>` 段，纯文本给模型读；包内 `embedding|fuzzy|levenshtein|similarity|scoreSkill|matchSkill|rankSkills` 零命中，排序是 `compareCodePoints` 纯字典序（`dsh-skill/lib/index.js:511-518`）。
- **斜杠命令后必须留 ASCII 空白**：`SKILL_GESTURE` 正则（`dsh-tool-skill/lib/index.js:1108`）是 `/(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/g`，只认 kebab-case ASCII，且「/ponytail，」这种紧跟全角标点的写法会漏匹配。写进所有 6 份正文与 README 的示例里。

## 验收

- `ctx.skills.list()` 返回 6 个，name/provider/source 正确，dispose 后清空。
- 校验脚本在描述超 480（折叠空白后的 UTF-16 `.length`）时失败；对「🚀」×300 这类输入不产生 U+FFFD。
- 6 个技能的 frontmatter 都不含 `disable-model-invocation`；显式设成全 false 时 `list()` 仍返回 6 个、`skill` 工具可调用。
- `rank` 全部 550 且 < 600。

## Answer

**结论：#10 的七条要求全部落地，六份正文、provider 协议、调用策略、长度口径、门禁脚本都已进仓库并在真实宿主上验过。**

### 一、provider（`src/skills/provider.ts`）

- `installSkills()` 走 `ctx.skills.registerProvider((control) => createSkillProvider(...))` 的工厂形态，不是 `() => provider`——注册被撤销时 control 里的 AbortSignal 才会 abort。
- `get(candidate)` 用 `candidate.locator?.path ?? candidate.path` 取回 list 时存下的绝对路径，**不按名字重新拼**。
- `resourceBase` 给 `{ kind: 'directory', path: join(path, '..') }`，即技能自己的目录。
- **本次补上的漏洞**：原先 `list()` 里 `readSkillMarkdown` 没有 try/catch，一个技能写了旧键就让整次 `list()` 抛错、六个技能全没。现在按技能粒度收口：`catch (SkillFrontmatterError)` → `warn(`技能 X 的 frontmatter 非法，已跳过：<路径>（<原因>）`)` → `continue`。有测试钉住（坏一条、好的一条照常出现）。
- `invocation` 从写死的 `{true,true}` 改成 `parsed.invocation ?? { modelInvocable: true, userInvocable: true }`：frontmatter 没写就用宿主缺省，写了就按写的来。

### 二、六份正文（`skills/<id>/SKILL.md`）

中文重写、英文触发词原样保留、阶梯统一六阶、斜杠命令后留半角空格。折叠后长度（UTF-16）：

| 技能 | 长度 | 余量 |
| --- | --- | --- |
| `ponytail` | 462 | 18 |
| `ponytail-review` | 461 | 19 |
| `ponytail-audit` | 458 | 22 |
| `ponytail-debt` | 293 | 187 |
| `ponytail-gain` | 244 | 236 |
| `ponytail-help` | 216 | 264 |

真源钉在 `skills/UPSTREAM.json`：`DietrichGebert/ponytail` v5.3.3、tag `7801d06`、tree `269bc3e0…`、`expectedDirs` 六条。上游 `plugin.json` **不放进** `skills/`——那个文件描述的是"上游整个插件"，放进来要么被当成第七个技能目录（它是文件，不会），要么被误读成我们的插件清单。

### 三、调用策略

两键缺省 → `invocation` 不下发；`disable-model-invocation: true` 六份**一个都没有**；旧键（`disableModelInvocation` / `modelInvocable` / `userInvocable`）抛错并点名新旧键；非 true/false 抛错；`user-invocable:` 留空按缺省（模板留空是常态，不为它炸整条 catalog）。

### 四、长度口径（`src/skills/description.ts`）

`DESCRIPTIONS_POLICY = { max: 500, ours: 480 }`、`foldDescription`（`replaceAll(/\s+/g,' ').trim()`，与宿主逐字同口径）、`truncateDescription`（照抄宿主 `slice(0,max-3)+'...'`，含它切半代理对的缺陷，测试钉住不修）、`judgeDescription`（`.length`）。`'🚀'.repeat(300)` 在 maxLength 500 下返回 `length === 500`、`endsWith('...')`、不含 `U+FFFD`、末尾不是孤立高代理。

### 五、门禁

`pnpm run check:skills`（`scripts/check-skills.mjs`）四类断言 + 漂移提醒，已进 `prepublishOnly` 与 CI：quality job 加一步、新增 `drift` job（`schedule: cron '17 3 * * *'`，注释写明"只报警不同步"）、pack job 加"六个 SKILL.md + UPSTREAM.json 必须在 tarball 里"。`verify.mjs` 第 7 组从"空目录只提醒"升级为"空目录即失败"，但内容合规仍交给 `check:skills`（两份脚本的失败含义不同，不合并）。

### 六、验收对照

| 票面验收 | 结果 |
| --- | --- |
| `ctx.skills.list()` 返回 6 个、name/provider/source 正确、dispose 后清空 | 真宿主实测：`count 6`，六个 `provider='ponytail-58fly'`、`source='bundled'`，dispose 后 `0`；`test/skills-catalog.test.mjs` 3 条用例固化 |
| 超 480 失败、🚀×300 不出 U+FFFD | `test/skills-description.test.mjs` 16 条；481 判 false |
| 六份都不含 `disable-model-invocation`；显式全 false 时仍返回 6 | 显式 `false` 的临时技能出现在 `list()` 里（第 5 条用例）；`get()` 六条正文全可读 |
| rank 全 550 且 < 600 | `PONYTAIL_SKILL_RANK = 550`，断言 `550 < BUNDLED_SKILL_RANK(真实值)` |

全链路：`typecheck` 无输出、`build` 成功、`node --test` **69 条全绿**、`check:skills` 通过、`verify` 通过。新增调研笔记 `docs/research/skill-catalog-contract.md`（既有 `skill-body-truth-source-and-language-policy.md` 只回答"真源钉谁、能不能中文落地"，没覆盖 provider 接口形状与门禁脚本，故另起一篇并互相引用）。

### 剩余风险（不在本票范围，已记进地图）

1. **`skillDir` 默认值是 `$DSH_HOME/ponytail-58fly/skills`，不是包内 `skills/`**（`src/l0/paths.ts` 的 `resolveSkillDir`）。从 npm 装后该目录若不存在，技能面是空的——用户在 README FAQ 里能查到改法，但"装完就有六个技能"这条预期应由 `plugin.ts` 的装配逻辑保证（回落到包内目录）。建议单开一票。
2. 漂移检查依赖 GitHub API，匿名额度 60/h 按出口 IP 共享；CI 已注入 `GITHUB_TOKEN`，本地无 token 时只提醒。

七条要求全部落地并在真实宿主上验证；六份正文/provider 协议/调用策略/480 折叠口径/门禁脚本均进仓库，69 条测试全绿。

## Comments

### local — 2026-11-07T06:30:37.341Z
## Resolution

#10 完成，验收四项全部在真实宿主上验过。

**改了什么**
- `src/skills/provider.ts`：`invocation` 改为 `parsed.invocation ?? {modelInvocable:true,userInvocable:true}`；`list()` 里按技能粒度 `catch (SkillFrontmatterError)` → warn + skip（原先一个坏技能会让整次 `list()` 抛错、六技能全没）。
- `src/skills/frontmatter.ts` / `src/skills/description.ts`（新）：调用策略两键解析与旧键报错；折叠/截断/判长三个纯函数，与宿主 `catalogDescription` 逐字同口径。
- `skills/<6>/SKILL.md`：中文重写、英文触发词保留、六阶、斜杠后留半角空格；折叠长度 462/461/458/293/244/216。
- `skills/UPSTREAM.json`：repo/tag `7801d06`/tree `269bc3e0…`/`expectedDirs` 六条。
- `scripts/check-skills.mjs`（新）+ `package.json` 的 `check:skills` 进 `prepublishOnly`；`.github/workflows/ci.yml` quality 加一步、新增 `drift` job（cron `17 3 * * *`，只报警不同步）、pack job 验六个 SKILL.md 与 UPSTREAM.json 在 tarball 里。
- `scripts/verify.mjs` 第 7 组：空 `skills/` 从提醒升级为失败。
- `test/skills-catalog.test.mjs`（新，6 条真宿主用例）、`test/skills-description.test.mjs`（16 条）。
- `docs/research/skill-catalog-contract.md`（新调研笔记）、README 新增「技能」章节 + FAQ 两条。

**验证**：typecheck 无输出；build 成功；`node --test` 69/69；`check:skills` 通过；`verify` 通过。真宿主清点：`list()` 返回 6 条、`provider='ponytail-58fly'`、六条 invocation 全 `{true,true}`、`get('ponytail')` 正文 1248 字符、dispose 后 `list()` 归 0。

**留给后续（不在本票范围）**：`skillDir` 默认指向 `$DSH_HOME/ponytail-58fly/skills` 而非包内 `skills/`，从 npm 装后技能面可能为空——建议单开一票让装配时回落到包内目录。

