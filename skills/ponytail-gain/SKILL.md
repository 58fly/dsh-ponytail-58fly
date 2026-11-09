---
name: ponytail-gain
description: >
  Explain ponytail's upstream benchmark, and point at the real local counters
  (managed turns, injections, switches) the /ponytail-gain command prints.
  One-shot display. Use for /ponytail-gain, "what does ponytail save",
  "ponytail impact", "efficiency stats".
  触发词：ponytail gain / 省了多少 / what does ponytail save / ponytail impact /
  测量收益 / 省钱了吗 / 效率统计 / 生效了吗。
---

# Ponytail Gain

被调用时展示这块记分牌。一次性：不要改档位、不写标记文件、不持久化任何东西。

## 先看本机真实数字

要回答「这个插件到底生效了没有、管了多少轮」，**读 `/ponytail-gain` 命令的输出**，不要用下面这张表回答。命令打的是本机运行期计数：受管轮次、注入次数与注入率、按档位分布、切档次数、命令调用次数、注入字节，以及带区间的基准推算。设置页 → Ponytail → 效率 里有同一份数据的图形版。

下面的数字来自 Ponytail 5 公开的 agentic 基准：headless Claude Code（Opus 5.5，默认强度）跑 39 个任务（真实 FastAPI + React 仓库里的功能票、bug 修复、安全与隐私用例、小应用），每个任务 5 次，对照同一个 agent 不带技能。其中 18 个任务带正确性与安全性的隐藏检查。每个数字是逐任务中位数的几何平均。它们是测出来的，不是从当前仓库算出来的。来源：`benchmarks/results/2026-10-07-agentic.md` 与 README。

## 记分牌

用纯 ASCII 画条。条长表示 ponytail 占无技能基线的比例；标签上写确切数字：

```
  ponytail 收益          基准 · 39 任务 × 5 次 · Opus 5.5

  无技能          ████████████████████  100%
  代码行数        █████████···········   47%   ▼ 53%
  输出 token      ███████████·········   55%   ▼ 45%
  成本            ███████████████·····   74%   ▼ 26%
  时间            ████████████········   59%   ▼ 41%
  隐藏检查通过           97%  （无技能 96%）
  该有测试的用例有测试   98%  （无技能 68%）

  本机真实计数：/ponytail-gain 命令（或设置页 → Ponytail → 效率）
  本仓库欠账：/ponytail-debt （你拖下的捷径）
              /ponytail-audit（还有哪些能砍）
```

## 诚实边界

**这张表是上游基准，不是本仓库的数字。** 它测的是 Claude Code + Opus 5.5 上的 39 个任务，口量与 DSH 不同，只能当「同类任务上的相对变化」看。

这些是基准平均值，不是本仓库的数字。**永远不要**打印某个仓库的省钱数字（"你在这里省了 X 行/token"）：没被写出来的那版从未存在，现场仓库里没有可相减的真实基线。仓库级的真实数字只来自 `/ponytail-debt`（一本数出来的账），这块牌子指向它，而不是编一个。

## 边界

一次性展示。不改任何文件，不改档位。
