<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-IDEMPOTENCY-KEY: publish-020-t03-verify-published -->
<!-- DSH-CREATED: 2026-11-07T17:52:23.695Z -->
<!-- DSH-BLOCKED-BY: 01 -->
# 03: 发布后复验：从 registry 拉回真字节再走一遍装配与宿主断言

**What to build:** 一条发布后能手动跑的复验命令：它从 registry 上把那个版本的真实压缩包拉回来，核对字节与 registry 记录的摘要一致，再拿这份字节跑一遍装配四段与宿主发现断言。版本还没发出去的时候，它给一句「这个版本还没发布」并退非零，而不是把 registry 的 404 栈甩到人脸上。

**Blocked by:** 01（宿主发现断言要先长在装配验证里, 复验才有东西可复用）

**Status:** resolved

- [x] 新增一条包脚本，独立于发布前钩子（发布前包里还没有那个版本，钩子里跑它必然假红）。
- [x] 输入必须来自 registry（带版本的打包命令会走网络），不读仓根那份本地压缩包，也不落依赖目录。
- [x] 完整性核对两侧都用包管理器自己算的摘要，不自己拼哈希算法；不一致时给明确文案并退非零。
- [x] 版本不存在时输出「这个版本还没发布」并退非零，不打印 registry 404 的栈。
- [x] 复用装配验证既有的压缩包输入参数，不新增参数面。
- [x] 拉到真包时走完装配四段断言与宿主发现五项断言。
- [x] 离线可测的那条路径（不存在版本）有断言覆盖：给出结论且退出码非零。
- [x] 不改变装配验证三种形态的既有行为；其自检仍全绿。

## Answer

### 落点

| 票面要求 | 落点 | 证据 |
| --- | --- | --- |
| 新增包脚本、独立于发布前钩子 | `package.json:79` 加了 `"verify:published": "node scripts/verify-published.mjs"`；`prepublishOnly`（:81）里没有它 | 发布前钩子串是 `typecheck && build && verify && check:skills && check:matrix && test && verify-release`，不含 published |
| 输入必须来自 registry | `scripts/verify-published.mjs` 全篇只调 `npm view <name>@<ver> dist --json` 与 `npm pack <name>@<ver> --json --pack-destination <tmp>`；没有任何读本地 `.tgz` 的代码路径，参数面里也没有 `--tarball` | 参数只有 `--version` / `--registry` / `--keep`，未知参数直接抛；测试里有一条断言 `out.tarball` 与 `args.tarball` 都不存在 |
| 完整性核对两侧都用包管理器自己算的摘要 | `judgeDigest(dist, packed)`（`scripts/verify-published.mjs:100-104`）：`dist` 来自 registry 的 `dist` 段，`packed` 来自 `npm pack --json` 的返回值，两侧都不自己算哈希 | 真跑输出两侧 shasum 都是 `a839091f95cfe37d039f98cc1164bbc627d43468`，integrity 都是 `sha512-eXSKN+32…` |
| 版本不存在时给结论 + 退非零、不甩 404 栈 | `classifyMissing(texts)`（`:72-91`）只认 `error.code === "E404"`；主流程 `:163-167` 打一行「这个版本还没发布」并 `return 1` | `node scripts/verify-published.mjs --version 9.9.9` → stderr 只有一行 `这个版本还没发布：dsh-ponytail-58fly@9.9.9（No match found for version 9.9.9）`，EXIT=1，输出里既没有堆栈行也没有 `npm error` |
| 复用装配验证既有 `--tarball`，不新增参数面 | `runAssemble(tarball)`（`:133-153`）转手调 `node scripts/check-install.mjs --mode assemble --tarball <file>` | 脚本里出现的 `--tarball` 只有转手这一处，自己的参数解析不认它 |
| 拉到真包时走完装配四段与宿主发现五项 | 同上；`check-install.mjs --mode assemble` 本身就含四段装配 + 六行宿主判定 | 真跑输出六行 `宿主判定：…`（模块图找到本包 rev=306bc589e62b / 客户端产物路径 / 按包名取到 / 平台=网页 / 外部依赖=[] / 外壳 id）+ 技能面六项 + 四档体量 |
| 离线可测路径有断言覆盖 | `test/verify-published.test.mjs` 共 16 条，其中 6 条是脚本级：未发布版本、包存在但版本不存在、端口已关（ECONNREFUSED 不许报「还没发布」）、参数面、复用参数、钩子不含量 | `pnpm test` 221 pass / 0 fail（原 205 + 新增 16） |
| 不改三形态既有行为、自检仍全绿 | `check-install.mjs` 三种形态与 `--selftest` 全部重跑 | `--mode link` EXIT=0 / `--mode tarball` EXIT=0 / `--mode assemble --selftest` EXIT=0（三破一复全绿） |

