<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: wayfinder:task -->
<!-- DSH-IDEMPOTENCY-KEY: deck-99feb7bf-5980162 -->
<!-- DSH-CREATED: 2026-11-07T10:51:57.076Z -->
<!-- DSH-ASSIGNEES: lead -->
# 14: 客户端入口接线：回补 dsh.client 声明 + verify 联动检查 + 文档口径归位

Type: task

Status: resolved

## Question

完成核对发现三处「代码在、入口未接、文档说反」的不一致，其中第一条让 v0.2 的设置在真机上根本不会出现。

1. **`package.json` 没有 `dsh.client` 段，宿主完全不装载客户端半边。**
   宿主唯一发现入口是 `$H/dsh-client-modules/lib/index.js:789-802` 的 `resolveMeta()`：
   `const decl = parseDshClient(packageName, dsh !== null && typeof dsh === "object" ? dsh.client : void 0); if (decl === void 0 || decl.platform !== "web") return null;`
   → 没有这一段就直接 `return null`，`exports["./client"]` 在不在、`lib/client.js` 有没有都不影响。
   现状是 `dsh = { bundle: { patch: "./cordis.patch.yml" } }`（`package.json` 实测，无 `client` 键），而 `src/client/index.ts` 已经是一份完整可用的真注册（`export const inject = ['slots']`，`ctx.inject(['configForms'], scope => scope.slots.inject('settings.section', ...))`，产物 `lib/client.js` 16322 字节）。**宿主不会装载它。**
   这是 #11 的处置遗留：#11 为了让 v0.1 真零 UI 把 `dsh.client` 整段删掉、把 `apply` 改成空函数；#05 把 `apply` 改回真注册，但没回补声明。

2. **`scripts/verify.mjs:160-170` 的检查结构上允许「不声明」，抓不到上面的不一致。**
   现条件是 `clientBlock === undefined || (Array.isArray(clientBlock.inject) && clientBlock.inject.length > 0 && clientBlock.inject.every(name => name.startsWith('@deepseek-ai/dsh-client-')))`，注释原文写着「dsh.client 可以整段不声明（v0.1 就是这种形态：零客户端 UI）」。
   `lib/client.js` 自己的检查（`:184-208`：`__ModuleLoader__.load(`、模块 id === 包名、无 `@wenaixi/`、require 白名单）**不依赖这个声明**，所以产物层全绿、真机不装载。

3. **三份文档口径仍停在「v0.1 零客户端 UI」，与代码现状相反。**
   - `CHANGELOG.md:7`：「v0.1 不向宿主客户端注册任何界面（`dsh.client` 不声明、`lib/client.js` 不注册槽位）」
   - `CHANGELOG.md:39`：「**v0.1 零客户端 UI**。`src/client/` 保留为 v0.2 的骨架（构建仍产出 `lib/client.js`，但 `package.json` 不声明 `dsh.client`，产物也不注册任何槽位）」
   - `README.md:190`：「面板挂在 `plugins.bundle.config` 槽位…`ctx.slots.inject('plugins.bundle.config', ...)`」← 槽位已改 `settings.section`（#12 定案 `plugins.bundle.config` 是插件详情页 keyed slot，不是设置页）
   - `docs/migration-from-wenaixi.md:23`、`:62-64`：「v0.1 零界面：不声明 `dsh.client`、不注册槽位」
   `CHANGELOG.md` 还说「完整面板（档位切换、技能开关、状态快照）是 v0.2 的 #05」——#05 已交付，该句时态过期。

## 要做的事

1. **`package.json` 回补 `dsh.client`**，写成宿主全体 88 个声明里最常见的最小形态：
   `"dsh": { "bundle": { "patch": "./cordis.patch.yml" }, "client": { "platform": "web", "inject": ["@deepseek-ai/dsh-client-ui-settings", "@deepseek-ai/dsh-client-ui-renderer"] } }`
   - `inject` 必须是**包全名**（不是服务名 `slots` / `configForms`）：宿主的 `parseDshClient` 只校验字符串数组，真正拿它做模块图排序的是 `dsh-client-modules`。写服务名会被静默匹配不到、不报错，正是 verify 那句注释警告的坑。
   - 这两个包名都是宿主实装包：`@deepseek-ai/dsh-client-ui-settings` 提供 `configForms`（`lib/client.js:1270` `super(ctx, "configForms")`），`@deepseek-ai/dsh-client-ui-renderer` 提供 `slots`（`lib/client.js:1348` `super(ctx, "slots")`）。
   - 不写 `immediately`（面板不需要抢在首屏前加载），不写 `external`（我们没有 gateway 侧依赖）。
