# 从 `@wenaixi/dsh-ponytail` 迁移到 `dsh-ponytail-58fly`

这份文档写给已经在用 `@wenaixi/dsh-ponytail`（截至写作时最新 **5.6.2**）的人：
换包之后要改哪几行、哪些行为会变、哪些配置会失效。

## 一句话总结

**包名、PLUGIN_ID、技能目录、配置字段名都变了，没有兼容别名。**
换包是一次明确的替换：先卸旧的，再装新的。技能目录新包自己声明（`${package}/skills`），
只有你把 `skillDir` 覆盖成别的地方时才需要额外一步。

## 变了什么

| 项 | `@wenaixi/dsh-ponytail` 5.6.2 | `dsh-ponytail-58fly` 0.2.2 |
| --- | --- | --- |
| 包名 | `@wenaixi/dsh-ponytail` | `dsh-ponytail-58fly` |
| 插件 id（配置图里的 `id`、设置命名空间） | `ponytail` | `ponytail-58fly` |
| 主入口 | `lib/ponytail.js` | `lib/plugin.js` |
| 配置目录 | `$DSH_HOME/<旧 id>` | `$DSH_HOME/ponytail-58fly` |
| 运行时依赖 | `yaml ^2.4.2` | **零**（YAML 只出现在构建期的脚手架脚本里） |
| `peerDependencies` | cordis ^4.0.4、schemastery ^3.18.4、`dsh-skill`、`dsh-typert-protocol`、`react` | 只有 `@deepseek-ai/cordis ~4.1.0`、`@deepseek-ai/schemastery ~3.19.0` |
| `engines.dsh` | `>=0.2.0-rc.1 <=0.2.1` | `>=0.2.0-rc.1 <0.2.3-0` |
| 客户端 UI | 有（`dsh.client.platform: web`，注入三个 client 包；面板挂在插件详情页的 `plugins.bundle.config`） | 有（`dsh.client.platform: web`，注入 `ui-settings` 与 `ui-renderer` 两个包；面板挂在**设置页**的 `settings.section`）。v0.1 曾是零界面，v0.2 起接上 |

## 迁移步骤

```bash
# 1) 卸掉旧包（profile 名按你自己的填，下面是 web）
dsh plugin --profile web remove @wenaixi/dsh-ponytail

# 2) 装新包（也可以直接按包名装：dsh plugin --profile web add dsh-ponytail-58fly）
dsh plugin --profile web add /path/to/dsh-ponytail-58fly-0.2.2.tgz

# 3) 旧的 insert 行要删掉（否则旧 id 还会被插进配置图）
```

旧的 insert 行（`id: ponytail` + `@wenaixi/dsh-ponytail`）必须从 profile 的
`cordis.patch.yml` 里删掉；新包的 insert 行由它自己的 bundle patch 提供，不需要你写。

> **`skillDir` 不用你配。** 发布物的 `cordis.patch.yml` 已声明
> `skillDir: "${package}/skills"`，`${package}` 由插件在运行时解析成这份安装自己的
> `skills/` 目录。旧包是「缺省回落包内技能」，新包是「显式声明包内技能」，效果一样，
> 区别在于新包的声明写在发布物里，装完就成立。
>
> 想把技能目录挪到别处（比如你自己的技能集）时，再在自己的 patch 里覆盖：
>
> ```yaml
> - patch:
>     - id: ponytail-58fly
>       config:
>         skillDir: "/abs/path/to/my-skills"
> ```
>
> 覆盖成空目录不会崩：技能面 0 个，阶梯正文降级成
> `（阶梯正文不可用，按最小可用改动执行。）`。

## 会失效的东西

- **旧的设置值**。旧包存在 `$DSH_HOME/<旧 id>/` 下的配置，新包读的是
  `$DSH_HOME/ponytail-58fly/` 与宿主 `ctx.settings` 的 `ponytail-58fly` 命名空间。
  旧值不会自动迁移，切档需要重设一次（或直接用 `PONYTAIL_DEFAULT_MODE` 环境变量）。
- **旧的面板位置**。两个包都带客户端 UI，但入口不在同一个地方：旧包挂在插件详情页
  （`plugins.bundle.config`，按包名 keyed 的卡片，要先进插件管理器、再点开 Ponytail 那一项）；
  新包挂在设置页（`settings.section`，左侧导航多一栏 Ponytail）。
  换包后不要再去插件管理器里找——那里不会有了。
  面板缺席（宿主没装 `dsh-client-ui-settings` / `-settings-general`）时属预期降级：
  `/ponytail <档位>`、配置文件、环境变量都能完成同样的操作。
- **旧包声明的 peer 不会被新包补**。旧包要求 `dsh-skill` / `dsh-typert-protocol` / `react`
  作为 peer；新包只声明 cordis 与 schemastery。如果你之前为了满足旧 peer 手装过这些包，
  它们留着无害，但不再是新包的要求。

## 行为差异（会改变你看到的东西）

| 行为 | 旧包 | 新包 |
| --- | --- | --- |
| 上游技能漂移 | 自行同步 | `skills/UPSTREAM.json` 冻结 v5.3.3，CI 每日比对，**只报警不同步** |
| 依赖宿主私有包 | 直接 import `dsh-skill` 等 | 运行时只值导入 `@deepseek-ai/cordis` 与 `@deepseek-ai/schemastery`；`verify` 会拦住任何越界 |
| 写盘 | 有 | **零**：源码里出现任何写盘 API 即红，状态全交 `ctx.settings` |
| `skillDir` | 缺省回落包内技能 | 发布物自带 `${package}/skills`（`PACKAGE_ROOT_TOKEN` 在运行时解析成包自身），装完即用 |

## 怎么确认换好了

```bash
# 装配树里出现新 id，且没有旧 id
dsh --profile web --dump-config | grep -E 'ponytail(-58fly)?'

# 真装配：六个技能 + 切档 + 零残渣（在仓库里跑）
node scripts/check-install.mjs --mode assemble --tarball ./dsh-ponytail-58fly-0.2.2.tgz
```

第二条命令应当打印 `技能面：ponytail, ponytail-audit, ponytail-debt, ponytail-gain, ponytail-help, ponytail-review`，
并给出四档提示词体量（`off` 为 0，其余三档递增）。
