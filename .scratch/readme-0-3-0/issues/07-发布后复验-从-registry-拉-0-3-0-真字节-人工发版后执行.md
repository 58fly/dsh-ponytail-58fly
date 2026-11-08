<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-IDEMPOTENCY-KEY: deck-caeeb950-5980366 -->
<!-- DSH-CREATED: 2026-11-08T03:53:10.132Z -->
<!-- DSH-BLOCKED-BY: 06 -->
# 07: 发布后复验：从 registry 拉 0.3.0 真字节（人工发版后执行）

**What to build:** 

**Blocked by:** #06

**Status:** ready-for-agent

- [ ] `npm view dsh-ponytail-58fly@0.3.0 version` 返回 `0.3.0`。
- [ ] `pnpm run verify:published` 全绿，输出真字节比对通过。
- [ ] npm 包页显示 provenance 徽章。
- [ ] `npm dist-tag ls dsh-ponytail-58fly` 里 `latest` 指向 `0.3.0`。
- [ ] `docs/releases/0.3.0/` 里记录了实际发布时间与复验结论。

## 要交付什么

0.3.0 真的发出去之后，从 registry 拉回来的**真字节**和本地打包出来的字节一致、provenance 硬门绿。这张票是整个计划的闭环验收，也是唯一必须由人在发布之后触发的环节。

**本票标注：人工发版后执行。** agent 跑到最后一步会被「tag 还没打」挡住，这是设计如此，不是阻塞。

## 前置（由人执行，不由 agent 做）

```bash
# 1) 提交并打 tag
git add -A && git commit -m "chore(release): 0.3.0"
git tag v0.3.0
# 2) 本地验一遍再推
pnpm run verify:release
# 3) 推 tag 触发 publish.yml（带 --provenance）
git push origin main --tags
```

推完等 GitHub Actions 的发布 workflow 绿。

## 要做的三件事

### 1. 真字节复验

```bash
# 从 registry 拉 0.3.0 并逐字节比对
pnpm run verify:published
```

预期：`judgeDigest(dist, packed)` 通过，`classifyMissing` 没有缺项，`classifyUnpackable` 无异常。

### 2. provenance 复核

确认 npm 包页出现 provenance 徽章、`dist.integrity` 与本地 tarball 的 sha512 一致。

### 3. 记录发布事实

在 `docs/releases/0.3.0/` 里补一段实际结果：发布时间、registry 上的 `dist-tags.latest` 是否已指到 0.3.0、provenance 状态、以及 `verify:published` 的输出摘要。

## 常见偏差与处理

| 现象 | 成因 | 处置 |
|---|---|---|
| `verify:published` 拉到的是 0.2.2 | registry 传播延迟或 tag 没推上去 | 等 1-2 分钟重试；确认 `git ls-remote --tags origin` 能看到 `v0.3.0` |
| digest 不一致 | 本地打了包又改了文件、或 `.npmignore`/`files` 在白名单上不一致 | 清掉本地 tarball，从 git 干净树重新 `npm pack` 再比 |
| 没有 provenance 徽章 | publish workflow 少了 `--provenance` 或缺少 `id-token: write` | 查 `publish.yml` 权限段，修完重发 patch 版本 |
| `latest` 标签没动 | 发了预发布版本或用了 `--tag` 别的值 | `npm dist-tag ls` 检查，必要时 `npm dist-tag add` 修回 |

## 不做

- 不由 agent 打 tag 或 push。
- 不改任何代码（发现问题走新票）。
- 不发 patch 版本兜底（需要人决定）。

## 验收

## Comments

### local — 2026-11-08T04:11:20.311Z
勘察结果：本票的复验对象是 registry 上的 `dsh-ponytail-58fly@0.3.0`，当前 registry 末版仍是 0.2.2，故本票暂不可执行。

发版由人执行（仓库纪律：Git 先行 npm 后发），三条命令：

```bash
git checkout main && git merge --no-ff feat/readme-0-3-0
git tag v0.3.0 && git push origin main && git push origin v0.3.0
# publish.yml 由 tag 触发，带 --provenance
```

发版完成后本票要做的（届时由我执行）：

1. `pnpm run verify:published` —— 从 registry 拉 0.3.0 真字节，与本地 `npm pack` 产物逐文件比对 digest。
2. 核对 npm 页面的 version / engines.dsh / description / README 渲染（中英双语互链可达）。
3. 把输出留档到 `docs/releases/0.3.0/05-verify-published.txt`。

当前状态：等待人工发版。


## 进度