2. **`scripts/verify.mjs` 加一条联动检查**：读 `src/client/index.ts`，若出现 `slots.register` 或 `slots.inject`（排除注释），则 `pkg.dsh.client` 必须存在且 `platform === 'web'`；反之若声明了 `dsh.client` 而源码里没有注册动作，也要红（声明了却不注册 = 宿主里多一张空卡片，正是 #11 ⑥ 要避免的「半张 UI」）。两条一起才能把「说一套做一套」钉死。
3. **改文档口径**，全部改成「v0.2 起声明 `dsh.client`，面板落在设置页 `settings.section`」：
   - `CHANGELOG.md`：新增 v0.2 条目（面板、诊断链、四档、清除用户层覆盖），把 `:7` 与 `:39` 的「零 UI」改成对 v0.1 的历史陈述并注明 v0.2 已接。
   - `README.md:189-190`：槽位改 `settings.section`，并说明「只有装了 `@deepseek-ai/dsh-client-ui-settings` 的宿主才会出现这一页；面板缺席时全部能力仍可经 `/ponytail` 命令与配置文件完成」。
   - `docs/migration-from-wenaixi.md:23`、`:62-64`：更新为「有面板（设置页 `settings.section`）」。
4. **补一条真机发现测试**（可以放在 `test/` 下，但**不要**依赖宿主页面环境）：断言 `package.json#dsh.client` 的形状符合 `parseDshClient` 的四条规则（`platform` 是 string / `inject` 是非空全名数组 / 无未知键），并断言 `exports["./client"]` 指向的文件在磁盘上（宿主 `clientExportOf` 只认这个键，缺失会抛 `client-modules: PKG declares dsh.client but exports no "./client" bundle`）。

## 硬约束

- **不要为了「让面板出现」去改 `src/client/index.ts` 的注册姿势**：它现在只用 `slots.inject`、只注入 `slots` 一个硬服务、`configForms` 走运行时 `ctx.inject`——这三条都是 #05 与 #12 的定案，改动会破坏降级面。
- **降级语义不变**：声明了 `dsh.client` 之后，若宿主没装 `dsh-client-ui-settings`，客户端模块图会跳过我们的包（`arriveGraphRow` 对取不到的包静默跳过，不白屏）——这是预期行为，不要为它写防御分支。
- **`verify` 的联动检查必须自己能被反向验证**：造一次「有注册无声明」和一次「有声明无注册」，都要能红。检查逻辑本身加进 `scripts/verify.mjs` 的自测段（该文件 `:732-743` 已有扫描器自测先例）。
- **`dsh.client.inject` 里只写真实存在于宿主实装包的包名**，不要凭想象加 `@deepseek-ai/dsh-client-ui-plugin-manager` 之类我们并不需要的依赖。

## 验收

- `node -e "console.log(JSON.stringify(require('./package.json').dsh))"` 输出含 `client.platform === 'web'` 与两个全名 `inject`。
- `pnpm run verify` 全绿；把 `dsh.client` 段临时删掉再跑一次必须红（贴出红的那行）。
- `npm test` 全绿（含新增的清单形状断言）。
- `grep -rn "零客户端 UI\|不声明 `dsh.client`\|plugins.bundle.config" README.md CHANGELOG.md docs/` 只命中历史陈述（明确标注是 v0.1 的口径）与 `docs/research/` 下的取证笔记，不再有把现状说成「零 UI」的句子。

## Answer

四件事全部落地，方向是「让代码里已经存在的那份真注册，在真机上真的被装载」。根因不是面板写坏了，是**入口声明从来没回补**：`resolveMeta()` 见到 `dsh.client === undefined` 直接 `return null`，`exports["./client"]` 在不在、`lib/client.js` 有没有都不影响。

### 四件事的落点

