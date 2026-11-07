<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: wayfinder:task -->
<!-- DSH-IDEMPOTENCY-KEY: deck-98449511-5980162 -->
<!-- DSH-CREATED: 2026-11-07T10:50:32.194Z -->
<!-- DSH-BLOCKED-BY: 10 -->
<!-- DSH-ASSIGNEES: lead -->
# 13: 判据 8 落地：技能 provider 越界防护 + 告警文案修复

Type: task

Blocked by: 10

Status: resolved

## Question

地图判据 8 的决定早已成文（`.scratch/ponytail-takeover/map.md:21`：`get()` 对 `locator.path` 做 resolve 后前缀校验、`list()` 对符号链接取 realpath 后同样校验），**实现零落地**。`src/skills/provider.ts` 里唯一沾边的 `startsWith` 是 `:107` 的 `entry.name.startsWith('.')`（跳过点文件），与越界防护无关。

三条逃逸路径已实测可复现（探针脚本 `/tmp/pt-b01-probe.mjs`）：

1. **符号链接逃逸**：`skills/evil-link` → `skillDir` 外的目录，`list()` 因 `:106` `if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;` 直接放行进候选，`get()` 读到 skillDir 外的正文并喂进模型上下文（实测读到「这是一段本不该被读到的内容。」）。
2. **伪造 locator 读任意绝对路径**：`get()` 在 `:150` `const path = (candidate.locator as SkillLocator | undefined)?.path ?? candidate.path;` 完全信任宿主透传的 locator，构造 `{ locator: { path: '/etc/hosts' } }` 即返回 `/etc/hosts` 全文（实测）。
3. **`resourceBase` 一并越界**：`:161` `resourceBase: { kind: 'directory', path: join(path, '..') }`，越界时把父目录也交出去了。

附带一处真 bug（同一文件，实测已证）：`:129` 的模板占位符被反斜杠转义（源码里写成 `\${name}` 与 `\${path}` 而非 `${name}` 与 `${path}`）。

```
实测 warn 原文：技能 ${name} 缺少 description，已跳过：${path}
```

文件名与路径全丢。全仓 `src/` 只此一处（`grep` 反斜杠-美元-花括号 = src 1 命中 `src/skills/provider.ts:129`，test 0 命中），`test/` 无任何断言覆盖这条文案。

这是上游 B-01 的同型缺陷。地图 `:33` 记的修法「三个 blocker 的修法已落进 Decisions，判据 8 覆盖 B-01」只在决定层成立。

## 要做的事

1. **抽一个根前缀判定**（纯函数，可单测）：输入「已 realpath 的根」与「候选绝对路径」，输出是否在根内。**两侧必须都是 realpath 的结果**——macOS 上 `os.tmpdir()` 给 `/var/folders/…` 而 `realpath` 返回 `/private/var/folders/…`，只规约一侧会把全部正常技能判成越界（实测：`realpath(skillDir) === skillDir` 为 `false`）。判定要按路径分隔符边界，不能纯 `startsWith`（`/a/bc` 不该匹配根 `/a/b`）。
2. **`list()` 收口符号链接**：`readdir` 拿到候选后，对每个条目 `realpath(join(skillDir, entry.name))`，不在根内则 `warn` + 跳过（不抛错——单条坏技能不能拖垮整份目录，这是 #10 已立的原则）。根也 `realpath` 一次并缓存（`list` 每次调用都算太浪费，但 `skillDir` 是构造期常量，可以在首次 `list` 时懒算一次）。
3. **`get()` 收口 locator**：`realpath` 候选路径后做同一判定；越界返回 `undefined`（宿主语义：`get` 拿不到就是没有这个技能），**不要抛错**——抛错会让整条 catalog 变 incomplete。文件不存在导致的 `realpath` `ENOENT` 也返回 `undefined`。
4. **修 `:129` 的模板转义**：`\${name}` → `${name}`、`\${path}` → `${path}`。
5. **补测试**（现有 `test/skills-catalog.test.mjs` 7 条全是正向断言，零越界覆盖）：符号链接指向 skillDir 外 → `list()` 不含它且有 warn；伪造 `locator.path` 指向 skillDir 外 → `get()` 返 `undefined`；正常技能不受影响（防「全判越界」回归）；缺 description 的告警文案必须含真实目录名与真实路径（钉住第 4 条）。

## 硬约束

