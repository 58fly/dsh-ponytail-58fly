<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-IDEMPOTENCY-KEY: deck-b459c358-5981197 -->
<!-- DSH-CREATED: 2026-11-11T01:08:09.454Z -->
<!-- DSH-BLOCKED-BY: 01, 02, 03 -->
# 04: 收口：文档回写、CHANGELOG、四格最终截图、遗留风险登记

**What to build:** 三张改造票落地后，把仓库里的说法对齐到新面板，并跑完全量关卡、产出可对照的最终截图。

**Blocked by:** #01, #02, #03

**Status:** closed

- [x] 两份设计文档的对应章节已改写成管道与四块图形的描述，旧的表格描述与五态图例段落不再出现
- [x] `docs/design/ponytail-visual-proposal.md` 文首标明已实现及落点
- [x] CHANGELOG 新增一条，写明呈现方式变更、数据口径未变
- [x] `docs/design/prototype-shots/` 下有四张 `final-*.png`，与原型四格一一对应，截图里没有残留的说明文字与表格
- [x] 遗留风险已登记，包含上述三项
- [x] `pnpm typecheck && pnpm build && pnpm verify && pnpm test` 全绿

要做四件事：

1. **文档回写**：`docs/design/ponytail-settings-ui.md` 里诊断卡那一节、`docs/design/ponytail-efficiency-ui.md` 里的相应章节，改成管道与四块图形的描述；旧的四列表格、「指标 / 数值 / 说明」表头、五态图例段落一律删掉，不留「原先是表格」这类历史说明。`docs/design/ponytail-visual-proposal.md` 作为讨论产物保留，在文首标一句「已实现，落点见本票与 01–03」。
2. **CHANGELOG**：记一条 0.4.0，说明改了呈现方式、数据口径未变、说明文字全部收进 `?`。
3. **截图**：用 `.scratch/ponytail-visual/harness/` 的真组件渲染脚本，或宿主页面的实际面板，产出四格截图（最常见 / 环境变量赢 / 值非法 / 420px 紧凑），存到 `docs/design/prototype-shots/`，文件名为 `final-*.png`，每张图能对上原型对应的那一格。
4. **遗留风险登记**：在文档末尾记下本次未验证或刻意未做的事——`?` 悬浮卡在窄面板里的实测宽度、320px 下的管道表现、`diagnose()` 判据缺陷留待另一张票。




## 进度

## 遗留风险登记

1. **`?` 悬浮卡在窄面板里的实测宽度没验证**：`HoverCard inline` 有自己的宽度上限，420px 下
   基准 `?` 那段长文是否被截断只在静态 harness 里看过，宿主真面板没点开过。升级时机：用户报「`?` 里文字被截」。
2. **320px 下的管道表现没测**：harness 最窄只跑到 420px；320px（窄侧栏）下 12px 管道槽 + 19px 值
   理论上不横滚（网格 `minmax(0,1fr)`），但没有截图证据。升级时机：有 320px 场景的截图需求时跑一次 harness。
3. **`diagnose()` 判据缺陷已另票修复**（票 05，`76a180b`），本批不再涉及；归因侧对同源取值另有哨兵钉着。
4. **`?` 内容的完整性靠测试正则钉**（`IN_HELP` / `HELP_ENTRIES` 清单），文案改动要同步改清单；
   清单漏改只会让测试报「入口不见了」，不会静默丢句子。

