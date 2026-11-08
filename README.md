<h1 align="center">🦥 dsh-ponytail</h1>

<div align="center">

**🌐 [中文](README.md) · [English](docs/README.en.md)**

少写代码，先找现成方案。

*The smallest change that fully solves the task.*

[![版本](https://img.shields.io/npm/v/dsh-ponytail-58fly?label=%E7%89%88%E6%9C%AC)](https://www.npmjs.com/package/dsh-ponytail-58fly)
[![宿主](https://img.shields.io/badge/%E5%AE%BF%E4%B8%BB-DSH%200.2.x-4B8BBE)](https://github.com/deepseek-ai)
[![技能](https://img.shields.io/badge/%E6%8A%80%E8%83%BD-6%20%E4%B8%AA-orange)]()
[![依赖](https://img.shields.io/badge/%E8%BF%90%E8%A1%8C%E6%97%B6%E4%BE%9D%E8%B5%96-0-brightgreen)]()
[![许可](https://img.shields.io/badge/%E8%AE%B8%E5%8F%AF-MIT-green)](LICENSE)

</div>

<h2 align="center"><sub>INSTALL</sub><br>两步上手</h2>

```bash
# ① 把插件装进你的 profile（--profile 必填，官方模板：web / headless / acp / sdk）
dsh plugin --profile web add dsh-ponytail-58fly

# ② 重启 DSH 生效
```

装完在会话里敲 `/ponytail` 看当前档位。设置页 →「Ponytail 档位」可切换。

离线或内网从 tarball 装：

```bash
pnpm run build && npm pack
dsh plugin --profile web add ./dsh-ponytail-58fly-0.3.0.tgz
```

桌面版（Electron 独占的 profile，`dsh plugin` 会拒绝写入）：

```bash
cd ~/.dsh/profiles/desktop && pnpm add /path/to/dsh-ponytail-58fly-0.3.0.tgz
```

<h2 align="center"><sub>CORE</sub><br>它做了什么</h2>

在系统提示里挂一段决策阶梯，让模型动手写代码前先过六道问：

| # | 先问 | 命中就用 |
| --- | --- | --- |
| 1 | 这东西需要存在吗？ | 不需要就跳过，一行说明省了什么 |
| 2 | 仓库里已经有了？ | 照周围的用法用它 |
| 3 | 标准库或平台原生特性？ | 用原生，除非项目自己有约定 |
| 4 | 已装的依赖里有？ | 用，绝不新增依赖 |
| 5 | 能写成一眼看懂的一行？ | 一行 |
| 6 | 都不行 | 能跑通的最少那份代码 |

档位只决定**强度**，不改变阶梯本身：

| 档位 | 行为 |
| --- | --- |
| `off` | 完全关闭，本会话恢复普通开发模式 |
| `lite` | 按要求做，另附一行「更小的选项」让用户自己挑 |
| `full` | 默认。完整阶梯 |
| `ultra` | 额外质疑需求本身：动手前先反驳需求不成立的部分。适合需求还没定形的时候，代价是更慢、更啰嗦、可能推翻你已经想好的方案 |

阶梯进 system prompt 的固定段，只在会话诞生时渲染一次；切档走尾部 `system-reminder` 注入完整指令。切档不会让整个提示词前缀失效，KV cache 不报废。

<h2 align="center"><sub>SKILLS</sub><br>六个技能</h2>

| 命令 | 用途 |
| --- | --- |
| `/ponytail` | 查看或切换档位（`lite` / `full` / `ultra` / `off`） |
| `/ponytail-review` | 按六阶审查一个改动：逻辑、安全、负载、测试、性能、有没有多余的代码 |
| `/ponytail-audit` | 全仓审计：bug、安全洞、慢路径、该删该合的分支 |
| `/ponytail-debt` | 盘点欠下的技术债（仓库里所有 `shortcut:` 注释） |
| `/ponytail-gain` | 量化这次偷懒省下了多少 |
| `/ponytail-help` | 用法速查 |

模型也会自动调用：六份描述都是中文重写 + 原样保留英文触发词（`be lazy` / `simplest solution` / `yagni` / `debt`），中英文提问都能命中。

斜杠命令后面必须跟一个半角空格：

```text
/ponytail 这个功能要加缓存吗
/ponytail-review 看看这个 diff
```

宿主的斜杠手势正则只认 ASCII 空白边界。写成 `/ponytail，xxx`（跟全角逗号）或 `／ponytail`（全角斜杠）不会触发，命令会被当成普通文字。

<h2 align="center"><sub>CONFIG</sub><br>配置</h2>

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `defaultMode` | `enum` | 默认档位：`off` / `lite` / `full` / `ultra`，缺省 `full` |
| `skillDir` | `string` | 技能目录。相对路径按 `$DSH_HOME` 解析，缺省 `$DSH_HOME/ponytail-58fly/skills` |
| `locale` | `enum` | 语言：`zh` / `en`。Schemastery 已声明，当前无消费点 |

三者都**不给默认值**：Cordis 校验会把缺省 fill 成显式配置，一旦给了默认值，「配过」与「没配过」就不可区分，设置面板会替用户撒谎。

改档位有三条等价路径，优先级 `环境变量 > profile 补丁 > 内置兜底`：

```bash
# 环境变量：影响所有新会话的默认档位
export PONYTAIL_DEFAULT_MODE=ultra
```

```yaml
# profile 的 cordis.patch.yml
- patch:
    - id: ponytail-58fly
      config:
        defaultMode: ultra
```

```text
# 会话内即时切换（不是 shell 命令，敲在对话框里）
/ponytail ultra
```

改错了没生效：设置页的面板逐层显示哪一层盖住了它，以及那一层现在写的是什么。

<h2 align="center"><sub>COMPAT</sub><br>兼容性</h2>

| 项 | 要求 |
| --- | --- |
| Node | `>=20` |
| DSH | `>=0.2.0-rc.1 <0.3.0-0`。`engines.dsh` 是唯一的版本闸门：宿主看到它会直接跳过 peer 检查，装错宿主版本就是装不上，不会降级运行 |
| Peers | `@deepseek-ai/cordis ~4.1.0`、`@deepseek-ai/schemastery ~3.19.0`，由宿主提供，本包不安装也不打包 |
| Deps | **零**。不是洁癖：`dsh plugin add <本地目录>` 生成的是 `link:`，pnpm 不会安装插件的 `dependencies`，任何运行时 `import` 都会 `ERR_MODULE_NOT_FOUND`。所以六份技能都靠宿主自己的注册表读包内 `skills/`，本包不 `import` 任何东西 |
| Inject | 两个 `@deepseek-ai/dsh-client-ui-*` 模块，宿主没装就降级为「没有设置面板」，命令与配置照常可用 |

<h2 align="center"><sub>TROUBLESHOOT</sub><br>排障</h2>

| 现象 | 成因 | 处置 |
| --- | --- | --- |
| 装完没有设置面板 | 宿主缺 `dsh-client-ui-settings-general`（槽位声明）或 `dsh-client-ui-settings`（`configForms` 通道） | 预期降级，非故障。命令、配置、环境变量都能完成全部操作 |
| `dsh.client.inject` 写了短名没生效 | 宿主按包名查模块图，短名被静默跳过 | 写全名 `@deepseek-ai/dsh-client-*` |
| 面板显示「宿主未服务该配置命名空间」 | `configForms` 起来了但没为本命名空间服务表单，通常是插件不是经 profile 配置图装载 | 改 `cordis.patch.yml` 或用环境变量 |
| 技能列表是空的 | ① `skillDir` 被覆盖成了空目录 ② 某个 `SKILL.md` 少了 `description` ③ frontmatter 写了旧键 | ① 改回 `${package}/skills` ②③ 日志搜「frontmatter 非法」，只会跳过那一条 |
| 斜杠命令敲了没反应 | 斜杠后少了半角空格，或用了全角「／」 | 见上面「六个技能」 |
| 装时提示 `Agent skills awaiting approval` | pnpm 把依赖自带的 `skills/` 链进编码 agent 的技能目录，等批准 | 批不批准都不影响本插件：六个技能由 DSH 自己的注册表读包内 `skills/` |

<h2 align="center"><sub>SOURCE</sub><br>来源与许可</h2>

本插件是全新开发的原创项目：代码与六个中文技能正文均为本仓原创。规则思想参考 [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail)（MIT），设计取舍与宿主契约实测证据见 [docs/research/dsh-plugin-contract-0.2.2.md](docs/research/dsh-plugin-contract-0.2.2.md)。

MIT，见 [LICENSE](LICENSE)。
