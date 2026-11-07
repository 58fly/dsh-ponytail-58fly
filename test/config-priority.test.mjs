/**
 * 配置优先级链的单元测试（#04 验收项之二：三条来源各设一次，诊断正确标 hit 与 shadowed）。
 *
 * resolvePriority 是纯函数，所以这里不需要起 Cordis 上下文——这是 L1 分层的直接好处：
 * 诊断逻辑可以脱离宿主被完整证明。真正需要宿主的只有「写入」那半，在
 * config-runtime.test.mjs 里。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PRIORITY_LEVELS } from '../lib/l0/mode.js';
import { resolvePriority } from '../lib/config/priority.js';

/** 取某一层。 */
const level = (report, name) => report.chain.find((item) => item.level === name);

test('诊断链恒 3 项，顺序恒 env → patch → fallback', () => {
  // 「恒 3 项」是本模块的核心契约：面板按数组下标画三行，少一项就会错位。
  // 空输入是最容易被优化成「只报有值的层」的路径，所以先钉死它。
  const report = resolvePriority({});
  assert.equal(report.chain.length, 3);
  assert.deepEqual(
    report.chain.map((item) => item.level),
    [...PRIORITY_LEVELS],
  );
});

test('每层都带 label / location / value / hit / shadowed / problem 六个字段', () => {
  // 面板需要的全部字段，多一个都没用，少一个就得在客户端里补推导。
  const report = resolvePriority({ env: 'lite' });
  for (const item of report.chain) {
    assert.deepEqual(Object.keys(item).sort(), [
      'hit', 'label', 'level', 'location', 'problem', 'shadowed', 'value',
    ]);
    assert.equal(typeof item.label, 'string');
    assert.equal(typeof item.location, 'string');
    assert.equal(typeof item.hit, 'boolean');
    assert.equal(typeof item.shadowed, 'boolean');
  }
});

test('env 生效：patch 有合法值时标 shadowed 与 hit=false', () => {
  // 这是「为什么我改了没用」的典型现场：用户改了 Profile 补丁，但有环境变量压着。
  const report = resolvePriority({ env: 'ultra', patch: 'lite' });
  assert.equal(report.effective, 'ultra');
  assert.deepEqual([level(report, 'env').hit, level(report, 'env').shadowed], [true, false]);
  assert.deepEqual([level(report, 'patch').hit, level(report, 'patch').shadowed], [false, true]);
  assert.equal(level(report, 'patch').value, 'lite');
  assert.equal(level(report, 'patch').problem, null);
});

test('patch 生效：env 未设置时 hit=false 但 shadowed 也必须为 false', () => {
  // 上游缺陷修正点：上游写 shadowed = winner < i，于是 fallback 生效时
  // 没配的层也被标成「被盖住」，面板会告诉用户「你配了但被盖住了」，而用户压根没配。
  // 这里要求只有真有合法值才 shadowed。
  const report = resolvePriority({ patch: 'lite' });
  assert.equal(report.effective, 'lite');
  const env = level(report, 'env');
  assert.equal(env.hit, false);
  assert.equal(env.shadowed, false, '没配的层不得标 shadowed');
  assert.equal(env.value, null);
  assert.equal(env.problem, null);
});

test('fallback 生效：前两层都为 present:false 且都不 shadowed', () => {
  const report = resolvePriority({});
  assert.equal(report.effective, 'full');
  assert.equal(level(report, 'fallback').hit, true);
  assert.equal(level(report, 'fallback').value, 'full');
  for (const name of ['env', 'patch']) {
    const item = level(report, name);
    assert.equal(item.hit, false);
    assert.equal(item.shadowed, false);
    assert.equal(item.problem, null);
  }
});

test('非法 env 值：记 problem、不参与竞争、patch 上位', () => {
  // 「值无效，已忽略」与「被盖住」的修复动作完全不同：前者改值，后者删上层。
  // 注意 'ULTRA' 不是非法值——coerceMode 会归一大小写，那是另一条测试。
  const report = resolvePriority({ env: 'turbo', patch: 'lite' });
  assert.equal(report.effective, 'lite');
  const env = level(report, 'env');
  assert.equal(env.hit, false);
  assert.equal(env.shadowed, false, 'problem 与 shadowed 互斥');
  assert.match(env.problem, /值无效，已忽略/);
  assert.equal(env.value, 'turbo', '原样报告用户写的东西，便于对照');
});

test('非法 patch 值：problem 落在 patch 层，effective 落到 fallback', () => {
  const report = resolvePriority({ patch: 'medium' });
  assert.equal(report.effective, 'full');
  assert.match(level(report, 'patch').problem, /值无效，已忽略/);
  assert.equal(level(report, 'fallback').hit, true);
});

test('大小写与空白被 coerceMode 吸收，仍然算合法', () => {
  // 归一化只有一处入口（L0 coerceMode），诊断链看到的值是归一后的。
  assert.equal(resolvePriority({ env: '  LITE  ' }).effective, 'lite');
  assert.equal(level(resolvePriority({ env: '  LITE  ' }), 'env').value, 'lite');
});

test('空白字符串按未设置处理，与 L0 的 env 语义一致', () => {
  // PONYTAIL_DEFAULT_MODE= 是「清空」，不是「配了个空档位」。
  for (const raw of ['', '   ', '\t\n']) {
    const report = resolvePriority({ env: raw, patch: 'lite' });
    assert.equal(report.effective, 'lite');
    assert.equal(level(report, 'env').value, null);
    assert.equal(level(report, 'env').problem, null, '空白不是非法值，是没设置');
  }
});

test('非字符串原文不崩，且被记为非法', () => {
  // 上游在这里 String() 强转，于是 undefined 变成字面量 "undefined"。
  // 我们只认 coerceMode 的 unknown 入口：非字符串一律 mode=null。
  for (const raw of [42, true, { defaultMode: 'lite' }, ['lite']]) {
    const report = resolvePriority({ env: raw, patch: 'lite' });
    assert.equal(report.effective, 'lite');
    assert.equal(level(report, 'env').hit, false);
    assert.match(level(report, 'env').problem, /值无效，已忽略/);
  }
});

test('rejected 并进 patch 层的 problem，不覆盖已有的非法说明', () => {
  // 「写下去了但被宿主拒了」是「改了没生效」的最常见成因，必须能被面板看见。
  const only = resolvePriority({ patch: 'lite', rejected: '版本冲突' });
  assert.match(level(only, 'patch').problem, /版本冲突/);
  const both = resolvePriority({ patch: 'bogus', rejected: '版本冲突' });
  assert.match(level(both, 'patch').problem, /值无效，已忽略；版本冲突/);
});

test('rejected 只影响 patch 层，不污染 env 与 fallback', () => {
  const report = resolvePriority({ rejected: '版本冲突' });
  assert.equal(level(report, 'env').problem, null);
  assert.equal(level(report, 'fallback').problem, null);
});

test('effective 恒为合法档位（四档之一）', () => {
  // 兜底层恒有值，所以这条永不落空；写这条是为了防止将来有人「优化」掉兜底。
  const inputs = [{}, { env: 'off' }, { env: 'nope', patch: 'nope' }, { patch: 'ultra' }, { env: 0, patch: null }];
  for (const input of inputs) {
    assert.match(resolvePriority(input).effective, /^(off|lite|full|ultra)$/);
  }
});
