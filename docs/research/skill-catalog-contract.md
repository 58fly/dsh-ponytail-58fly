# 技能目录契约：provider 协议、六份中文正文、调用策略与描述长度口径

> **本目录材料的定位**
> - `skill-body-truth-source-and-language-policy.md`：真源该钉谁、六阶还是七阶、中文能否落地（#08 定案依据）。
> - **本文**：把上面那组结论落成**可执行的契约**——provider 的接口形状、六份正文的写法规则、调用策略的默认值、描述长度按什么口径量、斜杠命令为什么必须留半角空格（#10 的实现依据）。
> - 阅读顺序：先看本文的「结论」，需要溯源再看后面的实测小节。

## 摘要

六条结论，两条推翻直觉：

1. **宿主的 `get()` 收的是 candidate 对象，不是技能名**。`SkillProvider.get(candidate: SkillCandidate)` 拿回的是 `list()` 自己造的 `locator`（主机只做透传，不解释内容）。按名字重新拼路径是上游的写法，代价是每次加载都要再拼一次路径、且拿不到 list 时的解析结果。
2. **单条技能写错会让整份目录不可用**。`validateCandidate`（`dsh-skill/lib/index.js:452-462`）逐条硬校验，任一 candidate 不合格就抛错；`ctx.skills.list()` 一旦抛错，宿主的技能目录就是 incomplete。所以 provider **必须按技能粒度收口**：告警 + 跳过坏的那一条。
3. **`disable-model-invocation: true` 在六个技能上是自杀**。宿主 `:944` 用 `filter(isModelInvocable)` 过滤候选，`:955` 在 catalog 源为空时整段不出现，`:875/:878` 在 `skill` 工具里直接抛错。六个全关 = 技能面归零。本项目六个技能一律不设此键，默认 `{modelInvocable: true, userInvocable: true}`。
4. **描述长度按 UTF-16 code unit 算，不是码点、不是字节**。`catalogDescription`（`dsh-tool-skill/lib/index.js:1094-1097`）先 `replaceAll(/\s+/g, ' ').trim()` 再比 `.length`，超了 `slice(0, max-3) + "..."`。默认上限 `DEFAULT_CATALOG_DESCRIPTION_MAX_LENGTH = 500`（`:768`）。本项目阈值 480。
5. **斜杠命令后必须留半角空格**。`SKILL_GESTURE`（`:1108`）是 `(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)`：`/ponytail，xxx`（紧跟全角逗号）与 `／ponytail`（全角斜杠）都匹配不上。
6. **落点**：正文是**内容不是代码**，放 `skills/`；判定逻辑是代码，放 `src/skills/description.ts`；发布前把门，放 `scripts/check-skills.mjs`（进 `prepublishOnly` 与 CI）。

---

## 一、provider 协议（`src/skills/provider.ts`）

### 1.1 接口形状（实测于 `@deepseek-ai/dsh-skill@0.2.2-rc.1`）

```ts
registerProvider(create: (control: SkillProviderControl) => SkillProvider): () => void
interface SkillProvider {
  list(): Promise<readonly SkillCandidate[] | SkillProviderObservation>;
  get(candidate: SkillCandidate): Promise<SkillDefinition | undefined>;
}
interface SkillCandidate extends SkillSummary {
  rank: number;        // 同名时 rank 小的赢
  locator: unknown;    // provider 自己的不透明句柄，宿主原样传回 get()
}
```

- 工厂形态（`(control) => provider`）不是装饰：`control` 带本注册的生命周期与 `invalidate`，注销后 signal abort。上游写 `() => provider`，把这两个能力丢了。
- 本实现：`installSkills()` → `ctx.skills.registerProvider(() => createSkillProvider({skillDir, warn}))`。
- `locator` 存 `{ path }`（SKILL.md 绝对路径），`get()` 用 `candidate.locator?.path ?? candidate.path` 取回，不重新拼路径。

### 1.2 三条降级规则（都能在测试里复现）

| 情况 | 处理 | 理由 |
| --- | --- | --- |
| 目录不存在（ENOENT/ENOTDIR） | 返回 `[]` | 宿主把空数组当"这个 provider 暂时没东西"；抛错会让 catalog incomplete |
| `description` 为空 | `warn` + 跳过该条 | `validateCandidate:456` 对空描述抛错，一条就能炸全目录 |
| frontmatter 非法（旧键/非布尔） | `warn` + 跳过该条（信息含路径与原因） | 同上；但错误必须原样带出，否则"技能不见了"成黑箱 |

`SkillFrontmatterError` 只在 `readSkillMarkdown` 里**透传**、不被折成 EMPTY：文件读不到才算空，文件读到了但写错是用户要修的东西。

### 1.3 rank

`PONYTAIL_SKILL_RANK = 550` < `BUNDLED_SKILL_RANK = 600`（宿主 `dsh-skill/lib/types/index.d.ts` 的 `export declare const BUNDLED_SKILL_RANK = 600`）。600 抄成本地常量并**不用值导入**：宿主 profile 里解析不到 `@deepseek-ai/dsh-skill`，值导入会让产物带一条必炸的运行时依赖（`verify` 第 2 组会拦）。真实性由测试断言"550 < 真实宿主的值"兜住。

---

## 二、六份正文（`skills/<id>/SKILL.md`）

### 2.1 内容规则

