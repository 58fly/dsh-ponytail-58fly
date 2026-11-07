#!/usr/bin/env node
/**
 * 把 package.json 里所有 @deepseek-ai/dsh-* 的 devDependency 统一改到指定版本。
 *
 * 为什么要有它：CI 要跑 dsh 版本矩阵（0.2.0-rc.1 / 0.2.1-rc.5 / 0.2.2-rc.1），
 * 而 devDependencies 里写死的是开发机上的那个版本。手改矩阵里的每个 job 既易漏
 * （dsh 包有 12 个，客户端包又有 7 个）又易错（漏掉一个就变成"一半新一半旧"的
 * 混合类型面，typecheck 结果不可信）。
 *
 * 只改 devDependencies，不动 peerDependencies —— peerDependencies 是我们对宿主的
 * **兼容范围声明**（cordis ~4.1.0 / schemastery ~3.19.0），它不是"装哪个版本"，
 * 改它等于改契约。
 *
 * 用法：node scripts/set-dsh-version.mjs 0.2.1-rc.5
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2];

if (typeof target !== 'string' || target.trim() === '') {
  throw new Error('用法：node scripts/set-dsh-version.mjs <版本，例如 0.2.1-rc.5>');
}

/** 只有这些前缀的包跟着 dsh 版本走；cordis / schemastery / 工具链不在此列。 */
const DSH_PACKAGE_PREFIXES = ['@deepseek-ai/dsh-', '@deepseek-ai/schemastery'];

const manifestPath = join(root, 'package.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const dev = manifest.devDependencies ?? {};

const changed = [];
for (const [name, current] of Object.entries(dev)) {
  // schemastery 与 dsh 包不同步：它的版本序列止于 3.19.0，没有 0.2.x。
  // 所以只有 dsh- 前缀的包跟着矩阵走，schemastery 与 cordis 保持不动。
  if (!name.startsWith('@deepseek-ai/dsh-')) continue;
  if (current === target) continue;
  dev[name] = target;
  changed.push(name + ': ' + current + ' -> ' + target);
}

if (changed.length === 0) {
  console.log('所有 @deepseek-ai/dsh-* devDependency 已经是 ' + target + '，无需改动');
} else {
  manifest.devDependencies = dev;
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log('已把 ' + changed.length + ' 个 devDependency 改到 ' + target + '：');
  for (const line of changed) console.log('  ' + line);
}

// 把实际生效的版本面打出来，方便 CI 日志里一眼确认矩阵跑的是哪一层。
console.log('\n当前 devDependencies 里 dsh 包的版本分布：');
const versions = new Map();
for (const [name, version] of Object.entries(dev)) {
  if (!name.startsWith('@deepseek-ai/dsh-')) continue;
  versions.set(version, (versions.get(version) ?? 0) + 1);
}
for (const [version, count] of versions) console.log('  ' + version + ' × ' + count);
if (versions.size > 1) {
  throw new Error('dsh 包版本不一致：混装会让类型面自相矛盾，请先修 package.json');
}
