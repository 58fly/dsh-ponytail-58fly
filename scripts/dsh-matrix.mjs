#!/usr/bin/env node
/**
 * 断言 CI 的 compat 矩阵穷举了 engines.dsh 区间内的**全部**已发布版本。
 *
 * 为什么要有它：engines.dsh 是对用户的兼容承诺（`>=0.2.0-rc.1 <0.3.0-0`），
 * 承诺的每一格都该有人真跑过。但矩阵是手写的常量，engines.dsh 是另一处常量——
 * 两者一旦漂移，就会出现"声明支持 0.2.3，CI 只跑到 0.2.2"这种没人能发现的洞。
 * 这个脚本把"区间"和"矩阵"放在一起验：从 npm registry 取真实版本表，用 semver
 * 过滤出区间内的版本，与 ci.yml 的矩阵逐条比对。
 *
 * 两种运行模式：
 *   node scripts/dsh-matrix.mjs            只打印区间内版本，供人肉核对（离线友好）
 *   node scripts/dsh-matrix.mjs --check    连 registry 比对 ci.yml，不一致就红（CI 用）
 *
 * 为什么另有一份 offline 常量：CI 里 registry 偶尔会限流，而"矩阵是否覆盖全系列"
 * 这件事不该因为网络抖动变红。offline 表只是**缓存**，`--check` 每次都重取并比对，
 * 所以它没法悄悄过期而没人知道。
 */

import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');

/** registry 上不可达时退回到这份表；它必须与 registry 逐条一致，否则 --check 会红。 */
const KNOWN_PUBLISHED = [
  '0.2.0-rc.1',
  '0.2.0-rc.2',
  '0.2.1-alpha.1',
  '0.2.1-alpha.2',
  '0.2.1-alpha.3',
  '0.2.1-alpha.4',
  '0.2.1-alpha.5',
  '0.2.1-rc.1',
  '0.2.1-rc.2',
  '0.2.1-rc.3',
  '0.2.1-rc.4',
  '0.2.1-rc.5',
  '0.2.2-alpha.2',
  '0.2.2-alpha.3',
  '0.2.2-rc.1',
  '0.2.2-rc.2',
];

/**
 * 极简 semver 判断：只支持本仓 engines.dsh 用到的形状
 * （`>=` 下界 + `<` 上界 + 裸版本比较）。不引 semver 依赖是刻意的，
 * verify / 本脚本都要能在零依赖下跑。
 *
 * @param version - 待判定的版本串，例如 `0.2.1-rc.5`。
 * @param range - 形如 `>=0.2.0-rc.1 <0.3.0-0` 的区间。
 * @returns 是否落在区间内。
 */
export function satisfiesRange(version, range) {
  const parse = (text) => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(text.trim());
    if (match === null) throw new Error('看不懂的版本号：' + text);
    return {
      major: Number(match[1]),
      minor: Number(match[2]),
      patch: Number(match[3]),
      pre: match[4] === undefined ? [] : match[4].split('.'),
    };
  };
  /** prerelease 比较规则见 semver §11：数字段按数值比，字母段按字典序，缺段更小。 */
  const comparePre = (a, b) => {
    if (a.length === 0 && b.length === 0) return 0;
    if (a.length === 0) return 1;
    if (b.length === 0) return -1;
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
      const left = a[i];
      const right = b[i];
      if (left === undefined) return -1;
      if (right === undefined) return 1;
      const leftNum = /^\d+$/.test(left);
      const rightNum = /^\d+$/.test(right);
      if (leftNum && rightNum) {
        if (Number(left) !== Number(right)) return Number(left) < Number(right) ? -1 : 1;
        continue;
      }
      if (leftNum !== rightNum) return leftNum ? -1 : 1;
      if (left !== right) return left < right ? -1 : 1;
    }
    return 0;
  };
  const compare = (left, right) => {
    for (const key of ['major', 'minor', 'patch']) {
      if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
    }
    return comparePre(left.pre, right.pre);
  };

  const target = parse(version);
  for (const clause of range.trim().split(/\s+/)) {
    const match = /^(>=|<=|>|<|=)?(.+)$/.exec(clause);
    const operator = match[1] ?? '=';
    const bound = parse(match[2]);
    const order = compare(target, bound);
    const ok =
      (operator === '>=' && order >= 0) ||
      (operator === '>' && order > 0) ||
      (operator === '<=' && order <= 0) ||
      (operator === '<' && order < 0) ||
      (operator === '=' && order === 0);
    if (!ok) return false;
  }
  return true;
}

