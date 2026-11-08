/**
 * 宿主区间判定与矩阵差异判定的纯函数单测。
 *
 * 为什么要单独测这两件事：`engines.dsh` 是**对用户的兼容承诺**，矩阵是「承诺的每一格
 * 都真跑过」的证据。两者之间的判定（谁在区间内、矩阵差哪几格）一旦错了，坏法有两种，
 * 且都不会自己暴露：
 *
 *   区间上界写错 → 装得上但宿主没测过（或反之，装不上）；
 *   差异判定只报 missing 不报 extra → 矩阵里预填了还没发布的版本也没人发现。
 *
 * 判定的实现是 `scripts/dsh-matrix.mjs` 里 export 的纯函数，不起网络、不读文件，
 * 所以这里可以直接 import 断言（与 `test/l0.test.mjs` 同一形态）。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { classifyMatrixDiff, satisfiesRange } from '../scripts/dsh-matrix.mjs';

/** 当前仓库承诺的区间。0.3.0 线要等宿主真发版实测过再抬，所以上界停在 0.3.0-0。 */
const RANGE = '>=0.2.0-rc.1 <0.3.0-0';

test('satisfiesRange：0.2 线全部版本在内（含未发布的未来 patch/minor）', () => {
  for (const version of [
    '0.2.0-rc.1',
    '0.2.0',
    '0.2.1-rc.5',
    '0.2.2-rc.1',
    '0.2.2',
    '0.2.3',
    '0.2.99',
  ]) {
    assert.equal(satisfiesRange(version, RANGE), true, version + ' 应在上界内');
  }
});

test('satisfiesRange：0.3 线一律在外，0.3.0-0 也不例外', () => {
  for (const version of ['0.3.0-0', '0.3.0', '0.3.0-rc.1', '0.3.1', '1.0.0']) {
    assert.equal(satisfiesRange(version, RANGE), false, version + ' 应被上界挡住');
  }
});

test('satisfiesRange：下界以下的预发布版本在外', () => {
  for (const version of ['0.1.9', '0.2.0-alpha.1', '0.2.0-rc.0']) {
    assert.equal(satisfiesRange(version, RANGE), false, version + ' 应低于下界');
  }
});

test('classifyMatrixDiff：漏格进 missing，多格进 extra，且 extra 带成因判定', () => {
  const expected = ['0.2.0-rc.1', '0.2.1-rc.1', '0.2.2-rc.1'];
  const matrix = ['0.2.0-rc.1', '0.2.2-rc.1', '0.3.0'];

  const diff = classifyMatrixDiff({ expected, matrix, range: RANGE });

  assert.deepEqual(diff.missing, ['0.2.1-rc.1']);
  assert.deepEqual(
    diff.extra.map((entry) => entry.version),
    ['0.3.0'],
  );
  // 0.3.0 落在区间外 → 成因是「超出了 engines.dsh 区间」
  assert.equal(diff.extra[0].reason, 'out-of-range');
});

test('classifyMatrixDiff：区间内但尚未发布的预填格单独成一种成因', () => {
  // 0.2.5 在区间内，但 registry 里还没有它 —— 这正是「宿主没发，先别预填格」的场景。
  const diff = classifyMatrixDiff({
    expected: ['0.2.0-rc.1'],
    matrix: ['0.2.0-rc.1', '0.2.5'],
    range: RANGE,
    published: ['0.2.0-rc.1', '0.2.1-rc.1', '0.2.2-rc.1'],
  });

  assert.deepEqual(diff.missing, []);
  assert.deepEqual(
    diff.extra.map((entry) => entry.version),
    ['0.2.5'],
  );
  assert.equal(diff.extra[0].reason, 'unpublished');
});

test('classifyMatrixDiff：完全一致时两组都空', () => {
  const expected = ['0.2.0-rc.1', '0.2.2-rc.1'];
  const diff = classifyMatrixDiff({ expected, matrix: [...expected], range: RANGE });
  assert.deepEqual(diff.missing, []);
  assert.deepEqual(diff.extra, []);
  assert.equal(diff.ok, true);
});