| # | 要做的事 | 落点 | 结果 |
|---|---|---|---|
| 1 | 回补 `dsh.client` 最小声明 | `package.json:35-46` | `{"platform":"web","inject":["@deepseek-ai/dsh-client-ui-settings","@deepseek-ai/dsh-client-ui-renderer"]}`，不写 `immediately` / `external` |
| 2 | verify 加双向联动检查 | `scripts/verify.mjs:160-263`（原 10 行扩到约 104 行） | `judgeClientDeclaration()` 判形状、`judgeClientWiring()` 判互证；两个方向各有一句独立的错因文案 |
| 3 | 文档口径归位 | `CHANGELOG.md`、`README.md`、`docs/migration-from-wenaixi.md` | 三份全部改成「v0.2 起声明，面板挂设置页 `settings.section`」，v0.1 的「零 UI」降级为明确标注的历史陈述 |
| 4 | 清单形状测试 | 新建 `test/manifest.test.mjs`（6 条） | 按 `parseDshClient` 四键白名单 + `clientExportOf` 等价逻辑断言，且 inject 里的包名必须在 devDependencies（= 宿主实装） |

**verify 的检查为什么必须是双向的**：两个方向的坏法不一样，只查一边另一半就能悄悄漂掉。

- 有声明、无注册 → 宿主装出一张只有标题的空卡片，正是 #11 ⑥ 要避免的「半张 UI」；
- 有注册、无声明 → 宿主**根本不装载这个包**，源码在、产物也在，真机上永远不出现 —— #14 就是这一个。

`CLIENT_REGISTRATION` 那条正则跑在 `stripComments()` 之后，注释里的说明不算注册动作；`CLIENT_DECLARATION_KEYS` 只放宿主真读的四个键（`platform` / `inject` / `external` / `immediately`），多写一个就是没人读的死键。

### 验收四项（逐条给了实测）

| 验收项 | 证据 |
|---|---|
| 声明形状对 | `node -e` 读 tarball 内 `package/package.json`：`version= 0.2.0`、`client= {"platform":"web","inject":[...两项]}`、`exports["./client"]= {"default":"./lib/client.js"}`、`lib/client.js` 16322 字节 |
| 删掉声明必须红 | 红 1 项，原文：`✗ dsh.client 的声明与客户端源码对不上：` / `- src/client 里有槽位注册动作，但 package.json 没有 dsh.client：宿主 resolveMeta 见到 decl === undefined 直接 return null，客户端半边根本不装载，面板在真机上永远不出现。` 恢复后 `verify 通过（26 个源文件，97 个产物文件，1 条提醒）` |
| `npm test` 全绿 | `pnpm test` → **205 tests / 205 pass / 0 fail**（本轮前 199，新增 6 条） |
| 文档无「说现状是零 UI」的句子 | grep `零客户端 UI` / `零界面` / `plugins.bundle.config` / `不声明 dsh.client` 的非 `docs/research/` 命中只剩「不是 X 而是 Y」的对照句与明确标注的历史陈述 |

**反向验证补做了第二个方向**（票面只要求删声明那一侧）：把 `scope.slots.inject(` / `scope.slots.register(` 改名成 `scope.noopInject(` / `scope.noopRegister(` 再跑 → 红 1 项，原文：`- 声明了 dsh.client，但 src/client 里没有任何 slots.register / slots.inject：宿主会装出一张只有标题的空卡片，正是 #11 ⑥ 要避免的「半张 UI」。` 两边都改回来才绿。

**扫描器自测**：`node scripts/verify.mjs --selftest` → **19/19 通过**（原 14 + 新增 5 条 dsh.client 用例：认出有注册无声明 / 认出有声明无注册 / 认出 platform 写错 / 认出 inject 短名 / 放过合规声明）。这满足票面「检查逻辑本身必须能反向验证」那条硬约束。

### 四条真发现（票面没预见）