- **不改 `SkillProvider` 的公开面**：仍是 `{ name, list, get }`，`get` 第一参数仍是 candidate。
- **越界一律降级不抛错**：`list` warn + 跳过，`get` 返 `undefined`。理由同 #10：一次抛错就让整条 catalog 变 incomplete。
- **不用 `as` 消解新增的类型问题**：本仓 `any` 零、`as` 只在 `src/prompt/notice.ts` 有一处（`brandMessageId`，已写明理由）。新增的 realpath 逻辑不该引入新的断言。
- **不引入运行时依赖**：只用 `node:fs/promises` 的 `realpath` 与 `node:path` 的 `resolve/sep`。
- **`list()` 的 `warn` 要能定位到具体文件**：说清是哪个条目、逃到哪去，否则「技能不见了」变黑箱。

## 验收

- `/tmp/pt-b01-probe.mjs` 的两条逃逸路径转成正式测试后必须变绿（修复前红、修复后绿，两边都要有证据）。
- 正常技能 6 个照常出现在 `ctx.skills.list({})`（`test/skills-catalog.test.mjs` 现有 7 条全绿不回归）。
- `pnpm run typecheck` / `pnpm run verify` / `npm test` 全绿。
- 告警文案实测含真实 `entry.name` 与真实 `path`（断言里放真实值，不放 `${name}` 字面量）。

## Answer

判据 8 已从"决定层"落到"实现层"，三条逃逸路径全部收口，转义 bug 已修，14 条新测试钉住。

### 五件事的落点

| 要做的事 | 落点 | 证据 |
|---|---|---|
| 1 根前缀判定纯函数 | 新建 `src/l0/within.ts`（89 行，零 `node:` 导入）`isWithinRoot(root, candidate): boolean` | 8 条纯函数测试全绿 |
| 2 `list()` 收口符号链接 | `src/skills/provider.ts:119-148`：每条目 `realpath(join(skillDir, entry.name))` → 越界 `warn` + `continue`；根用 Promise 惰性缓存（`:109-116`） | `list()：符号链接指向技能目录之外时跳过并告警` |
| 3 `get()` 收口 locator | `src/skills/provider.ts:189-225`：不复信 locator，`realpath(declared)` 后同一判定，越界 `undefined` + `warn` | `get()：伪造 locator.path 指向根之外时返回 undefined（不抛错）` |
| 4 修 `:129` 模板转义 | `\${name}`/`\${path}` → `${name}`/`${path}`，现为 `:169` | `缺 description 的告警带真实目录名与真实路径（转义 bug 的回归）` |
| 5 补测试 | 新建 `test/skills-within.test.mjs`（14 条：8 条纯函数 + 6 条 provider 收口） | `tests 14 / pass 14 / fail 0` |

### 验收四项

| 验收项 | 结果 |
|---|---|
| 两条逃逸转正式测试后变绿，修复前后都要证据 | **前红后绿已实测**：把两处围栏短路成 `if (false)` 重跑 → `not ok 9`（符号链接）+ `not ok 10`（伪造 locator），`# pass 12 / # fail 2`；恢复后 `# pass 14 / # fail 0`。不是"写个测试正好过"，是同一条测试在缺陷版本上会红。 |
| 正常 6 技能照常出现，`skills-catalog` 不回归 | 全量 `npm test` **199 / 199 pass**（本轮前 185，新增 14 条），`skills-catalog.test.mjs` 6 条与 `composition.test.mjs` 10 条全在。 |
| typecheck / verify / test 全绿 | `typecheck` exit 0；`build` 通过（client bundle 16322 B）；`verify` 通过（**26 源文件 / 97 产物 / 1 提醒**，本轮前 25/93）；`check:skills` 通过（6 技能，阈值 480/500）；`check:matrix` 覆盖 15 个版本 ✓。 |
| 告警文案含真实 `entry.name` 与真实 `path` | 测试里断言的是 `join(skills, 'silent', 'SKILL.md')` 这个**运行时真值**与字符串 `'silent'`，并额外断言 `!hit.includes('\\${')`——修复前那条文案里两个变量名都以字面量形式出现，这条断言当场会红。 |

### 三条真发现（票面没预见的）

1. **macOS 的 `/var` → `/private` 不是理论风险，第一个受害者就是现有测试**。改完后 `test/composition.test.mjs:127` 的 `resourceBase.path === join(dir, 'ponytail')` 立刻红——因为 provider 现在交出的是 realpath 后的路径。已改成两侧都过 `realpath` 再比（`join(await realpath(dir), 'ponytail')`），并在注释里说明这行本身就是"两侧都 realpath"这条约束的回归测试。**凡是拿 `os.tmpdir()` 造目录又比路径字符串的地方，都会踩这一脚。**

