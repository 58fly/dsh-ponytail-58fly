# 变更记录

本文件记录面向用户的变更。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.2.0] - 2026-11-08

相对 v0.1 的唯一方向性变化是**把客户端半边真的接上**：
v0.1 是纯宿主侧发布（`dsh.client` 不声明、`lib/client.js` 不注册槽位），
到了 v0.2，同一个 `lib/client.js` 里那份真注册终于有了入口声明。
版本号从 0.1.0 抬到 0.2.0 而不是复用 0.1.0：装上去能看到的东西变了（设置页多一栏），
按 semver 这是 minor；而 0.1.0 的「纯宿主侧」是真实历史，不该被后来的面板覆盖掉。

### 新增

- **设置页面板**（挂 `settings.section`，不是插件详情页的 `plugins.bundle.config`）：
  四档单选、清除用户层覆盖、三层诊断链（env / patch / fallback 谁在生效、被谁顶掉）。
  数据走宿主的 `configForms` 表单通道（`getSnapshot` / `set` / `unset`），
  切档后重新拉快照再渲染，不做本地先改后写。
- **`package.json#dsh.client`**：`{platform: "web", inject: ["@deepseek-ai/dsh-client-ui-settings", "@deepseek-ai/dsh-client-ui-renderer"]}`。
  这两项是**包全名**而非服务名——宿主 `parseDshClient` 只校验字符串数组，
  真正按包名查模块图的是 `dsh-client-modules`，写服务名会被静默跳过。
- **`scripts/verify.mjs` 的 dsh.client 联动检查**：声明与源码必须互相印证。
  「有注册无声明」和「有声明无注册」两个方向都判红（前者真机不装载，后者装出一张空卡片），
  两个方向都进了 `--selftest`。
- **`test/manifest.test.mjs`**：把宿主 `parseDshClient` / `clientExportOf` 的判据
  抄成断言，让「装不起来」在 CI 里就红，而不是等用户装完发现面板不出现。

### 降级

客户端缺席是**预期形态**，不是故障：`dsh.client.inject` 里取不到的包会被模块图静默跳过
（不白屏），面板整块不出现；宿主侧的四档、六个技能、`/ponytail` 命令全部照常。
面板不是唯一入口——改档位也可以走 `/ponytail <档位>` 或 profile 的 `cordis.patch.yml`。

## [0.1.0] - 2026-11-07

首个发布版本。**纯宿主侧**：v0.1 不向宿主客户端注册任何界面（`dsh.client` 不声明、`lib/client.js` 不注册槽位），插件管理器里不会多出入口，设置只能改 patch 或环境变量。——这是 v0.1 的历史形态，v0.2 已接上面板（见 Unreleased）。

### 新增

- **四档提示词阶梯**：`off` / `lite` / `full` / `ultra`，作为一段系统提示在
  `SECTION_ORDER 50` 处插入。`off` 渲染空串，被宿主的 `filter(text => text.length > 0)` 自然丢弃。
- **六个技能**：`ponytail`、`ponytail-review`、`ponytail-audit`、`ponytail-debt`、
  `ponytail-gain`、`ponytail-help`。正文源自上游 DietrichGebert/ponytail v5.3.3，
  以 `skills/UPSTREAM.json` 记录冻结点，CI 每日比对并在漂移时报警（只报警，不自动同步）。
- **会话级档位状态**：`/ponytail` 命令切档，按 agent 维度隔离，dispose 时清空，不落盘。
- **设置面板通道**：`defaultMode` / `skillDir` / `locale` 三个字段走 `ctx.settings`，
  宿主负责持久化；插件自身零写盘。
- **环境变量覆盖**：`PONYTAIL_DEFAULT_MODE` 优先于配置与缺省值。

### 兼容

- `engines.dsh`: `>=0.2.0-rc.1 <0.2.3-0`。区间内 **15 个已发布版本逐格**在 CI 中
  跑过 `typecheck → build → verify → test → 打包 → 真装配`。
- `peerDependencies`: 只声明 `@deepseek-ai/cordis ~4.1.0` 与
  `@deepseek-ai/schemastery ~3.19.0`；运行时零 `dependencies`。
- 注意：`engines.dsh` 只在 dsh-app-boot `>= 0.2.1-rc.1` 上被读取。在
  `0.2.0-rc.x` / `0.2.1-alpha.x` 上宿主只校验 `peerDependencies`，所以
  `engines.dsh` 与两个 peer 必须保持一致——这是功能性要求，不是文档要求。
- 产物里不出现 `new Function` / `eval(`，运行时不值导入宿主包子路径（子路径是私有布局），
  这两条由 `verify.mjs` 在仓库层、CI `pack` job 在**发布出去的字节**上各查一遍。

### 已知限制

- **`skillDir` 缺省值是用户目录，不是包内目录**。`$DSH_HOME/ponytail-58fly/skills` 是给用户
  放自定义技能的地方，安装包不会往里写（零写盘承诺）。发布物自带的 `cordis.patch.yml`
  已把 `skillDir` 声明成 `${package}/skills`，所以正常安装**装完即用**；只有当用户
  自己覆盖成空目录时才会降级为`（阶梯正文不可用，按最小可用改动执行。）`。
- **v0.1 零客户端 UI**（历史陈述，v0.2 已接）。v0.1 的 `src/client/` 只是骨架
  （构建仍产出 `lib/client.js`，但 `package.json` 不声明 `dsh.client`，产物也不注册槽位），
  所以装完在插件管理器里看不到任何 Ponytail 入口。v0.2 起声明 `dsh.client` 并把面板挂到
  设置页的 `settings.section`，见本文件 Unreleased 一节。
  面板里做的三件事：切四档、清除用户层覆盖、看三层诊断链；**没有技能开关**——
  宿主 `dsh-skill` 的 Config 没有 `enabled` 字段，技能级开关在宿主侧不存在，
  面板只标注「这条技能属于哪个 provider、是否被 disable」，不做假开关。

### 从 `@wenaixi/dsh-ponytail` 迁移

见 [docs/migration-from-wenaixi.md](docs/migration-from-wenaixi.md)。