### 顺带修掉的一个真缺陷（票面没预见）

`check-install.mjs` 的 `discoverClient` 原来把「清单分类文案」与「宿主实际状态」耦合在一起：
`classifyClientMiss(manifest)` 拿到「声明缺失」之后并不立刻抛，而是继续起树去问宿主。
在 link 形态下宿主解析器会指回仓库那一份 manifest（selftest 副本化的是 node_modules 那份），
于是 `resolveMeta` 正常返回，流程一路走到「宿主取到的产物与包内的不是同一个文件」——
反向自检的第一破就红在了错误的文案上：

```text
Error: selftest 失败：删掉 dsh.client 声明 的失败文案没落到「声明缺失」，实际是：
宿主取到的产物与包内的不是同一个文件：宿主 /Volumes/data/dsh-ponytail/lib/client.js，
包内 /private/var/folders/r7/…/node_modules/dsh-ponytail-58fly/lib/client.js
```

改法两条：

1. 清单坏就在起树前抛（`scripts/check-install.mjs:259-265`）：`miss !== null` 直接 `throw new Error(miss)`。结论在起树之前就定了，不要再问宿主——问出来的只会是另一件事。
2. 归属断言可关（`discoverClient(…, { checkProvenance })`，`:255` 与 `:299` / `:320`）：反向自检的「一复」传 `checkProvenance: false`。副本化之后 link 形态解析器仍可能指回仓库，那属于解析器的来源归属，与「宿主有没有认我们」是两件事；main 那次永远开着。

这条修完之后三破全部红在正确文案上：

```text
selftest ✓ 删掉 dsh.client 声明 被打红：声明缺失：package.json 的 dsh 段里没有 client，宿主根本不会装载客户端半边
selftest ✓ 把平台改成 node 被打红：平台不是网页：dsh.client.platform 是 "node"，宿主只认 "web"
selftest ✓ 删掉导出映射里的客户端入口 被打红：导出映射缺客户端入口：声明了 dsh.client 却拿不到 exports["./client"]，宿主会抛错
selftest ✓ 三破一复通过（3 种破坏全红，恢复后重新变绿）
```

### 一条硬取证：npm 的 404 文案靠不住

用假 registry 实测（`/tmp/pt-reg-probe.mjs`、`/tmp/pt-reg-probe2.mjs`）：

| 情形 | stdout | stderr | 退出码 |
| --- | --- | --- | --- |
| 包不存在 | `{"error":{"code":"E404","summary":"Not Found - GET …"}}` | 多行 `npm error code E404` | 1 |
| 包存在、版本不存在 | 同上但 summary 变成 `No match found for version 0.2.0` | 同上 | 1 |

两种情形的 summary 文案不同——所以判据只能落在 `error.code === "E404"` 上，不能对 summary 做字符串匹配。
反过来，`E500` / `ENOTFOUND` / `E401` 都不许被折成「还没发布」：那会让人以为发版没成功，实际是网络或凭据问题。
`classifyMissing` 就是照这条写的，`test/verify-published.test.mjs` 里有一条专门喂这三种错误断言返回 null。

### 质量门（本轮全跑）

| 门 | 结果 |
| --- | --- |
| `pnpm run typecheck` | exit 0 |
| `pnpm run build` | client bundle 16322 字节，id=dsh-ponytail-58fly |
| `pnpm run verify` | 通过（26 个源文件，97 个产物文件，1 条提醒） |
| `pnpm run check:skills` | 通过（6 个技能，阈值 480/500，提醒「上游 ca88b4f 有新提交，冻结在 7801d06」） |
| `pnpm run check:matrix` | 覆盖 engines.dsh 区间内全部 15 个版本 ✓ |
| `pnpm test` | 221 pass / 0 fail（原 205 + 新增 16） |
| `check-install --mode link` | exit 0 |
| `check-install --mode tarball --tarball ./dsh-ponytail-58fly-0.2.0.tgz` | exit 0 |
| `check-install --mode assemble --selftest` | exit 0，三破一复全绿 |
| `pnpm run verify:published`（真 registry） | exit 0，`✅ 复验通过：dsh-ponytail-58fly@0.2.0 从 registry 拉回的真字节可装可用` |

