<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: wayfinder:task -->
<!-- DSH-IDEMPOTENCY-KEY: deck-plan-ponytail-takeover-v1-child-T1 -->
<!-- DSH-CREATED: 2026-11-07T03:34:34.156Z -->
# 03: 新仓库骨架：模块边界、宿主类型 shim、构建链、基础 CI

Type: task

Status: resolved
## Question

搭出可开发、可测试、可发布的新仓库骨架。这是所有 task 票的地基。

## 要做的事

0. **命名固定（#01 定案，不可再改）**：`package.json#name = "dsh-ponytail-58fly"`。连带统一：仓库名、`dsh.client` 的模块 id、settings 命名空间、config 目录名、README 标题。技能 id 前缀 `ponytail-*` 与命令前缀 `/ponytail` **保持不变**（那是技能名不是包名，改了会丢触发词兼容）。**不得**在包名位置继续用 `ponytail`。
1. **模块边界**（按上游审计的结论重划，不照抄它的 9 个平铺文件）：
   - `prompt/` —— 渲染核心：baseline 锁、尾部 reminder、围栏过滤、进程内缓存
   - `state/` —— 会话状态：内存 Map + `agent/disposed` 清理
   - `config/` —— 优先级链 + 诊断报告 + Schema（不给默认值）
   - `skills/` —— skill provider + frontmatter + 双语描述
   - `plugin.ts` —— 唯一入口，只做装配，不含业务
   - **不含**：self-heal / salvage / LRU / 双通道 flag
2. **宿主类型：零 shim**（原判断已被实测证伪：Electron 打包裁剪了 `lib/types/**/*.d.ts`，但 **npm 发行物完整发布**——`npm pack @deepseek-ai/dsh-<x>@0.2.2-rc.1` 解包得 63 个 .d.ts、每包 `types = "lib/types/index.d.ts"`）。做法：把 `@deepseek-ai/*` 装成 devDependency 直接吃官方类型，**不写任何 types/dsh/*.d.ts**。`agent/pre-step` 与 `agent/disposed` 的定义住在 `@deepseek-ai/dsh-agent` 的 `declare module '@deepseek-ai/cordis'` 增强里，只有该包类型被真正引用才生效（在回调参数标注里用上 `Agent`）。目标仍是**全仓零 `as unknown as`**（上游 72 处 as，含 config.ts:214-220 / :226-233 两处高危断言）。
   - 附带硬约束：产物里**不得对 `@deepseek-ai/dsh-*` 做值导入**（宿主 profile 只装 cosmokit 与 schemastery，`dsh-*` 不参与插件解析 → 装完第一次装载就 ERR_MODULE_NOT_FOUND）。需要常量时本地抄并加哨兵测试。
3. **构建链**：`tsc` 出 `lib/`，`lib/` **不入库**；客户端侧若做，用真 `.tsx` + tsdown/esbuild（否决字符串模板）。`prepublishOnly` 串 `build + typecheck + verify + test`。
4. **基础 CI**（已落地 `.github/workflows/ci.yml`，四个 job）：`quality`（Node 20/22 × `install --frozen-lockfile → typecheck → build → verify → test`）、`compat`（dsh `0.2.0-rc.1` / `0.2.1-rc.5` 两个早期 rc，先 `scripts/set-dsh-version.mjs` 改 devDependency 再 `install --no-frozen-lockfile`，**必须跑 build**——TS2742 只有声明生成能看见）、`install`（tarball 与 `link:` 两形态真装真 import）、`pack`（tarball 必含 7 个路径、禁入源码/映射/缓存）。全局 `PNPM_VERSION: 12.16.1`（`allowBuilds` 是 v12 语法）。
5. **`.gitignore` 与 `files` 白名单**：与 @mirelconstantin 的 check-pack 思路一致，发布内容可断言。

6. **L0 归一化模块（本票产出，被 #04 / #06 / #07 共用）**：`coerceMode(raw: unknown): RuntimeMode | null` 是**唯一**写模式入口，纯函数、零 I/O、不 import 任何其他层。除它之外 L0 还含路径常量（skillDir 解析基准）、`RuntimeMode` 与 `PRIORITY` 的字面量联合类型。这条把上游 `state.ts:298-306`（不归一）、`:317-318`（算出 `nm` 却赋原值）、`:372`（归一失败原样保留）三处垃圾态一次性消灭。

## 硬约束

- 依赖纪律：运行时依赖宁零勿多。上游只用 1 个（`yaml`）。**已实测的判据**：0.2.2 的 `settings.mutate` 会把 volatile 值写进 profile `cordis.patch.yml` 的 config 段，宿主自己负责 YAML 序列化；我们要**读**的东西（settings 的 `describe`/`base`/`user`、env、代码兜底）全是结构化对象，不需要解析 YAML 文本。→ **v0.1 目标是零运行时依赖**，`yaml` 只在「必须读用户手写的 patch 原文」时才引回，并在 #04 里说明。
- **安装形态会影响依赖解析**：实测 `dsh plugin add <本地目录>` 会生成 `link:`，pnpm 不装 dependencies，`import 'yaml'` 直接 `ERR_MODULE_NOT_FOUND`。零依赖顺带消灭这类形态问题；CI 里必须同时验证 tarball 安装与 link 安装两种形态。
- 不写任何"以后可能用到"的抽象。

## 验收

- `pnpm typecheck` / `pnpm build` / `pnpm verify` / `pnpm test` 全绿（当前 dsh 0.2.2-rc.1：typecheck 0 错、build 产出 client.js 2938 B、verify 通过、test 33 pass）。
- 兼容矩阵 0.2.0-rc.1 / 0.2.1-rc.5 上四条链路同样全绿。
- 有两种安装形态的端到端验证：tarball 与 `link:` 都能 `import` 出 `apply/inject/Config`。
- 有真实 Cordis 组合测试（9 条）：section 顺序、卸载回收、重复装载拒绝、非法配置被 schemastery 拒。
- 全仓 `as unknown as` = 0；唯一保留的 `as` 是 `provider.ts` 里 `unknown` 错误码收窄。

## Comments

### local — 2026-11-07T05:54:18.371Z
## Answer（2026-11-07 收口）

骨架已落地并在四种安装/版本组合上全绿。

### 一、票面第 2 条被证伪，已改写
票面写「宿主包不发布 .d.ts，要自己写 types/dsh/*.d.ts」。实测**不成立**：Electron 打包裁剪了 `files` 里的 `lib/types/**/*.d.ts`，但 npm 发行物完整发布——`npm pack @deepseek-ai/dsh-<x>@0.2.2-rc.1` 解包后共 63 个 .d.ts（dsh-skill 1 / dsh-system-prompt 1 / dsh-agent 8 / dsh-settings 4 / dsh-commands 6 / dsh-scope 2 / dsh-llm 15 / dsh-session 10 / dsh-app-boot 22 / dsh-client-modules 9 …），每包 `package.json#types = "lib/types/index.d.ts"`。
→ 结论改为：把 `@deepseek-ai/*` 作为 devDependency 装进来，**零手写 shim**。全仓 `as unknown as` = **0 处**（上游 72 处 as，其中 config.ts:214-220 / :226-233 两处是高危断言）。
唯一保留的 `as` 是 `src/skills/provider.ts` 里读 Node 错误码的 `(error as { readonly code?: unknown } | null)?.code`——`unknown` 收窄必需，不是绕过类型。

