#!/usr/bin/env node
/**
 * 发布后复验：从 registry 拉回真字节，核对摘要，再走一遍装配与宿主发现断言。
 *
 * 它回答的问题与另外两个脚本都不同：
 *   - verify:release 问「仓库、tag、registry 三方的版本号对不对得上」；
 *   - check-install  问「手上这份压缩包装进 profile 能不能用」；
 *   - 本脚本         问「**别人从 registry 装到的**那份字节，能不能用」。
 *
 * 第三问必须真去 registry 下载。在仓根 pack 一份自己再验是自证，验的是本地产物，
 * 不是别人拿到的东西。所以本脚本不读仓根任何 .tgz，也不接受本地文件作为输入。
 *
 * 为什么不进 prepublishOnly：发布前那个版本在 registry 上必然不存在，跑它只会假红。
 *
 * 摘要两侧都由包管理器自己算：registry 侧来自 `npm view ... dist`，本地侧来自
 * `npm pack` 的返回值。不自己拼哈希算法，也就没有「我算的算法对不对」这个问题。
 *
 * 用法：
 *   node scripts/verify-published.mjs
 *   node scripts/verify-published.mjs --version 0.2.0
 *   node scripts/verify-published.mjs --version 0.2.0 --registry https://registry.npmjs.org/
 *
 * 退出码：0 复验通过；1 未发布 / 摘要不一致 / 装配失败 / 参数错误。
 */

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describeProvenance, readAttestationPointer } from "./provenance.mjs";

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NPM = process.env.NPM ?? "npm";
const MAX_BUFFER = 64 * 1024 * 1024;

/** 解析 --version / --registry / --keep。 */
function parseArgs(argv) {
  const out = { version: null, registry: null, keep: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--version") {
      out.version = argv[++i];
    } else if (arg === "--registry") {
      out.registry = argv[++i];
    } else if (arg === "--keep") {
      out.keep = true;
    } else {
      throw new Error("未知参数 " + arg);
    }
  }
  if (out.version !== null && (typeof out.version !== "string" || out.version.length === 0)) {
    throw new Error("--version 后面要跟一个版本号");
  }
  if (out.registry !== null && (typeof out.registry !== "string" || out.registry.length === 0)) {
    throw new Error("--registry 后面要跟一个 registry 地址");
  }
  return out;
}

/**
 * 把「包管理器说没这个版本」认出来；其余错误原样上抛，不折成「还没发布」。
 *
 * npm 10 与 11 把错误 JSON 打在 stdout 上，同时往 stderr 写人类可读的多行文本，
 * 老版本可能只有后者，所以两边都看。只认 E404：断网、代理挂掉、要登录都是别的
 * 错误码，把它们也说成「还没发布」会让人以为发版失败，实际是网络问题。
 *
 * @param texts - 依次尝试的候选文本（stdout、stderr）。
 * @returns 命中时返回一句成因；没有 404 特征时返回 null。
 */
export function classifyMissing(texts) {
  for (const text of texts) {
    if (typeof text !== "string" || text.trim() === "") continue;
    const start = text.indexOf("{");
    if (start !== -1) {
      let parsed = null;
      try {
        parsed = JSON.parse(text.slice(start));
      } catch (error) {
        // 不是 JSON（多半是进度行），交给下面的文本判据。
        parsed = null;
      }
      if (parsed !== null && typeof parsed === "object" && parsed.error !== null && typeof parsed.error === "object") {
        if (parsed.error.code === "E404") return parsed.error.summary ?? "registry 返回 404";
      }
    }
    if (/\bE404\b/.test(text)) return "registry 返回 404";
  }
  return null;
}

/**
 * 两侧摘要的判定。抽成纯函数是为了能离线测：真去 registry 拉包要网络，
 * 但「不一致必须判红」这条逻辑不该只在有网的时候才被测到。
 *
 * integrityMatch 为 null 表示 registry 那一侧没有 integrity 字段（老包或特殊源），
 * 此时只比 shasum，不因为缺字段而判红。
 */
export function judgeDigest(dist, packed) {
  const shasumMatch = typeof dist.shasum === "string" && packed.shasum === dist.shasum;
  const integrityMatch = typeof dist.integrity === "string" ? packed.integrity === dist.integrity : null;
  return { ok: shasumMatch && integrityMatch !== false, shasumMatch, integrityMatch };
}

