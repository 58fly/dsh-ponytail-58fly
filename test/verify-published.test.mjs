// 发布后复验脚本的离线断言：摘要判定、404 归类、参数面、以及"没发布时给结论并退非零"。
//
// 真去 registry 拉包需要网络，所以联网那条路径不进单测；但每条错误处理分支
// 都能在本地用一台假 registry 打出来 —— 这正是票面要求的「离线可测的那条路径」。
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { classifyMissing, classifyUnpackable, judgeDigest } from "../scripts/verify-published.mjs";

const run = promisify(execFile);
const here = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(here, "..");
const SCRIPT = join(ROOT, "scripts", "verify-published.mjs");

const DIST = {
  shasum: "a839091f95cfe37d039f98cc1164bbc627d43468",
  integrity: "sha512-eXSKN+32XXunX0etbQsN3mYZKp3zIIX10SzxyCHrWRlRmf840Aw+EKabhLKIzXpw9Q7O6S8/QRUXG87Pz59Zdw==",
};

test("judgeDigest：两侧摘要一致时通过", () => {
  const verdict = judgeDigest(DIST, { ...DIST });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.shasumMatch, true);
  assert.equal(verdict.integrityMatch, true);
});

test("judgeDigest：shasum 不一致必须判红", () => {
  const verdict = judgeDigest(DIST, { ...DIST, shasum: "0".repeat(40) });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.shasumMatch, false);
});

test("judgeDigest：integrity 不一致必须判红（即使 shasum 恰好相同）", () => {
  const verdict = judgeDigest(DIST, { ...DIST, integrity: "sha512-AAAA" });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.integrityMatch, false);
});

test("judgeDigest：registry 侧没有 integrity 字段时只比 shasum，不因缺字段判红", () => {
  const verdict = judgeDigest({ shasum: DIST.shasum }, { ...DIST });
  assert.equal(verdict.integrityMatch, null);
  assert.equal(verdict.ok, true);
});

test("judgeDigest：下载侧没有 shasum 时判红（不能拿 undefined 比 undefined 混过去）", () => {
  const verdict = judgeDigest({ shasum: DIST.shasum }, { integrity: DIST.integrity });
  assert.equal(verdict.ok, false);
});

test("classifyMissing：认得出 npm 打在 stdout 的 E404 JSON", () => {
  const text = JSON.stringify({ error: { code: "E404", summary: "No match found for version 0.2.0" } });
  assert.equal(classifyMissing([text]), "No match found for version 0.2.0");
});

test("classifyMissing：认得出老式 stderr 文本里的 E404", () => {
  const text = "npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/x";
  assert.equal(classifyMissing(["", text]), "registry 返回 404");
});

test("classifyMissing：断网 / 权限 / 服务错误不能被当成「还没发布」", () => {
  assert.equal(classifyMissing([JSON.stringify({ error: { code: "E500", summary: "boom" } })]), null);
  assert.equal(classifyMissing(["npm error code ENOTFOUND", "npm error network request failed"]), null);
  assert.equal(classifyMissing(["npm error code E401", "npm error need auth"]), null);
});

test("classifyMissing：空文本不误判", () => {
  assert.equal(classifyMissing([]), null);
  assert.equal(classifyMissing(["", "   "]), null);
});