### 二、实际交付（11 个源文件 / 37 个产物文件）
```
src/l0/mode.ts            RuntimeMode / PRIORITY_LEVELS / coerceMode(unknown) / DEFAULT_MODE
src/l0/paths.ts           DSH_HOME 解析 / PLUGIN_ID / getConfigDir / resolveSkillDir / expandHomePath
src/config/schema.ts      Config（三字段，零 .default()）+ PonytailConfig
src/prompt/index.ts       installPrompt（SECTION_NAME='ponytail-58fly'，order=50）
src/prompt/render.ts      createStaticRenderer（#07 的占位实现）
src/state/sessions.ts     SessionStore（内存 Map）+ installSessionStore（agent/disposed 清理）
src/skills/frontmatter.ts parseSkillMarkdown / readSkillMarkdown（零 yaml 依赖）
src/skills/provider.ts    createSkillProvider / installSkills（rank 550 < 600）
src/client/index.ts       apply：ctx.slots.inject('plugins.bundle.config') + register
src/client/panel.tsx      真 .tsx，走 Button 类型
src/plugin.ts             装配入口：apply 依次装 state → skills → prompt
```
构建链：`tsc -p tsconfig.build.json`（outDir=lib，declarationDir=lib/types）+ `node scripts/build-client.mjs`（esbuild → `window.__ModuleLoader__.load({id, factory})` 外壳）。`lib/` **不入库**（上游把它提交进 Git 是为 GitHub 直装免构建，代价是产物漂移无从审计）。

### 三、四条链路 + 兼容矩阵（全部实测）
| 链路 | dsh 0.2.2-rc.1（当前） | 0.2.1-rc.5 | 0.2.0-rc.1 |
|---|---|---|---|
| `pnpm typecheck` | exit 0 | exit 0 | exit 0 |
| `pnpm build` | exit 0，client.js 2938 B | exit 0 | exit 0 |
| `pnpm verify` | 通过（11 源 / 37 产物 / 1 warn） | 通过 | 通过 |
| `pnpm test` | 33 pass / 0 fail | 33 pass | 33 pass |

