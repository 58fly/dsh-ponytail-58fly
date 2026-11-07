---
name: ponytail-debt
description: >
  List every `shortcut:` comment (and older `ponytail:` ones) as a debt ledger. One-shot report,
  changes nothing. Use for "ponytail debt", "what did ponytail defer", "list the
  shortcuts", /ponytail-debt.
  触发词：ponytail debt / 欠账清单 / 欠了什么技术债 / what did ponytail defer /
  list the shortcuts / 列出所有捷径。
---

每个有意的 ponytail 捷径都用一条 `shortcut:` 注释标出它的天花板与升级路径（更早的代码可能写的是 `ponytail:`）。这里把它们收成一本账，免得某次拖延悄悄变成永久。

## 扫描

在仓库里 grep 注释标记，跳过 `.git` 与所有 `.gitignore` 忽略掉的东西（依赖、构建产物、缓存，任何技术栈都一样）：

```
git grep --no-index --exclude-standard -nE '(#|//|/[*]) ?(shortcut|ponytail):'
```

你的技术栈用别的注释前缀，就加进去。

如果用户说了自己的标记词（`/ponytail-debt TODO`），改成 grep 那个词。

每条命中就是账本里的一行。注释前缀能把只是提到这个约定的散文挡在账外。不是拖延的命中要跳过，比如讲键盘快捷键的说明。

## 输出

一行一个标记，按文件分组：

`<文件>:<行号>, <简化了什么>. 天花板: <注释里写的局限>. 升级: <该回来看的触发条件>.`

约定是 `shortcut: <天花板>, <升级路径>`，所以天花板和触发条件直接从注释里抄。还想每行带上归属人，就加 `git blame -L<行号>,<行号>`。

标出腐化风险：没写升级路径或触发条件的标记注释打上 `无触发` 标签，这些就是会悄悄烂掉的。

结尾：`<N> 个标记，其中 <M> 个没有触发条件。` 什么都没找到：`没有捷径欠账，账本干净。`

## 边界

只读、只报，不改任何东西。用户要留存时，问一句再写进文件（例如 `PONYTAIL-DEBT.md`）。一次性。