| 规则 | 为什么 |
| --- | --- |
| 中文重写，**英文触发词原样保留**（`be lazy` / `simplest solution` / `yagni` / `debt` 等） | 描述是给模型读的（`:1028-1030` 把描述原文塞进 catalog 文本），纯中文会丢掉英文用户的命中路径 |
| 阶梯统一**六阶** | 上游 `AGENTS.md:13-18` 现行口径（第 3 条把标准库与平台原生合并）；七阶是 2026-10-08 之前的旧口径 |
| 正文只写"怎么做"，不写"宿主怎么实现" | 正文进模型上下文，每一行都在烧 token |
| 斜杠命令后留半角空格 | 见摘要第 5 条 |

### 2.2 六个技能的折叠描述长度（实测）

| 技能 | 折叠后 UTF-16 长度 | 余量（480 - 长度） |
| --- | --- | --- |
| `ponytail` | 462 | 18 |
| `ponytail-review` | 461 | 19 |
| `ponytail-audit` | 458 | 22 |
| `ponytail-debt` | 293 | 187 |
| `ponytail-gain` | 244 | 236 |
| `ponytail-help` | 216 | 264 |

前三个贴着阈值：改描述时先跑 `pnpm run check:skills`，别靠眼睛。

---

## 三、长度口径（`src/skills/description.ts`）

```ts
export const DESCRIPTIONS_POLICY = { max: 500, ours: 480 } as const;
foldDescription(v)      // v.replaceAll(/\s+/g, ' ').trim()  —— 与宿主逐字同口径
truncateDescription(v,n)// 折叠后 <= n ? 原样 : slice(0, n-3) + '...'  —— 照抄宿主，含它的切半代理对缺陷
judgeDescription(raw)   // { folded, length, ok }，length 取 .length（UTF-16）
```

**不许用** `[...s].length`（数码点，含 emoji 的描述会少算一半，本地判过、宿主照样截断），也不许用 `Buffer.byteLength`（数字节，中文一个字算 3）。

`truncateDescription` 在 `maxLength < 3` 时返回的串比原串还长（`slice(0, 负数)`）——这是照抄宿主的结果，用测试钉住，**不顺手修**：本地修好只会让"本地过、宿主挂"更难查。

---

## 四、调用策略

| frontmatter 写法 | 解析结果 |
| --- | --- |
| 两键都缺省 | `invocation` 不下发，provider 用 `{modelInvocable:true, userInvocable:true}` 兜底 |
| `disable-model-invocation: true` | `modelInvocable = false` —— **六个技能都不许写** |
| `disable-model-invocation: false` | `modelInvocable = true`，合法 |
| `user-invocable: false` | `userInvocable = false`，等于砍掉斜杠入口 |
| 旧键 `disableModelInvocation` / `modelInvocable` / `userInvocable` | **抛错**，错误信息点名旧键与新键拼写 |

旧键必须报错而不是静默忽略：用户照着 SDK 类型写 `modelInvocable: false`，被当成未知键丢弃时"配置写了、行为没变、没有任何提示"——比报错贵得多。

`user-invocable:`（冒号后留空）按缺省处理、不报错：模板里留空是常态，为它炸掉整条 catalog 不值得；写了非 true/false 的值仍严格报错。

---

## 五、发布前把门（`scripts/check-skills.mjs`）

四类断言 + 一项漂移提醒，进 `prepublishOnly` 与 CI 的 quality / drift 两个 job：

1. `skills/` 下正好六个目录（名单来自 `skills/UPSTREAM.json` 的 `expectedDirs`）。
2. 描述折叠后 ≤ 480、含中文、含技能名。
3. 无 `disable-model-invocation: true`、无 `user-invocable: false`、无三个旧键。
4. 正文斜杠只指向六个技能名；出现全角「／」或 `/name，` 这类写法直接失败。
5. 漂移：查 `git/trees/<冻结石>` 还在不在（不在 = 上游改写或删了 tag，直接失败），再看 `commits?path=skills` 的 HEAD 是否已离开冻结 tag（离开 = 提醒）。匿名额度 60/h 共享，CI 注入 `GITHUB_TOKEN`；本地无 token 时只提醒、不阻塞。

---

## 六、可复现命令

```bash
pnpm run build && pnpm run typecheck
node --test test/*.test.mjs          # 69 条，含 test/skills-catalog.test.mjs 的 6 条真宿主用例
pnpm run check:skills
pnpm run verify
```

真宿主清点（不经本仓库测试框架，直接起 Context）：

```bash
node --input-type=module -e "import {Context} from '@deepseek-ai/cordis'; import {SkillRegistry} from '@deepseek-ai/dsh-skill'; import {SystemPrompt} from '@deepseek-ai/dsh-system-prompt'; import * as P from './lib/plugin.js'; const ctx=new Context(); await ctx.plugin(SystemPrompt); await ctx.plugin(SkillRegistry); await new Promise(r=>setTimeout(r,60)); const f=await ctx.plugin(P,{skillDir:'skills'}); await new Promise(r=>setTimeout(r,80)); const l=await ctx.skills.list({}); console.log(l.length, l.map(s=>s.name).join(','));"
```

实测输出：`count 6`，六条 `invocation` 全为 `{"modelInvocable":true,"userInvocable":true}`，`dispose` 后 `list()` 归 0。