/** 起一台永远 404 的假 registry，返回地址与关闭函数。 */
async function startFakeRegistry(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address === "object", "假 registry 没拿到端口");
  return {
    url: "http://127.0.0.1:" + address.port + "/",
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/**
 * 跑脚本子进程。三项环境隔离是必要的：
 *   1. 用户级 npmrc 里配着代理，127.0.0.1 也会被绕出去；
 *   2. 缓存目录别写到用户家里；
 *   3. 只认本机回环，保证测试真的离线。
 */
async function runScript(args, registryUrl) {
  const dir = await mkdtemp(join(tmpdir(), "pt-vp-test-"));
  const npmrc = join(dir, "npmrc");
  await writeFile(npmrc, "", "utf8");
  try {
    const result = await run(process.execPath, [SCRIPT, ...args], {
      cwd: ROOT,
      env: {
        ...process.env,
        NPM_CONFIG_USERCONFIG: npmrc,
        NPM_CONFIG_CACHE: join(dir, "cache"),
        NPM_CONFIG_PROXY: "",
        NPM_CONFIG_HTTPS_PROXY: "",
        NPM_CONFIG_HTTP_PROXY: "",
        NPM_CONFIG_REGISTRY: registryUrl,
        // 连不上时 npm 默认重试两次、退避到分钟级；测试里不需要这份耐心。
        NPM_CONFIG_FETCH_RETRIES: "0",
        NPM_CONFIG_FETCH_TIMEOUT: "5000",
      },
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return { code: error.code, stdout: String(error.stdout ?? ""), stderr: String(error.stderr ?? "") };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

test("classifyUnpackable：ETARGET 也认，不只认 E404", () => {
  const etarget = JSON.stringify({ error: { code: "ETARGET", summary: "No matching version found for dsh-ponytail-58fly@0.2.2." } });
  assert.match(String(classifyUnpackable([etarget])), /No matching version found/);
  const e404 = JSON.stringify({ error: { code: "E404", summary: "Not Found" } });
  assert.equal(classifyUnpackable([e404]), "Not Found");
});

test("classifyUnpackable：老式纯文本 ETARGET / 无关错误各走各的", () => {
  assert.match(String(classifyUnpackable(["npm error notarget No matching version found"])), /缓存的元数据/);
  assert.equal(classifyUnpackable(["ETIMEDOUT connection reset"]), null, "超时不能被说成版本不存在");
  assert.equal(classifyUnpackable(["", "  "]), null);
});

test("读 registry 一律 --prefer-online：刚发布完不能被本地旧 packument 骗", async () => {
  // 实测过的真事故：npm view 走 stale-while-revalidate 拿到了新版本，npm pack 却仍按
  // 本地旧元数据解析，报 ETARGET 把刚发成功的版本说成「不存在」。两条命令都得绕开缓存。
  const source = await readFile(SCRIPT, "utf8");
  assert.match(source, /"view",\s*name \+ "@" \+ version,\s*"dist",\s*"--json",\s*"--prefer-online"/, "view 没带 --prefer-online");
  assert.match(source, /"pack",\s*name \+ "@" \+ version,[^\]]*"--prefer-online"/, "pack 没带 --prefer-online");
});

test("版本没发布时：给一句结论、退码非零、不把 404 栈甩到人脸上", async () => {
  const registry = await startFakeRegistry((request, response) => {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "Not found" }));
  });
  try {
    const result = await runScript(["--version", "9.9.9"], registry.url);
    assert.equal(result.code, 1, "版本不存在时必须退非零");
    const complaint = result.stderr.trim();
    assert.match(complaint, /这个版本还没发布：dsh-ponytail-58fly@9\.9\.9/);
    assert.doesNotMatch(complaint, /\n\s+at /, "不该出现堆栈");
    assert.doesNotMatch(complaint, /npm error/, "不该把 npm 的错误日志原样贴出来");
  } finally {
    await registry.close();
  }
});

test("包存在但版本不存在时：同样给「还没发布」，不误报成网络错误", async () => {
  const registry = await startFakeRegistry((request, response) => {
    const url = String(request.url);
    if (url === "/dsh-ponytail-58fly") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ name: "dsh-ponytail-58fly", "dist-tags": { latest: "0.0.1" }, versions: {} }));
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "Not found" }));
  });
  try {
    const result = await runScript(["--version", "9.9.9"], registry.url);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /这个版本还没发布/);
  } finally {
    await registry.close();
  }
});

test("网络是坏的（连不上）时：抛原错，不假装「还没发布」", async () => {
  // 拿一个已经关掉的端口，制造 ECONNREFUSED。
  const dead = await startFakeRegistry((request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end("{}");
  });
  await dead.close();
  const result = await runScript(["--version", "9.9.9"], dead.url);
  assert.notEqual(result.code, 0);
  assert.doesNotMatch(result.stderr, /这个版本还没发布/, "连不上不能算「还没发布」");
});

test("参数面只有 --version / --registry / --keep：不新增本地压缩包输入", async () => {
  const source = await readFile(SCRIPT, "utf8");
  // 脚本正文里确实会出现 --tarball —— 那是转手给装配验证的，不是本脚本的入参。
  // 真正要钉的是：参数解析里没有 tarball 这个键，谁来都只能给版本号与 registry。
  assert.doesNotMatch(source, /out\.tarball/, "本脚本不接受本地文件输入，输入必须来自 registry");
  assert.doesNotMatch(source, /args\.tarball/, "本脚本不接受本地文件输入，输入必须来自 registry");
  assert.match(source, /out\.version/);
  assert.match(source, /out\.registry/);
});

test("装配那一步复用装配验证既有的压缩包参数，不自造一套", async () => {
  const source = await readFile(SCRIPT, "utf8");
  assert.match(source, /"--mode",\s*"assemble",\s*"--tarball"/);
});

test("未知参数直接报错，不静默忽略", async () => {
  const result = await runScript(["--tarball", "./x.tgz"], "http://127.0.0.1:1/");
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /未知参数 --tarball/);
});

test("发布前钩子里不含这条脚本（发布前那个版本必然还没上 registry）", async () => {
  const manifest = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
  assert.equal(typeof manifest.scripts["verify:published"], "string", "没有独立的包脚本");
  assert.doesNotMatch(manifest.scripts.prepublishOnly, /verify-published/, "复验不能进发布前钩子，否则必然假红");
});