安装形态：`scripts/check-install.mjs` 在临时 profile 里真装真 import，tarball 与 link: 两种形态都通过（`import ok: name=ponytail-58fly inject=["systemPrompt","skills"]`）。tarball 24240 字节，含 10 个 .js + 9 个 .d.ts，无 src/test/映射泄漏。

### 四、本票抓到的三个真实事故（都已变成红灯）
1. **files 白名单漏整棵产物树**：原 `files` 只写 `lib/plugin.js` + `lib/client.js`，tarball 里 9 个被相对 import 的模块全缺 → 装完 `ERR_MODULE_NOT_FOUND`。现在 verify 把 files 模式展开成 glob 撞真实产物，漏一个就红灯。
2. **产物里对宿主包的值导入会炸**：宿主 profile 的 node_modules 只有 `cosmokit` 与 `schemastery`，`@deepseek-ai/dsh-*` 只活在 App 打包树里、不参与插件自己的解析。上游靠 `import type` 活下来。我第一版 `import { BUNDLED_SKILL_RANK } from '@deepseek-ai/dsh-skill'` 是值导入，装完第一次装载必炸。改为纯类型导入 + 本地抄常量，并加了一条哨兵测试断言抄来的 600 与宿主真实值一致。verify 新增「产物运行时依赖面」检查，白名单只留 cordis / schemastery。
3. **TS2742：声明文件会写出依赖的物理路径**。只写 `const Config = z.object({...})` 时，旧版 dsh 的 peer 解析把 schemastery 落到 `.pnpm/@deepseek-ai+schemastery@3.18.5/...`，`tsc -p tsconfig.build.json` 报
   `error TS2742: The inferred type of 'Config' cannot be named without a reference to '.pnpm/@deepseek-ai+schemastery@3.18.5/node_modules/@deepseek-ai/schemastery'.`
   typecheck 与 test 都看不见它，只有 build 会炸。修法：给 `Config` 显式标注 `Schemastery<ObjectS<ConfigShape>, ObjectT<ConfigShape>>`，声明文件从此只引用包名。CI 的 compat job 因此必须跑 build（原注释写"build 与版本无关"是错的，已改）。

### 五、测试与检查
- `test/l0.test.mjs`（14）+ `test/frontmatter.test.mjs`（10）+ `test/composition.test.mjs`（9）= 33 条。
- 组合测试用裸包名 import 真 Cordis（不再需要 #02 原型里的 DSH_MODULES 绝对路径），断言 section 顺序 `['harness:identity','deployment:persona-prefix','ponytail-58fly','deployment:persona-suffix']`——**0.2.2 的 assemble 固定先给 harness:identity（order -1000）**，这是 #02 原型没算进去的一段。
- `ctx.plugin()` 返回 thenable Fiber 不是 Promise，`assert.rejects` 用不了，改 try/catch 捕 message。
- `scripts/verify.mjs` 八组检查：身份与依赖面 / 产物面 / 运行时依赖面 / 分层方向（带三色环检测）/ 断言纪律（先剥注释再搜）/ L0 纯净（不得 import node:）/ files glob 覆盖 / skills 与 README/LICENSE。

### 六、留给后续票的接缝
- `config/schema.ts` 三字段都不写 `.default()`：#04 的优先级链必须在运行时算出 effective 值并留三层来源痕迹（写死默认值会让"配过/没配过"在校验后不可区分）。
- `skills/provider.ts` 的 `get()` 现在返回空 content：#10 补正文与双语描述（描述阈值 480，宿主默认 500）。
- `prompt/render.ts` 的静态渲染器是占位：#07 换成 baseline 锁 + 尾部 reminder + 围栏过滤。
- `state/sessions.ts` 只有 `baselineMode` 字段：#06 补 baseline 锁语义；`skills/` 目录为空，verify 只 warn 不红。
- `client/index.ts` 只 inject `slots`：不碰 configForms / locale / remote，那是 #05 的活；提前写进来会让没装 settings 的部署整个 client 条目被跳过。

## Answer

骨架落地：11 源文件 / 37 产物；typecheck / build / verify / test 四条链路在 dsh 0.2.2-rc.1、0.2.1-rc.5、0.2.0-rc.1 上全绿，test 33 条；tarball 与 link: 两形态真装真 import 通过。票面第 2 条（宿主类型 shim）已被实测证伪并就地改写为零 shim。

## 进度
