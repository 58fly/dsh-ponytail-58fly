/**
 * 清单形状测试：`package.json#dsh.client` 与 `exports["./client"]`（#14 验收项 ④）。
 *
 * **为什么这条要单独存在**：`pnpm run verify` 的联动检查抓的是「声明与源码互相印证」，
 * 但它跑在仓库里、看得见源码；真机上宿主只看得见**发布出去的 package.json**。
 * 两者之间还隔着 `npm pack`（files 白名单）与宿主的 `parseDshClient` /
 * `clientExportOf` 两层校验。这里把后两者的判据原样抄成断言，
 * 让「装不起来」在 CI 里就红，而不是等用户装完发现面板不出现。
 *
 * 判据来源（逐条对得上宿主实现）：
 *   - `$H/dsh-client-modules/lib/index.js:86-100` `parseDshClient`
 *   - `$H/dsh-client-modules/lib/index.js:200-210` `clientExportOf`
 *   - `$H/dsh-client-modules/lib/index.js:789-792` `resolveMeta`
 *
 * 本文件**不装载浏览器环境**：只读清单与磁盘，不 import `lib/client.js`。
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

/** 宿主 `parseDshClient` 认可的四个键，多一个都是没人读的死键。 */
const HOST_CLIENT_KEYS = ['platform', 'inject', 'external', 'immediately'];

/** 取 `exports["./client"]` 的相对路径，等价于宿主 `clientExportOf` 的两个合法形状。 */
function clientExportPath(exportsField) {
  if (typeof exportsField !== 'object' || exportsField === null) return undefined;
  const entry = exportsField['./client'];
  if (typeof entry === 'string') return entry;
  if (typeof entry === 'object' && entry !== null && typeof entry.default === 'string') return entry.default;
  return undefined;
}

test('package.json 声明了 dsh.client，且只声明宿主认识的键', () => {
  const declaration = manifest.dsh?.client;
  assert.notEqual(declaration, undefined, 'v0.2 起必须声明 dsh.client：不声明则宿主 resolveMeta 直接 return null，客户端半边不装载');
  assert.equal(typeof declaration, 'object');
  assert.deepEqual(
    Object.keys(declaration).sort(),
    HOST_CLIENT_KEYS.filter((key) => key in declaration).sort(),
    'dsh.client 出现了宿主不读的键（parseDshClient 只返回 platform/inject/external/immediately）',
  );
});

test('dsh.client.platform 是 "web"（别的值等于整段白写）', () => {
  // 宿主原文：if (decl === void 0 || decl.platform !== "web") return null;
  assert.equal(manifest.dsh?.client?.platform, 'web');
});

test('dsh.client.inject 是非空全名数组，且每个包都是本仓 devDependency（= 宿主实装包）', () => {
  const inject = manifest.dsh?.client?.inject;
  assert.ok(Array.isArray(inject), 'dsh.client.inject 必须是数组');
  assert.ok(inject.length > 0, 'inject 不能为空：空数组等于没写依赖关系');
  for (const name of inject) {
    assert.equal(typeof name, 'string');
    assert.ok(
      name.startsWith('@deepseek-ai/dsh-client-'),
      name + ' 不是 @deepseek-ai/dsh-client-* 全名：宿主按包名查模块图，短名会被静默跳过',
    );
    assert.ok(
      Object.hasOwn(manifest.devDependencies ?? {}, name),
      name + ' 不在 devDependencies 里：inject 只能写真实存在于宿主的包，凭想象写会得到一个永远取不到的依赖',
    );
  }
});

test('inject 里的两个包分别提供 slots 与 configForms', () => {
  // 这两个服务名是客户端入口的硬契约：slots 是注册目标，configForms 是数据通道。
  // 换了 inject 集合就必须同步改 src/client/index.ts，这条断言把两边钉在一起。
  const inject = manifest.dsh?.client?.inject ?? [];
  assert.ok(inject.includes('@deepseek-ai/dsh-client-ui-renderer'), 'slots 由 dsh-client-ui-renderer 提供（lib/client.js:1348 super(ctx, "slots")）');
  assert.ok(inject.includes('@deepseek-ai/dsh-client-ui-settings'), 'configForms 由 dsh-client-ui-settings 提供（lib/client.js:1270 super(ctx, "configForms")）');
});

test('exports["./client"] 存在且指向磁盘上的真文件（宿主只认这个键）', () => {
  const relativePath = clientExportPath(manifest.exports);
  assert.equal(typeof relativePath, 'string', '声明了 dsh.client 却没有 exports["./client"]：宿主会抛 declares dsh.client but exports no "./client" bundle');
  const absolute = join(root, relativePath.replace(/^\.\//, ''));
  assert.ok(existsSync(absolute), relativePath + ' 在磁盘上不存在：先跑 pnpm run build（宿主 clientExportOf 只认这个键，缺文件等于入口失效）');
});

test('dsh.client 不含 external / immediately（我们不需要抢首屏，也没有 gateway 侧依赖）', () => {
  assert.equal(manifest.dsh?.client?.external, undefined, '没有 gateway 侧依赖就不要写 external：写错会让模块图等一个永远不来的包');
  assert.equal(manifest.dsh?.client?.immediately, undefined, '面板不需要在首屏前加载：immediately 会把我们的 bundle 排进启动关键路径');
});