/**
 * 读产地签名状态。它只做记录，不影响退出码——本脚本问的是「字节可不可装可用」，
 * 「有没有签名」由 verify:release 硬门（那里没有签名直接红）。
 *
 * 端点取不到内容时返回 null 而不是抛错：签名端点偶尔 5xx，不该让一次可用的复验失败。
 */
async function readProvenance(dist) {
  const pointer = readAttestationPointer(dist);
  if (!pointer.present || pointer.url === null) return { pointer, bundle: null };
  try {
    const res = await fetch(pointer.url, { headers: { accept: "application/json" } });
    if (!res.ok) return { pointer, bundle: null };
    return { pointer, bundle: await res.json() };
  } catch {
    return { pointer, bundle: null };
  }
}

/**
 * 读 registry 时一律 `--prefer-online`：本脚本天生跑在「刚发布完」的那一刻，
 * 而 npm 的本地缓存里存着发布前的 packument。实测过不加这一条的后果——
 * `npm view` 因为 stale-while-revalidate 拿到了新版本，`npm pack` 却仍按旧
 * packument 解析，直接 `ETARGET: No matching version found`，把一个刚发成功的
 * 版本报成「不存在」。让包管理器自己去核对，比在这里猜缓存何时过期可靠。
 */

/** 问 registry 要这个版本的 dist 段；没发布就返回结论，不抛错。 */
async function readPublishedDist(name, version, registry) {
  const args = ["view", name + "@" + version, "dist", "--json", "--prefer-online"];
  if (registry !== null) args.push("--registry", registry);
  try {
    const result = await run(NPM, args, { maxBuffer: MAX_BUFFER });
    return { published: true, dist: JSON.parse(result.stdout) };
  } catch (error) {
    const why = classifyMissing([error.stdout, error.stderr]);
    if (why !== null) return { published: false, why };
    throw error;
  }
}

/**
 * 把「包管理器解析不到这个版本」的两种说法合起来判。
 *
 * ETARGET 与 E404 不是一回事：E404 是 registry 上没有这个东西，ETARGET 是
 * registry 上有这个包、但没有这个版本能匹配——刚发布完撞上本地旧 packument 时
 * 就会这样。两种都只该给一句结论，不该把 execFile 的错误对象整个倒出来。
 */
export function classifyUnpackable(texts) {
  for (const text of texts) {
    if (typeof text !== "string" || text.trim() === "") continue;
    const start = text.indexOf("{");
    if (start !== -1) {
      try {
        const parsed = JSON.parse(text.slice(start));
        const code = parsed?.error?.code;
        if (code === "ETARGET" || code === "E404") return parsed.error.summary ?? "包管理器解析不到这个版本";
      } catch {
        // 不是 JSON，落到下面的文本判据。
      }
    }
    if (/\bETARGET\b/.test(text)) return "包管理器按本地缓存的元数据解析不到这个版本";
    // npm 11 把同一件事写成 `notarget No matching version found`（小写、没有 ETARGET 字样），
    // 只认错误码会在新版本 npm 上漏判，所以这句人话也算数。
    if (/No matching version found/i.test(text)) return "包管理器按本地缓存的元数据解析不到这个版本";
    if (/\bE404\b/.test(text)) return "registry 返回 404";
  }
  return null;
}

/** 让包管理器把那个版本拉下来，返回它自己算的摘要与落盘文件名。 */
async function pack(name, version, dir, registry) {
  const args = ["pack", name + "@" + version, "--json", "--pack-destination", dir, "--prefer-online"];
  if (registry !== null) args.push("--registry", registry);
  let result;
  try {
    result = await run(NPM, args, { maxBuffer: MAX_BUFFER });
  } catch (error) {
    const why = classifyUnpackable([error.stdout, error.stderr]);
    if (why !== null) {
      throw new Error(
        "包管理器拉不到 " + name + "@" + version + "：" + why +
          "。刚发布的版本若刚传播开，稍后重试；持续如此说明 registry 上没有这份字节",
      );
    }
    throw error;
  }
  const parsed = JSON.parse(result.stdout);
  if (!Array.isArray(parsed) || parsed.length !== 1) {
    throw new Error("包管理器没有返回恰好一个 tarball 的描述：" + result.stdout.slice(0, 200));
  }
  return parsed[0];
}

