/**
 * 归因纯函数的单元测试（票 01 验收项之一）。
 *
 * 归因与 `diagnose()` 是两条链：归因读的是「三层各自处于什么状态」，
 * 渲染只消费它的结果，不再回头读诊断报告里的 `state`。两条链必须对同一份
 * 快照给出相同的生效值——最后一条哨兵测试钉住这件事。
 *
 * 归因让 patch 层按**取值域**自己判合法性，是对既有判据缺陷的渲染层防御：
 * 用户写 `bogus`、组合层又是 `full` 时，照抄诊断报告的 `hit` 会显示一个
 * 不存在的档位「生效了」。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_MODE, RUNTIME_MODES } from '../lib/l0/mode.js';
import { diagnose } from '../lib/l0/diagnosis.js';
import { attribute } from '../lib/client/attribution.js';

/** 只看状态，让断言读起来像句子。 */
const states = (attribution) => Object.fromEntries(attribution.levels.map((item) => [item.level, item.state]));

/** 按层名取一层。 */
const level = (attribution, name) => attribution.levels.find((item) => item.level === name);

test('三层恒在、顺序恒 环境变量 → 配置文件 → 内置默认值', () => {
  const attribution = attribute(diagnose({}));
  assert.deepEqual(
    attribution.levels.map((item) => item.level),
    ['env', 'patch', 'fallback'],
  );
  assert.deepEqual(
    attribution.levels.map((item) => item.label),
    ['环境变量', '配置文件', '内置默认值'],
  );
});

test('空快照：三层齐全、不抛，答案落进内置默认值', () => {
  const attribution = attribute(diagnose({}));
  assert.deepEqual(states(attribution), { env: 'unknown', patch: 'past', fallback: 'hit' });
  assert.equal(attribution.effective, DEFAULT_MODE);
  assert.equal(attribution.from, 'fallback');
});

test('用户写了非法值 + 组合层有合法值：判非法，不照抄诊断报告的命中', () => {
  const diagnosis = diagnose({ value: { defaultMode: 'full' }, base: { defaultMode: 'full' }, user: { defaultMode: 'bogus' } });
  // 诊断报告在这一份输入上（修复前）会把补丁层报成 hit；归因不许跟着错。
  const attribution = attribute(diagnosis);
  assert.equal(level(attribution, 'patch').state, 'invalid');
  assert.equal(level(attribution, 'fallback').state, 'hit');
  assert.equal(attribution.effective, 'full');
  assert.equal(attribution.from, 'fallback');
});

test('非法值原样露出，只是被判成非法', () => {
  const attribution = attribute(diagnose({ user: { defaultMode: 'bogus' } }));
  assert.equal(level(attribution, 'patch').state, 'invalid');
  assert.equal(level(attribution, 'patch').value, 'bogus');
});

test('env 命中时，答案不再往下走：写了值的补丁层判「写了没赢」，兜底没轮到', () => {
  const attribution = attribute(diagnose({ value: { defaultMode: 'ultra' }, base: { defaultMode: 'full' }, user: { defaultMode: 'lite' } }));
  assert.deepEqual(states(attribution), { env: 'hit', patch: 'miss', fallback: 'past' });
  assert.equal(attribution.effective, 'ultra');
  assert.equal(attribution.from, 'env');
  // 「写了却没赢」要留着：它才是用户最需要看见的那一条。
  assert.equal(level(attribution, 'patch').value, 'lite');
});

test('env 不可观测且配置文件没写值：落进内置默认值并命中', () => {
  const attribution = attribute(diagnose({}));
  assert.equal(level(attribution, 'fallback').state, 'hit');
  assert.equal(attribution.from, 'fallback');
});

test('配置文件写了合法值但没赢：判「写了没赢」', () => {
  const attribution = attribute(diagnose({ value: { defaultMode: 'ultra' }, user: { defaultMode: 'lite' } }));
  assert.equal(level(attribution, 'patch').state, 'miss');
  assert.equal(level(attribution, 'patch').value, 'lite');
  assert.equal(attribution.from, 'env');
});

test('非法不阻断扫描：不可观测 + 非法 + 命中是合法组合', () => {
  const attribution = attribute(diagnose({ user: { defaultMode: 'bogus' } }));
  assert.deepEqual(states(attribution), { env: 'unknown', patch: 'invalid', fallback: 'hit' });
});

test('配置文件命中时兜底没轮到，不是被覆盖', () => {
  const attribution = attribute(diagnose({ user: { defaultMode: 'full' }, value: { defaultMode: 'full' } }));
  assert.deepEqual(states(attribution), { env: 'unknown', patch: 'hit', fallback: 'past' });
  assert.equal(attribution.from, 'patch');
});

test('归因的档位取值域与 mode.ts 同源', () => {
  // 归因按取值域自判合法性，判据必须就是 `RUNTIME_MODES`，不能另抄一份。
  for (const mode of RUNTIME_MODES) {
    const attribution = attribute(diagnose({ user: { defaultMode: mode }, value: { defaultMode: mode } }));
    assert.equal(level(attribution, 'patch').state, 'hit');
  }
});

test('哨兵：归因与诊断报告对同一份快照给出相同生效值', () => {
  const snapshots = [
    {},
    { value: { defaultMode: 'full' }, base: { defaultMode: 'full' } },
    { value: { defaultMode: 'ultra' }, base: { defaultMode: 'full' }, user: { defaultMode: 'lite' } },
    { value: { defaultMode: 'full' }, base: { defaultMode: 'full' }, user: { defaultMode: 'bogus' } },
    { user: { defaultMode: 'bogus' }, value: { defaultMode: 'full' } },
    { user: { defaultMode: 'ultra' }, base: { defaultMode: 'lite' } },
    { user: { defaultMode: '   ' }, base: { defaultMode: 'lite' }, value: { defaultMode: 'full' } },
  ];
  for (const snapshot of snapshots) {
    const diagnosis = diagnose(snapshot);
    const attribution = attribute(diagnosis);
    assert.equal(attribution.effective, diagnosis.effective, JSON.stringify(snapshot));
    // 命中的那一层只可能有一层，且它的值就是生效值。
    const hits = attribution.levels.filter((item) => item.state === 'hit');
    assert.equal(hits.length, 1, JSON.stringify(snapshot));
    assert.equal(hits[0].value, diagnosis.effective, JSON.stringify(snapshot));
    assert.equal(attribution.from, hits[0].level, JSON.stringify(snapshot));
  }
});