/**
 * 把「区间内应有的版本」与「矩阵里写着的版本」比对成两份差异清单。
 *
 * 抽成纯函数是为了能离线单测（与 `verify-published.mjs` 里 `classifyMissing` 同一理由）：
 * 这里最容易错的不是「漏了谁」，而是 `extra` 的**成因**。打开上界（`<0.3.0-0`）之后，
 * 矩阵里出现一个不该有的格子有两种完全不同的原因：
 *
 *   `out-of-range`  该版本压根不在 engines.dsh 承诺里 —— 写错了区间或写错了版本号；
 *   `unpublished`   该版本在承诺范围内，但宿主**还没发布** —— 属于抢跑预填，等宿主发了再加格。
 *
 * 两者混成一句「矩阵里有区间外的版本」会让第二种情况看起来像配置错误，实际它是时序问题。
 *
 * @param expected - 区间内已发布的版本（判据的唯一来源）。
 * @param matrix - ci.yml 里手写的矩阵格。
 * @param range - engines.dsh 区间串。
 * @param published - 可选的 registry 全集；给了才能区分 `unpublished`，不给则一律按区间判。
 * @returns `{ ok, missing, extra }`，`extra` 每项形如 `{ version, reason }`。
 */
export function classifyMatrixDiff({ expected, matrix, range, published }) {
  const missing = expected.filter((version) => !matrix.includes(version));
  const extra = matrix
    .filter((version) => !expected.includes(version))
    .map((version) => {
      const known = Array.isArray(published) ? published : null;
      const reason = known !== null && satisfiesRange(version, range) && !known.includes(version)
        ? 'unpublished'
        : 'out-of-range';
      return { version, reason };
    });
  return { ok: missing.length === 0 && extra.length === 0, missing, extra };
}

/** 把 `classifyMatrixDiff` 的结果翻成人能读的失败行。 */
export function describeMatrixDiff(diff, range) {
  const lines = [];
  if (diff.missing.length > 0) {
    lines.push('矩阵漏了 engines.dsh 区间内的版本：' + diff.missing.join('，'));
  }
  const outOfRange = diff.extra.filter((entry) => entry.reason === 'out-of-range').map((entry) => entry.version);
  const unpublished = diff.extra.filter((entry) => entry.reason === 'unpublished').map((entry) => entry.version);
  if (outOfRange.length > 0) {
    lines.push('矩阵里有区间外的版本：' + outOfRange.join('，') + '（engines.dsh = ' + range + '）');
  }
  if (unpublished.length > 0) {
    lines.push(
      '矩阵里有区间内但尚未发布的版本：' + unpublished.join('，') +
        '（宿主还没发这个版本，先别预填格：等 registry 上出现它，再人工加格跑一次）',
    );
  }
  return lines;
}

/** 从 registry 取 @deepseek-ai/dsh 的全部已发布版本；取不到时返回 null。 */
async function fetchPublished() {
  const response = await fetch('https://registry.npmjs.org/@deepseek-ai%2Fdsh', {
    headers: { accept: 'application/vnd.npm.install-v1+json' },
  }).catch(() => null);
  if (response === null || !response.ok) return null;
  const body = await response.json();
  return Object.keys(body.versions ?? {});
}

/** 从 ci.yml 里抠出 compat job 的 dsh 矩阵（只认缩进 10 格的 `- 'x'` 行）。 */
async function readCiMatrix() {
  const text = await readFile(join(root, '.github/workflows/ci.yml'), 'utf8');
  const lines = text.split('\n');
  const start = lines.findIndex((line) => /^        dsh:\s*$/.test(line));
  if (start < 0) throw new Error('ci.yml 里找不到 compat 的 dsh 矩阵（期望缩进 8 格的 "dsh:" 行）');
  const versions = [];
  for (const line of lines.slice(start + 1)) {
    const match = /^          - '([^']+)'\s*$/.exec(line);
    if (match === null) break;
    versions.push(match[1]);
  }
  return versions;
}

/**
 * 脚本主体。
 *
 * 为什么包成函数而不是顶层裸跑：本文件 export 的纯函数要被 `test/matrix-range.test.mjs`
 * import。顶层裸跑会让**一次 import** 就产生副作用——打 registry、打印版本表、甚至
 * `process.exit(0)` 把跑测试的进程直接掐掉。副作用必须挂在「本文件被直接执行」这个条件上。
 */
async function main() {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const range = pkg.engines?.dsh;
  if (typeof range !== 'string') throw new Error('package.json 没有 engines.dsh：兼容区间是发布承诺，必须写');

  const published = (await fetchPublished()) ?? KNOWN_PUBLISHED;
  const expected = published.filter((version) => satisfiesRange(version, range));

  if (!CHECK) {
    console.log('engines.dsh = ' + range);
    console.log('registry 版本数：' + published.length + '（来源：' + (published === KNOWN_PUBLISHED ? '离线常量' : 'registry') + '）');
    console.log('区间内版本（' + expected.length + '）：');
    for (const version of expected) console.log('  ' + version);
    return 0;
  }

  const matrix = await readCiMatrix();
  const diff = classifyMatrixDiff({ expected, matrix, range, published });
  const problems = describeMatrixDiff(diff, range);
  if (problems.length > 0) {
    console.error('compat 矩阵与 engines.dsh 不一致：\n');
    for (const problem of problems) console.error('  ✗ ' + problem + '\n');
    return 1;
  }
  console.log('compat 矩阵覆盖 engines.dsh 区间内全部 ' + expected.length + ' 个版本 ✓');
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(await main());
}
