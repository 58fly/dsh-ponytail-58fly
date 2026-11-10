---
name: ponytail-help
description: >
  Quick reference for ponytail levels, skills and commands. One-shot display.
  Use for /ponytail-help, "ponytail help", "how do I use ponytail".
  触发词：ponytail help / ponytail 怎么用 / how do I use ponytail /
  懒人模式怎么开 / 档位说明。
---

# Ponytail Help

被调用时展示这张速查卡。一次性，不要改档位、不写标记文件、不持久化任何东西。

## 档位

| 档位 | 触发 | 改变什么 |
|-------|---------|-------------|
| **off** | `/ponytail off` | 不在会话开始时自动生效，需要时手写 `/ponytail` 打开。 |
| **lite** | `/ponytail lite` | 按要求做，用一行说明更小的那个选项。 |
| **full** | `/ponytail` | 最小的完整改动、逻辑需要时的一条检查、以及说明跳过了什么与风险的回复。默认。 |
| **ultra** | `/ponytail ultra` | 还要质疑需求，动手前先反驳。 |

档位一直保持，直到被改掉或会话结束。

## 技能

| 技能 | 触发 | 做什么 |
|-------|---------|--------------|
| **ponytail** | `/ponytail` | 懒人模式本体：最少新代码，回复里说清跳过了什么、有什么风险。 |
| **ponytail-review** | `/ponytail-review` | 评审一次 diff：bug、安全、负载、缺测试、速度、能砍什么。每条发现都说清会怎样坏、怎么修。 |
| **ponytail-audit** | `/ponytail-audit` | 同样的质量审计，范围是整个仓库，按重要性排序。 |
| **ponytail-debt** | `/ponytail-debt` | 把 `shortcut:` 注释收成一本可跟踪的账。 |
| **ponytail-gain** | `/ponytail-gain` | 本机运行期统计：受管轮次、注入次数与注入率、切档次数，附上游基准推算区间。 |
| **ponytail-help** | `/ponytail-help` | 就是这张卡。 |

其他宿主（Codex CLI、IDE 扩展）用它们自己的调用形式；其它工具用自家的更新流程。

## 关闭

说 "stop ponytail" 或 "normal mode"。想再开就 `/ponytail`。`/ponytail off` 也行。

## 默认档位

默认档位 = `full`，每个会话自动生效。改成别的：设置面板里的"默认档位"，或改配置文件。

优先级链：环境变量 > 配置文件 > `full`。设为 `off` 就不在会话开始时自动生效，需要时手写 `/ponytail` 打开。

## 更多

完整文档与示例：https://github.com/DietrichGebert/ponytail