2. **悬空符号链接是第三条逃逸路径，票面只写了两条**。`readdir({withFileTypes:true})` 的 `dirent` 是 lstat 语义，所以指向已删除目标的链接照样出现在列表里、`isSymbolicLink()` 为真；对它的 `realpath` 抛 `ENOENT`。若不单独接住，一条悬空链接就让整个 `list()` 抛错——正好违反"越界一律降级"。已按 `isMissingDirectory` 收口成 `warn` + `continue`，文案是「技能 X 的目录无法解析，已跳过：路径（原因）」。

3. **`get()` 不能靠"读出来是空 body"来兜越界**。原实现里 `readSkillMarkdown` 把 I/O 失败折成 `{body:''}` 返回（`src/skills/frontmatter.ts:196-205`），再由 `:153` 挡成 `undefined`——看着像已经防住了。但那只对"文件不存在"成立：越界路径**只要文件真存在**就会读到全文。所以判定必须自己 `realpath` + 判围栏，落在读取之前。

### 与票面假设的两处分歧

- **票面第 4 条写"只用 `node:fs/promises` 的 realpath 与 `node:path` 的 resolve/sep"**——实际没用 `resolve`/`sep`。判定抽成纯函数放进 `src/l0/within.ts`，自己归一两种分隔符。理由：l0 层自 #03 起零 `node:` 导入（`src/l0/paths.ts` 也是纯字符串），为这一个判定破例不值得；verify 的分层矩阵也只允许 `skills` → `l0`，反向不成立。
- **"根也 realpath 一次并缓存"落地成 Promise 缓存而非值缓存**：`root ??= realpath(skillDir).catch(...)`。缓存 Promise 而不是字符串，并发 `list()` 不会各解析一遍、也不会因为第一个失败就永久卡住。`null` 表示目录压根不存在——那是"还没装技能"，走原有空数组分支。

### 硬约束核对

| 约束 | 结果 |
|---|---|
| 不改 `SkillProvider` 公开面 | 仍是 `{ name, list, get }`，`get(candidate)` 签名未动；私有接口 `SkillLocator` 保持未导出。 |
| 越界一律降级不抛错 | `list` warn + `continue`；`get` `undefined` + warn。只有真正的系统错误（`EACCES` 之类）才重抛——与宿主 `dsh-skill-filesystem` 的 `isAbsentSkillPathError` 分界一致。 |
| 不新增 `as` | 新增代码零 `as`。`provider.ts:190` 那处 `(candidate.locator as SkillLocator | undefined)` 是原有断言，保留原因写在原地。全仓 `as`（除 `as const`）仍 12 处，与改动前同。 |
| 不引入运行时依赖 | 只加了 `realpath` 到已有 `node:fs/promises` 导入行。`package.json` 的 `dependencies` 仍为空。 |
| `list()` 的 warn 能定位 | 越界文案「技能 X 的真实路径不在技能目录内，已跳过：<真实逃逸目标>（技能目录 <根>）」；解析失败文案「技能 X 的目录无法解析，已跳过：<条目路径>（<原因>）」。测试断言逃逸目标落到 `realpath(outside)` 上。 |

### 顺带的两处优化（票面没要求，顺手做了）

- 点文件过滤提前到 `isDirectory()` 判断之前：`.git` 这类条目省掉一次 `realpath` 系统调用。
- `list()` 拼 `SKILL.md` 时改用 `realEntry` 而不是 `skillDir`：路径链上不再出现"原始根 + 真实条目"的拼接，日志与 `resourceBase` 前后一致。

### 遗留

- `get()` 里的 `SkillLocator` 断言仍是现有那处 `as`。彻底去掉需要宿主把 `locator` 的 `unknown` 换成可判别类型，属上游改动，不在本票。
- 越界判定只覆盖"读"，不覆盖写——本插件不写技能目录，没有写路径。

判据 8 已落地：src/l0/within.ts 纯函数判定 + provider.ts 三处收口（list 符号链接 / get locator / :129 转义），新增 14 条测试（修复前 2 红、修复后全绿），全量 199/199 pass。

## 进度

判据 8 已落地：新增 `src/l0/within.ts`，`provider.ts` 三处收口（list 符号链接 / get locator / 转义文案），新增 14 条测试（修复前 2 红、修复后全绿）；全量 199/199 pass，verify 26 源文件 / 97 产物。