### 真实复验输出（0.2.0，真跑）

```text
发布后复验：dsh-ponytail-58fly@0.2.0
registry 记录：shasum=a839091f95cfe37d039f98cc1164bbc627d43468 integrity=sha512-eXSKN+32XXunX0etbQsN3mYZKp3zIIX10SzxyCHrWRlRmf840Aw+EKabhLKIzXpw9Q7O6S8/QRUXG87Pz59Zdw==
下载并核对：dsh-ponytail-58fly-0.2.0.tgz  91368 字节  shasum=a839091f95cfe37d039f98cc1164bbc627d43468  integrity 也一致 ✓
  技能面：ponytail, ponytail-audit, ponytail-debt, ponytail-gain, ponytail-help, ponytail-review
  四档提示词体量：{"off":0,"lite":1203,"full":1188,"ultra":1206}
  宿主判定：模块图按包名找到本包 = true（rev=306bc589e62b）
  宿主判定：客户端产物路径 = /private/var/folders/r7/…/node_modules/dsh-ponytail-58fly/lib/client.js
  宿主判定：按包名取到客户端产物 = true
  宿主判定：平台 = 网页（resolveMeta 非 null 即证明 dsh.client.platform === "web"）
  宿主判定：外部依赖 = []（声明 ["@deepseek-ai/dsh-client-ui-settings","@deepseek-ai/dsh-client-ui-renderer"] inject）
  宿主判定：产物外壳 id = "dsh-ponytail-58fly"
  安装形态验证通过（mode=assemble）

✅ 复验通过：dsh-ponytail-58fly@0.2.0 从 registry 拉回的真字节可装可用
```

### 缺陷版先红（证明测试不是装饰）

把 `readPublishedDist` 的 catch 里 `const why = classifyMissing([...])` 短路成 `const why = null`，
再跑 `node --test test/verify-published.test.mjs`：

```text
not ok 10 - 版本还没发布时给出结论并退非零，不甩 404 栈
not ok 11 - 包存在但这个版本不存在，同样退非零
# pass 14
# fail 2
```

恢复原文后 `# pass 16 / # fail 0`。同一批测试在缺陷版本上真会红，不是「写了正好过」。

### 改动文件

- 新建 `scripts/verify-published.mjs`（207 行）
- 新建 `test/verify-published.test.mjs`（196 行，16 条）
- `package.json`：加一行 `verify:published`
- `scripts/check-install.mjs`：修「清单坏仍去问宿主」与「归属断言不可关」两处
- `docs/发布清单.md`：发版后复验主线换成 `pnpm run verify:published`，手工拆分步骤降为排查用
- `README.md`：启动段补两条发布后命令、发布卡口表加「发布后复验」一行、反向用例段说清 published 的反向用例在哪

### 遗留

- 复验脚本默认打真 registry。要复验私有源或本地 verdaccio 得传 `--registry`，这条路径没有自动化测试覆盖（实现留了参数）。
- `npm pack --json` 的 `files` / `entryCount` 只用于人看，没做文件清单比对。摘要本身已是内容哈希，比对清单是额外保险，本轮没做。

## Comments

### local — 2026-11-07T20:07:49.638Z
新增 scripts/verify-published.mjs + 16 条测试：从 registry 拉真字节、两侧摘要均由包管理器自己算、未发布版本给一句话结论并退非零、复用 --tarball 转手装配四段与宿主发现五项；顺带修掉 check-install selftest 把「清单坏」误判成「产物不同源」的耦合。六道质量门全绿，三形态与自检全绿。

## 进度

- 2026-11-08：认领 → 取证（npm 404 两种文案、npm pack --json 字段、代理对回环地址不生效）→ 写脚本与 16 条测试 → 真 registry 复验 0.2.0 通过 → 缺陷版先红取证 → 修 check-install 的 selftest 耦合 → 三形态 + 自检全绿 → 六道质量门全绿 → 关票。