/** 拿拉回来的真字节跑装配四段与宿主发现五段；通过返 null，失败返 1 并打印现场。 */
async function runAssemble(tarball) {
  const script = join(root, "scripts", "check-install.mjs");
  try {
    const result = await run(process.execPath, [script, "--mode", "assemble", "--tarball", tarball], {
      cwd: root,
      maxBuffer: MAX_BUFFER,
    });
    for (const line of result.stdout.split("\n")) {
      const trimmed = line.trim();
      if (trimmed === "") continue;
      if (/^(技能面|四档提示词体量|宿主判定|安装形态验证通过)/.test(trimmed)) console.log("  " + trimmed);
    }
    return null;
  } catch (error) {
    console.error("装配验证没通过 —— 这份字节装不出可用的插件：");
    if (typeof error.stdout === "string" && error.stdout.trim() !== "") console.error(error.stdout.trim());
    if (typeof error.stderr === "string" && error.stderr.trim() !== "") console.error(error.stderr.trim());
    console.error("失败原因：" + (error instanceof Error ? error.message : String(error)));
    return 1;
  }
}

async function main(args) {
  const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const name = manifest.name;
  const version = args.version ?? manifest.version;
  const suffix = args.registry === null ? "" : "（registry=" + args.registry + "）";
  console.log("发布后复验：" + name + "@" + version + suffix);

  const published = await readPublishedDist(name, version, args.registry);
  if (!published.published) {
    // 票面要求：给一句结论就退非零，不要把 registry 的 404 栈甩到人脸上。
    console.error("这个版本还没发布：" + name + "@" + version + "（" + published.why + "）");
    return 1;
  }
  const dist = published.dist;
  const distIntegrity = typeof dist.integrity === "string" ? dist.integrity : "（该版本没有 integrity 字段）";
  console.log("registry 记录：shasum=" + String(dist.shasum) + " integrity=" + distIntegrity);

  // 产地签名单独一行：它是「这份字节出自哪条流水线」的凭据，与摘要验的是两件事。
  const signed = await readProvenance(dist);
  console.log("产地签名：" + describeProvenance(signed.pointer, signed.bundle));

  const dir = await mkdtemp(join(tmpdir(), "pt-published-"));
  try {
    let packed;
    try {
      packed = await pack(name, version, dir, args.registry);
    } catch (error) {
      // 拉不到字节时说一句人话，不甩 execFile 的错误对象（那东西会把整段
      // npm 错误日志连同 stack 一起糊到屏幕上）。
      console.error(error instanceof Error ? error.message : String(error));
      return 1;
    }
    const file = join(dir, packed.filename);
    const info = await stat(file);
    if (info.size !== packed.size) {
      console.error("下载到的文件与包管理器报的大小不一致：文件 " + info.size + " 字节，报 " + packed.size + " 字节");
      return 1;
    }
    const verdict = judgeDigest(dist, packed);
    if (!verdict.ok) {
      console.error("两侧摘要不一致 —— 拉回来的字节不是 registry 记录的那一份：");
      console.error("  shasum    registry=" + String(dist.shasum) + " 下载=" + String(packed.shasum));
      console.error("  integrity registry=" + String(dist.integrity) + " 下载=" + String(packed.integrity));
      return 1;
    }
    const integrityNote = verdict.integrityMatch === true ? "  integrity 也一致 ✓" : "  （registry 无 integrity 字段，只比 shasum）";
    console.log("下载并核对：" + packed.filename + "  " + info.size + " 字节  shasum=" + String(packed.shasum) + integrityNote);

    const assembled = await runAssemble(file);
    if (assembled !== null) return assembled;

    console.log("");
    console.log("✅ 复验通过：" + name + "@" + version + " 从 registry 拉回的真字节可装可用");
    return 0;
  } finally {
    if (args.keep) console.log("保留下载目录：" + dir);
    else await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// 只有被直接执行时才跑主流程；被测试 import 时只拿上面的纯函数。
const invokedPath = process.argv[1] === undefined ? null : resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  process.exitCode = await main(args);
}