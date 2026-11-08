> 本目录为内部历史记录，非产品文档。不面向使用者，不随发布对外提供。

# 已归档的 issue tracker 过程材料

这里放**已经走完、不会再动**的 issue tracker 目录。仓库根 `.scratch/` 只留正在进行的那一轮，别把历史摊在那里，否则每开一次 `/wayfinder` 或 `/to-spec` 都要先分清哪些是活的。

## 归档规则（先定，免得每次吵）

| 什么时候归档 | 判据 |
| --- | --- |
| 地图已关闭 | `map.md` 的 `DSH-STATUS: closed`，且没有 open 的子票 |
| 规格已关闭 | `spec.md` 的 `Status: resolved`（或 closed），且拆出的实施票全部 resolved |
| 对外不再需要链接它 | README / CHANGELOG 已不再指向该目录 |

三条都满足才动，缺一条就留在 `.scratch/`。归档是**换位置，不改内容**：票正文、评论、进度表、证据一律原样保留，只把票里互相引用的路径改成归档后的路径。

## 归档了什么

| 目录（原位置） | 现在 | 是什么 | 为什么在这里 |
| --- | --- | --- | --- |
| `.scratch/ponytail-takeover/` | `docs/history/scratch/ponytail-takeover/` | 探索地图 00 + 14 张决策票 | 地图 2026-11-08 第三次核对后关闭；八条 Destination 判据逐条取证成立 |
| `.scratch/publish-0.2.0/` | `docs/history/scratch/publish-0.2.0/` | 规格 00 + 4 张实施票 | 0.2.0 首次发布完、`verify:published` 复验通过后关闭 |

两个目录是接力关系：地图管「设计成什么样」，规格管「怎么把第一个版本发出去」。

## 还活着的

`.scratch/readme-0-3-0/`（0.3.0 那一轮）**在 `.scratch/` 里**，不在本目录。等它关闭且 README 不再引用它，按上面的规则再搬过来。

## 用 deck 工具读归档票

本地 Markdown 后端的票按 `.scratch/<slug>/` 定位，搬进本目录后 deck 工具找不到它们，这是预期行为——它们是**只读历史**，不是待办。

要读原文，直接看文件：

```bash
# 归档地图
sed -n '1,60p' docs/history/scratch/ponytail-takeover/map.md

# 归档规格
sed -n '1,60p' docs/history/scratch/publish-0.2.0/spec.md

# 某个决策票的结论
grep -A 40 '^## Answer' docs/history/scratch/ponytail-takeover/issues/01-*.md
```

需要重新动起来的只有一种情况：归档件里出现必须纠正的**事实错误**（不是措辞）。那种情况直接改归档文件，并在该文件底部追加一条带日期的说明，别把它搬回 `.scratch/`。
