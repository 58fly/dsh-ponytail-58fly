# 域文档

本文件说明工程类技能在探索本仓库代码时应如何消费这里的域文档。

**本仓库的域文档布局是 multi-context（多上下文）：子项目各有一份 `GLOSSARY.md`，仓库根目录一份 `GLOSSARY-MAP.md` 指向它们。**

## 探索代码前先读这些

- 仓库根目录的 **`GLOSSARY-MAP.md`**：它指向每个上下文各自的 `GLOSSARY.md`；只读与当前主题相关的那几份。
- **`docs/adr/`**：读与你即将改动的区域相关的 ADR。多上下文仓库还要看 `src/<context>/docs/adr/` 下的上下文级决策。

如果这些文件不存在，**静默继续**：不要提示它们缺失，也不要主动建议先建起来。`/domain-modeling`（经由 `/grill-with-docs` 与 `/improve-codebase-architecture` 触达）会在术语或决策真正定下来时按需创建它们。本仓库初始化时即按此规则处理：`GLOSSARY-MAP.md` 与各子项目的 `GLOSSARY.md` 留到第一次真正写下词条时再由 `/domain-modeling` 创建，届时由根目录的 `GLOSSARY-MAP.md` 指向各子项目的词表。

## 文件结构

单上下文仓库（大多数仓库是这样）：

```
/
├── GLOSSARY.md
├── docs/adr/
│   ├── 0001-event-sourced-orders.md
│   └── 0002-postgres-for-write-model.md
└── src/
```

多上下文仓库（根目录存在 `GLOSSARY-MAP.md`）：

```
/
├── GLOSSARY-MAP.md
├── docs/adr/                          ← 系统级决策
└── src/
    ├── ordering/
    │   ├── GLOSSARY.md
    │   └── docs/adr/                  ← 上下文级决策
    └── billing/
        ├── GLOSSARY.md
        └── docs/adr/
```

## 沿用词表里的用语

当输出里要提到某个领域概念（无论是 issue 标题、重构提案、假设，还是测试名称），使用 `GLOSSARY.md` 里定义的那个词。不要漂移到词表明确回避的同义词。

如果需要的概念还没进词表，这本身是个信号：要么你在发明项目并不使用的说法（重新考虑），要么确实存在缺口（记下来，交给 `/domain-modeling`）。

## 标出 ADR 冲突

如果输出与既有 ADR 相矛盾，明确摆出来，不要静默覆盖：

> _与 ADR-0007（事件溯源订单）冲突，但值得重开，理由是……_