1. **`settings.section` 的声明方不是 `dsh-client-ui-settings`。** 实测 `dsh-client-ui-settings` 包内 grep `settings.section` **零命中**——它只提供 `configForms` 服务（`lib/client.js:1270` `super(ctx,"configForms")`）。槽位由 `dsh-client-ui-settings-general/lib/client.js:1547-1550` 在 `ctx.slots.register` 里声明（`name:"sidebar.settings"`，`children` 里带 `"settings.section": {kind:"list", scope:"root"}`），`:1587-1594` 自己又注册了「通用」那一条。**「面板不出现」因此有两种成因**：缺 `-ui-settings`（拿不到 `configForms`，我们的 `ctx.inject(["configForms"], …)` 永不回调）或缺 `-ui-settings-general`（槽位从未声明，`slots.inject` 静默等待）。README 的 FAQ 已按这两种成因写。
2. **`slots.inject` 的静默等待有边界。** `$H/dsh-client-ui-renderer/lib/client.js:1370-1420`：槽位未声明时 `if (spec === void 0) return;` 是静默等待；但注册回调**自己抛错**走的是另一条路——`INACTIVE_EFFECT` 静默 stop，其余 `queueMicrotask(() => { throw failure; })`。所以「不写防御分支」的前提是回调不抛错，不是「抛了也没关系」。
3. **`scripts/check-install.mjs` 对 `dsh.client` 完全盲。** 它 505 行只查 files 白名单里有没有 `lib/client.js`（`:390`）与它是不是 `__ModuleLoader__.load` 外壳（`:402-404`）。「装得上但装不进去」这一层此前没有任何检查覆盖，verify 的联动检查是唯一防线——这也解释了为什么 #05 之后所有质量门都绿、真机仍然没面板。
4. **改 CHANGELOG 会撞上 CI 的版本一致性检查。** `.github/workflows/ci.yml` 的 pack job 用「找第一行以 `## ` 后跟数字开头的版本头」的方式取版本，`[Unreleased]` 不以数字开头会被跳过、落到 0.1.0 那行。若 package.json 保持 0.1.0，字符串能对上但**语义撒谎**（0.1.0 是「纯宿主侧」的历史）。故把版本抬到 **0.2.0**：装上去能看到的东西变了，按 semver 是 minor。手跑该脚本：`first= ## [0.2.0] - 2026-11-08` / `pkg.version= 0.2.0` / `includes= true`。

### 两处与票面假设的分歧

- 票面第 4 条把形状测试与 verify 的联动检查当作同一件事的两种写法。落地后发现**视野不同、都要留**：verify 看得见仓库里的源码与声明两侧；`test/manifest.test.mjs` 看得见**发布出去的字节**（中间隔着 `npm pack`、`parseDshClient`、`clientExportOf` 三层）。`test/manifest.test.mjs` 的重心因此放在 inject 包名必须真在 devDependencies、`exports["./client"]` 必须指向磁盘真文件这两条「只有打包后才成立」的断言上。
- 票面没提版本号。改文档口径时撞上上面第 4 条真发现，顺手抬到 0.2.0，CHANGELOG 顶部从 `## [Unreleased]` 改成 `## [0.2.0] - 2026-11-08`。

### 硬约束核对

| 约束 | 核对 |
|---|---|
| 不改 `src/client/index.ts` 的注册姿势 | 本轮该文件零改动，仍是 `export const inject = ['slots']` + `ctx.inject(['configForms'], …)` |
| 不为 UI 包缺席写防御分支 | 新增代码里零 `try/catch` 探测，降级靠宿主 `arriveGraphRow` 静默跳过 |
| 联动检查自己能被反向验证 | `--selftest` 19/19，两个方向各一条用例 |
| inject 只写真实存在的包名 | `test/manifest.test.mjs` 有一条断言：inject 每一项都必须在 devDependencies 里 |

### 质量门（本轮实测，全绿）

`pnpm run typecheck` exit 0 · `pnpm run build`（client bundle 16322 B，3 个 external require）· `pnpm run verify` 通过（26 源文件 / 97 产物 / 1 提醒）· `pnpm test` **205/205** · `pnpm run check:skills` 通过（6 技能，阈值 480/500，GitHub 限流 403 跳过漂移）· `pnpm run check:matrix` 覆盖 15 个版本 ✓ · `npm pack` 产出 `dsh-ponytail-58fly-0.2.0.tgz`（90863 B，60 files）。

### 遗留

1. **真机装载尚未实测。** 本票证明了「声明与产物都对、发布出去的字节里有声明」，但没有把 tarball 装进真宿主看设置页。宿主是否装载还取决于它是否装了 `dsh-client-ui-settings` 与 `-settings-general`；这一层要在真机上验。
2. **仓根不是 git 仓库**（`git log` → `fatal: not a git repository`），版本号只由 package.json 与 CHANGELOG 两处决定，没有 tag 锚点。
3. **`dsh-ponytail-58fly` 尚未发布**（`npm view` → E404），仓根留着旧的 `dsh-ponytail-58fly-0.1.0.tgz`，发布前要清掉，否则与新的 0.2.0 tarball 混在一起。

回补 dsh.client 最小声明；verify 加双向联动检查（19/19 selftest）；三份文档口径归位；新增 6 条清单形状测试；版本抬到 0.2.0。质量门全绿 205/205。

## 进度

- 2026-11-08：四件事全部落地，验收四项逐条取证，质量门全绿，tarball 已按 0.2.0 重打并核对。
