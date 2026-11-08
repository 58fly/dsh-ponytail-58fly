<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-IDEMPOTENCY-KEY: deck-a5467d57-5980366 -->
<!-- DSH-CREATED: 2026-11-08T03:53:01.131Z -->
<!-- DSH-BLOCKED-BY: 04, 05 -->
# 06: 0.3.0 版本落地与发布准备：版本号 / CHANGELOG / 运行手册

**What to build:** 

**Blocked by:** #04, #05

**Status:** ready-for-agent

- [ ] `package.json#version` 为 `0.3.0`。
- [ ] `CHANGELOG.md` 顶部第一个小节是 `## [0.3.0]`，且不含旧项目名。
- [ ] `docs/releases/0.3.0/` 存在，含发版步骤与回滚说明。
- [ ] `pnpm run typecheck` / `verify` / `check:skills` / `check:matrix` / `check:readme` 全绿。
- [ ] `pnpm pack` 产出的 tarball 里不含 `assets/`、`docs/`、`src/`、`test/`、`.scratch/`。
- [ ] `git status` 显示改动但**没有新 commit**（证明守住了不发版边界）。

## 要交付什么

0.3.0 在**本地**达到可发布状态：版本号落地、CHANGELOG 顶部有本版小节、运行手册补齐、`prepublishOnly` 全链绿。

**本票不 commit、不打 tag、不 push、不触发发布**（仓库既有纪律：Git 先行 npm 后发；打 tag 这一步由人执行）。本票的终点是「一条命令就能发」的状态。

## 要做的五件事

### 1. 版本号

- `package.json#version`：`0.2.2` → `0.3.0`。
- 若 `scripts/set-dsh-version.mjs` 之类脚本会回写版本，一并确认没有把 `0.2.2` 钉在别处（如 `lib/` 里的常量、`cordis.patch.yml` 里的引用）。

### 2. CHANGELOG

顶部加 `## [0.3.0] - <发版日>`，小节里写三类内容：

- 宿主区间从 `<0.2.3-0` 打开到 `<0.3.0-0`，0.2 线未来 patch/minor 不再被 `incompatible-version` 挡住。
- README 全量重排为中英双语，结构与排版按门禁约束重写。
- 品牌叙事统一：README 与包元数据按原创插件口径重写，删除历史来源叙事，许可证归属不变。

措辞按规格 Q13，**不指名旧项目**。

### 3. 运行手册

`docs/releases/0.3.0/` 目录按既有 `0.2.0` / `0.2.1` / `0.2.2` 形态建，至少含发版步骤与回滚方式。同时确认 `docs/发布清单.md` 与本版步骤一致（这张清单本身就是发布门的一项）。

### 4. 跑通全链

按顺序跑，任何一步红就停下修：

```bash
# 1) 类型与基础校验
pnpm run typecheck
# 2) 七道门
pnpm run verify
# 3) 技能与矩阵
pnpm run check:skills
pnpm run check:matrix
# 4) README 门禁
pnpm run check:readme
# 5) 打包产物检查
pnpm pack && node scripts/provenance.mjs || true
```

### 5. 把「可发」状态写进票里

在票的进度区记录：最终版本号、七个检查项的通过情况、以及需要人接着做的两条（commit + tag + push）。

## 不做

- 不 `git commit`、不 `git tag`、不 `git push`。
- 不跑 `npm publish`。
- 不改运行时代码、不改技能正文。
- 不写「发布后复验」的结论（那是下一张票）。

## 验收


## 进度
