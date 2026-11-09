<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: needs-triage -->
<!-- DSH-IDEMPOTENCY-KEY: deck-f08d2f2f-5980788 -->
<!-- DSH-CREATED: 2026-11-09T15:03:57.188Z -->
# 05: /ponytail 命令补报覆盖关系（需先查宿主是否暴露配置三段投影）

**What to build:** 

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

## 目的

规格 00 遗留待定项（原文写「另立票」）：`/ponytail` 空参数输出目前只有 `Ponytail 当前档位：<effective>`，报不出「被环境变量覆盖 / 被 Profile 补丁覆盖」。

## 为什么本次没做

诊断的三段投影（value / base / user）只在客户端 `configForms` 侧可得，宿主侧服务只给一个生效值。面板能说清「谁盖住了谁」，命令侧拿不到同样的数据，硬加就是猜。规格 00 把它记为「已知信息缺口」并明确出界。

## 要先查清

1. 宿主侧是否存在等价的三段投影来源（`ctx.settings`、runtime handle、命令上下文里任何能取到 base / user 的通道）。
2. 如果没有，能否让客户端把最近一次诊断结论回传给命令侧（会引入跨端状态，属于新契约）。
3. 两者都不成立，则这个需求不可实现，直接关票并写明取证。

## 验收

- 查清上面三条，结论写进票面。
- 可行：`/ponytail` 输出补一行覆盖关系，措辞与面板状态行一致（`被环境变量覆盖` / `被 Profile 补丁覆盖` / `无覆盖`）。
- 不可行：关票，把「宿主侧无等价投影」的取证写进票面，并回写规格 00 的 Further Notes 指向本票。

## 进度
