<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-IDEMPOTENCY-KEY: deck-2d275f6b-5980366 -->
<!-- DSH-CREATED: 2026-11-08T03:52:50.979Z -->
<!-- DSH-BLOCKED-BY: 02 -->
# 05: 配图基建：建 assets/ 与占位、files 白名单守卫扩到 assets/

**What to build:** 

**Blocked by:** #02

**Status:** ready-for-agent

- [ ] `assets/` 目录存在且有说明文件或 `.gitkeep`。
- [ ] README「效果」节里没有可渲染的图片标签、没有坏链；截图片段在 HTML 注释内。
- [ ] 手动把 `"assets/"` 加进 `package.json#files` 后跑 `pnpm run verify`：报红，提示语包含「assets」。
- [ ] 手动把 `assets/x.png` 塞进 pack 产物场景下，pack 检查正则能拦下（或用单测覆盖该正则）。
- [ ] `pnpm run verify` 在正常状态下全绿。
- [ ] `pnpm test` 全绿。

## 要交付什么

本版**不出真实截图**（用户裁决：截图后期版本提供，本版本暂不提供）。本票只做两件基础设施性质的事，为将来补图画好格子，同时堵住「`assets/` 被误打进 tarball」这个坑。

## 要做的三件事

### 1. 建 `assets/` 目录并放一份说明

- 建 `assets/.gitkeep` 或 `assets/README.md`，说明这里放 README 用的截图，命名约定 `panel-settings.png`（设置页面板）与 `review-output.png`（一次 `/ponytail-review` 的真实输出）。
- **不放任何占位图**，不留坏链。

### 2. README「效果」节写成可切换占位

用 HTML 注释包住未来要启用的图片片段，形如：

```html
<!-- 截图待补（0.3.0 之后）：取消下一行注释并把文件放进 assets/ 即可
<img width="720" src="https://raw.githubusercontent.com/58fly/dsh-ponytail-58fly/main/assets/panel-settings.png" alt="settings panel">
-->
```

要求：

- 注释掉的部分**不得**被任何检查脚本当作图片引用报错。
- 不得出现裸的 `![占位]` 或指向不存在文件的 `<img>`。
- 宽度用 HTML `width` 属性控制（Markdown 图片语法无法限宽，这是已验证的取舍）。

### 3. 把 `files` 白名单守卫扩到 `assets/`

- `scripts/verify.mjs:578` 现断言 `files` 不得含 `src/` / `docs/` / `test/`，提示语是「它们只是仓库内容，不该进 tarball」。把 `assets/` 加进这条列表。
- 顺带看 `.github/workflows/ci.yml` pack job 第 264 行的 `BAD_OTHER` 正则：它已排除 `docs|src|test|scripts|.scratch|.github`，**没有排除 `assets`**，一并补上，防止将来图被 pack 进包里。

理由：README 里的图走 raw URL 渲染，不需要进 npm 包；进了只会白胖 tarball。

## 不做

- 不截任何真实图。
- 不改 `package.json#files` 现有条目（只在检查侧加禁止项）。
- 不往 README 里塞任何会渲染失败的东西。

## 验收


## 进度
