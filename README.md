# dsh-ponytail-58fly

DSH（DeepSeek Harness）插件：懒人模式（ponytail）。给会话注入一条「少写代码、先找现成方案」的决策阶梯，并按 `off / lite / full / ultra` 四档调节强度。

本项目是 [Wenaixi/dsh-ponytail](https://github.com/Wenaixi/dsh-ponytail) 的接管重写版。上游已停止维护，且其 `src/` 是 9 个平铺文件、2709 行、72 处 `as` 断言、lib/ 提交进 Git 的形态。本仓库按「宿主契约先行、零断言、零运行时依赖」重写，取舍与证据见 `docs/research/` 与 `.scratch/ponytail-takeover/map.md`。

## 用途

在系统提示里挂一段围栏正文（ladder），让模型在动手写代码前先回答四个问题：

1. 标准库能做吗？
2. 原生平台特性覆盖了吗？
3. 已装的依赖里有吗？
4. 真没有，再写最少的那一份。

六个技能（`ponytail` / `ponytail-review` / `ponytail-audit` / `ponytail-debt` / `ponytail-gain` / `ponytail-help`）通过 `skills` 服务暴露给模型，技能正文来自上游冻结的 `DietrichGebert/ponytail` v5.3.3（`skills/` 树 `269bc3e0`）。

## 依赖

- Node `>=20`
- DSH `>=0.2.0-rc.1 <0.2.3-0`（`engines.dsh` 是唯一的版本闸门：宿主读 `engines.dsh` 命中后直接 return，不再校验 `peerDependencies`）
- 宿主提供的两个 peer：`@deepseek-ai/cordis ~4.1.0`、`@deepseek-ai/schemastery ~3.19.0`

**运行时依赖：零。** 这点不是洁癖：`dsh plugin add <本地目录>` 生成的是 `link:`，pnpm 不会安装插件的 `dependencies`，任何运行时 `import` 都会 `ERR_MODULE_NOT_FOUND`。`scripts/verify.mjs` 会把非空的 `dependencies` 判成红灯。

## 部署

### 按包名装（推荐）

版本号可追溯，插件页的更新提示会显示 `0.2.0` 这样的版本号而不是 commit SHA：

```bash
npm install dsh-ponytail-58fly
```

装完把 `dsh-ponytail-58fly` 加进 profile `package.json` 的 `dsh.profile.bundles`，重启 DSH。
宿主侧的插件管理面板里也可以直接按包名安装。

### 离线 / 内网：从 tarball 装

```bash
pnpm run build
npm pack
dsh plugin add ./dsh-ponytail-58fly-0.2.0.tgz
```

**这条路的已知边界**：tarball 手工安装不会替你把对等依赖补装进来。
宿主自己提供了 `@deepseek-ai/cordis` 与 `@deepseek-ai/schemastery` 这两个 peer，
所以在真宿主里装能起来；但如果你把 tarball 装进一个裸目录再手工起 Cordis，
得先自己备好这两个包，否则报 `ERR_MODULE_NOT_FOUND`。
本插件运行时依赖为零，除此之外没有别的要补。

### 从本地目录装（开发时）

```bash
dsh plugin add /path/to/dsh-ponytail-58fly
```

生成的是 `link:`，pnpm 不会安装插件的 `dependencies`——所以「零运行时依赖」不只是洁癖，
是这条路径唯一能成立的前提。三种形态（包名 / tarball / link）都在 CI 里各跑一遍。

### 装完即用：skillDir 由包自己声明

`skillDir` 缺省是 `$DSH_HOME/ponytail-58fly/skills` —— 那是个**给用户放自定义技能**的目录，
安装包不会往里写（插件零写盘，这是承诺）。所以发布物自带一行声明，把技能目录钉在包自身：

```yaml
- insert:
    - id: ponytail-58fly
      name: "dsh-ponytail-58fly"
      config:
        skillDir: "${package}/skills"
```

`${package}` 是本包自己的标记（`src/l0/paths.ts` 的 `PACKAGE_ROOT_TOKEN`），运行时由插件
解析成**这份安装自己**的 `skills/` 目录，link 形态与 tarball 形态都成立。为什么不写裸相对路径：
裸相对路径按 `$DSH_HOME` 解析，会落到 `$DSH_HOME/node_modules/…` 这个并不存在的位置；
为什么不写绝对路径：发布物里写死的绝对路径只对某台机器某种布局成立。

要换技能目录时，在自己的 profile 的 `cordis.patch.yml` 里覆盖这个值即可（用户层优先级高于 bundle 层）：

```yaml
- patch:
    - id: ponytail-58fly
      config:
        skillDir: "/abs/path/to/my-skills"
```

把 `skillDir` 显式配成空目录也不会崩：技能面 0 个，提示词段降级成
`（阶梯正文不可用，按最小可用改动执行。）`，档位声明照常出现。
这条降级路径与"patch 里必须带 `${package}` 标记"两件事，都由
`scripts/check-install.mjs --mode assemble` 与 `scripts/verify.mjs` 断言（后者带反向用例）。

`package.json` 里的 `dsh.bundle.patch` 指向 `cordis.patch.yml`，宿主靠它把插件插进 profile 的配置图：

```yaml
- insert:
    - id: ponytail-58fly
      name: "dsh-ponytail-58fly"
```

## 配置

配置走 `schemastery`，字段全部**不给默认值**：Cordis 校验会把缺省 fill 成显式配置，一旦给了默认值，「配过」与「没配过」就不可区分，设置面板会替用户撒谎。取值一律过 L0 的 `coerceMode(unknown)`。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `defaultMode` | `'off' \| 'lite' \| 'full' \| 'ultra'` | 默认档位。缺省时由 L0 的 `DEFAULT_MODE`（`full`）兜底 |
| `skillDir` | `string` | 技能目录。相对路径按 `$DSH_HOME` 解析；缺省为 `$DSH_HOME/ponytail-58fly/skills` |
| `locale` | `'zh' \| 'en'` | 提示与技能描述语言 |

有效值的优先级链（`env` > `patch` > `fallback`）与三档诊断报告由 #04 实现。

## 启动

插件由宿主按 profile 装载，没有独立进程：

```bash
pnpm run typecheck   # tsc --noEmit，含客户端 .tsx
pnpm run build       # tsc -p tsconfig.build.json && node scripts/build-client.mjs
pnpm run verify      # 产物纯度 / 分层方向 / 零断言 / files 白名单 / 清单卡口 / 零写盘
pnpm run check:skills # 技能描述长度、调用策略、斜杠写法、上游漂移
pnpm run check:matrix # compat 矩阵是否覆盖 engines.dsh 区间内每个已发布版本
pnpm test            # node --test test/*.test.mjs（含真 Cordis 组合测试）
```

`prepublishOnly` 串起以上全部，任何一步红灯都不允许发布。

### 三道发布卡口

| 卡口 | 脚本 | 抓住什么 |
| --- | --- | --- |
| 安装形态 | `scripts/check-install.mjs --mode tarball\|link` | 包能不能装进一个像 profile 的目录 |
| 真装配 | `scripts/check-install.mjs --mode assemble` | 装进去后宿主能不能载入、六个技能在不在、切档是否生效、`$DSH_HOME` 有没有残渣 |
| 产物纯度 | `scripts/verify.mjs` | 运行时只导入宿主公开面（不含子路径）、无 `new Function`/`eval`、声明与磁盘一致、源码零写盘 |

三条都自带反向用例（`--selftest`）：把断言喂给人为构造的脏输入，证明它会红。
一个没法演示失败用例的卡口不是卡口，只是注释。

另有一道**发布面**卡口在 CI 的 `pack` job 里，扫的是 `npm pack` 出来的那份字节而不是仓库源文件：
tgz 里有 `new Function`/`eval(`、`cordis.patch.yml` 的 `insert` 块里找不到包名或插件 id、
`CHANGELOG.md` 顶部版本与 `package.json` 不符、迁移文档缺失——任一命中即红。
防的是"源码是干净的、构建产物里被塞进了别的写法"这一类只在发布物里存在的问题。

## 仓库结构

```
src/
  l0/          纯函数与常量：coerceMode、DSH_HOME 解析、路径常量。零 I/O、零 node:
  prompt/      系统提示段（SECTION_ORDER 50）与渲染器
  state/       会话级内存状态（Map + agent/disposed 清理，不落盘）
  config/      schemastery Schema 与有效值解析（#04）
  skills/      skill provider 与 frontmatter 解析
  client/      浏览器侧 .tsx，由 esbuild 打成 ModuleLoader 外壳
  plugin.ts    唯一装配入口
```

依赖方向单向：`plugin.ts → {prompt,state,config,skills} → l0`。反方向会被 `verify` 判成红灯。

## 技能

六个技能（`ponytail` / `ponytail-review` / `ponytail-audit` / `ponytail-debt` / `ponytail-gain` / `ponytail-help`）由本插件的 `skills` provider 注册进宿主目录，正文在包的 `skills/` 下。

### 怎么触发

- **模型自动调用**：靠描述命中。六份描述都是中文重写 + **原样保留英文触发词**（`be lazy` / `simplest solution` / `yagni` / `debt` 等），中英文提问都能命中。
- **手动调用**：写斜杠命令。**斜杠命令后面必须跟一个半角空格**：

  ```text
  /ponytail 这个功能要加缓存吗
  /ponytail-review 看看这个 diff
  /ponytail-audit
  ```

  宿主的斜杠手势正则（`dsh-tool-skill/lib/index.js:1108`）是 `(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)`，只认 ASCII 空白边界。写成 `/ponytail，xxx`（紧跟全角逗号）或 `／ponytail`（全角斜杠）**不会触发**，命令会被当成普通文字。`pnpm run check:skills` 会拦下这种写法。

### 六个技能

| 命令 | 用途 |
| --- | --- |
| `/ponytail` | 本体：六阶梯子（要不要存在 → 已有代码 → 标准库/平台 → 已装依赖 → 一行 → 最小实现） |
| `/ponytail-review` | 按六阶审查一个改动 |
| `/ponytail-audit` | 扫已有代码里的过度设计 |
| `/ponytail-debt` | 盘点主动欠下的技术债（`shortcut:` 注释） |
| `/ponytail-gain` | 量化这次偷懒省下了多少 |
| `/ponytail-help` | 用法速查 |

六份 frontmatter 都没有 `disable-model-invocation` 键：默认值就是模型可调用 + 用户可调用（`{ modelInvocable: true, userInvocable: true }`）。**不要**为了"安静一点"去设 `disable-model-invocation: true`——宿主会把该技能从模型目录里滤掉，六个全关时整段技能目录直接消失。

### 与上游的关系

真源钉在 `DietrichGebert/ponytail`：`skills/UPSTREAM.json` 记着 tag（`7801d06`）、`skills/` 子树对象 sha（`269bc3e0`）与冻结日期。我们**不自动同步**：正文是中文重写，自动 sync 会覆盖掉翻译。`pnpm run check:skills` 每个工作日在 CI 里问一次"上游那棵树还是不是冻结的那个"，变了就报警，由人 review 差异后手动跟进。

### 本地校验

```bash
pnpm run check:skills
```

四类断言，都在 `prepublishOnly` 里跑：

1. `skills/` 下正好是六个目录（多一个会被暴露，少一个是功能缺失）；
2. 每条描述折叠后 ≤ 480 字符（宿主上限 500，超了会 `slice` + `...` 把尾部触发词截掉）、必须含中文、必须含技能名；
3. 六个 frontmatter 都不含 `disable-model-invocation: true` / `user-invocable: false`，也不含旧键 `disableModelInvocation` / `modelInvocable` / `userInvocable`；
4. 正文里的斜杠写法只用六个技能名，且必须跟半角空格。

描述长度按**折叠后**算：`description: >` 在源码里是好几行，宿主先 `replaceAll(/\s+/g, ' ').trim()` 再数 UTF-16 `.length`。看着短不等于真的短。

## 常见问题

**装完没有设置面板？**
面板挂在**设置页**的 `settings.section` 槽位（不是插件详情页的 `plugins.bundle.config`——那是按包名 keyed 的卡片，位置在插件管理器里）。客户端 `apply` 用的是 `ctx.slots.inject('settings.section', ...)`：槽位没被声明时注册不执行，属**预期降级**，不是故障。两种常见成因：

1. 宿主没装 `@deepseek-ai/dsh-client-ui-settings-general`（声明该槽位的那个包）；
2. 宿主没装 `@deepseek-ai/dsh-client-ui-settings`（提供 `configForms` 数据通道）——此时 `ctx.inject(['configForms'], …)` 的子 fiber 起不来，面板整块缺席。

两种情况下宿主侧功能零损失：`/ponytail <档位>` 命令、配置文件、环境变量都能完成全部操作。

**`dsh.client.inject` 写了短名没生效？**
必须写 `@deepseek-ai/dsh-client-*` 全名。宿主按包名查模块图，短名会被**静默跳过**，不报错也无日志。

**面板出现了，但显示「宿主未服务该配置命名空间」？**
说明 `configForms` 起来了、但宿主没有为 `ponytail-58fly` 这个命名空间服务表单——通常是这个插件不是经 profile 配置图装载的（例如被别的包间接引用）。设置改 `cordis.patch.yml` 或用环境变量，面板会跟着下一次快照刷新。

**v0.1 装完什么都没有，是坏了吗？**
不是。v0.1 是纯宿主侧发布，`package.json` 不声明 `dsh.client`、`lib/client.js` 不注册槽位，客户端不会出现任何入口。v0.2 起声明了 `dsh.client` 并把面板挂到设置页的 `settings.section`。升级到 v0.2 才会看到那一页。

**技能列表是空的？**
三种可能，按顺序看：

1. `skillDir` 被覆盖成了空目录。发布物自己声明的值是 `${package}/skills`（包内那六个技能），正常安装不需要动它；如果你在 profile 的 patch 里覆盖过它、或把它配成了 `$DSH_HOME/ponytail-58fly/skills`（用户自定义目录，本包永远是空的），改回来即可。
2. 某个技能的 `SKILL.md` 少了 `description`。宿主 `dsh-skill` 的 `validateCandidate` 对 `description` 有硬校验：为空会让整个 `ctx.skills.list()` 抛错。本 provider 遇到空描述会 `warn` 并跳过那一条，其余技能照常出现。
3. 某个技能 frontmatter 非法（写了旧键 `modelInvocable`、或写了 `disable-model-invocation: yes`）。同样只跳过那一条，并 `warn` 出文件路径与原因——日志里搜"frontmatter 非法"就能定位。

**斜杠命令敲了没反应？**
看斜杠后面是不是少了空格、或者用了全角斜杠「／」。见上面"怎么触发"。

**为什么 `lib/` 不进 Git？**
安装时由 `prepublishOnly` 现构建。上游把 `lib/` 提交进 Git 是为了 GitHub 直装免构建，代价是产物与源码漂移无从审计。

## 许可

MIT，见 [LICENSE](LICENSE)。上游 `Wenaixi/dsh-ponytail` 同为 MIT；技能正文来自 `DietrichGebert/ponytail`（MIT）。
