# assets/

README 用的图片放这里，**只为 GitHub 渲染服务，不进 npm 发布物**。

## 规矩

| 项 | 做法 |
| --- | --- |
| 格式 | PNG（截图），≤ 300 KB；大图先压，别提交 2 MB 的原图 |
| 命名 | 全小写英文 + 连字符：`settings-panel.png`、`review-output.png` |
| 引用 | README 里用 HTML 控宽：`<img src="assets/xxx.png" width="720" alt="…">` |
| 不进包 | `package.json#files` 的**反向**断言看着这里（`scripts/verify.mjs`）：把 `assets/` 加进 files 会直接红 |

`pyproject` 一类工具不认识这里，但 `npm pack` 认识——只要 `files` 白名单里没有 `assets/`，
tarball 里就不会有它。README 的图靠 GitHub 的 raw URL 渲染，与 tarball 无关。
