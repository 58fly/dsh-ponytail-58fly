/**
 * 客户端诊断链的单元测试（#05 验收项之一：面板能显示诊断链并指出被覆盖的那一层）。
 *
 * `diagnose` 是纯函数、零 IO、零 node:，所以不需要起 Cordis 上下文——这是把它
 * 放在 `l0` 的直接回报：浏览器侧那条链可以脱离宿主被完整证明。
 *
 * 最后一条哨兵测试钉住 `l0/diagnosis.ts` 与 `config/priority.ts` 的四处字面量：
 * 两条链（服务端读原文算、客户端按值归属反推）必须说同一套话，改一边漏一边就红。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_MODE, RUNTIME_MODES } from '../lib/l0/mode.js';
import {
  DIAGNOSIS_ENV_NAME,
  DIAGNOSIS_FALLBACK_LOCATION,
  DIAGNOSIS_INVALID_PROBLEM,
  DIAGNOSIS_PATCH_LOCATION,
  DIAGNOSIS_PATCH_SHADOWED,
  diagnose,
} from '../lib/l0/diagnosis.js';
import {
  FALLBACK_LOCATION,
  INVALID_PROBLEM,
  PATCH_LOCATION,
  PRIORITY_ENV_NAME,
} from '../lib/config/priority.js';

/** 按层名取一行。 */
const row = (diagnosis, level) => diagnosis.rows.find((item) => item.level === level);

/** 只看状态，让断言读起来像句子。 */
const states = (diagnosis) => Object.fromEntries(diagnosis.rows.map((item) => [item.level, item.state]));

test('三层恒在、顺序恒 env → patch → fallback', () => {
  // 面板按数组顺序画三行，少一行就错位；空快照是最容易被优化成「只报有值的层」的路径。
  const diagnosis = diagnose({});
  assert.equal(diagnosis.rows.length, 3);
  assert.deepEqual(diagnosis.rows.map((item) => item.level), ['env', 'patch', 'fallback']);
});

test('三段全空：兜底命中，补丁未设置，env 不可观测', () => {
  const diagnosis = diagnose({});
  assert.deepEqual(states(diagnosis), { env: 'unknown', patch: 'absent', fallback: 'hit' });
  assert.equal(diagnosis.effective, DEFAULT_MODE);
  assert.equal(diagnosis.overriddenBy, null);
  // 兜底行必须把值露出来，否则用户看不出「现在跑的是什么」。
  assert.equal(row(diagnosis, 'fallback').value, DEFAULT_MODE);
});

test('用户层写了 full：补丁命中，兜底被覆盖，env 仍不可观测', () => {
  const diagnosis = diagnose({ user: { defaultMode: 'full' }, value: { defaultMode: 'full' } });
  assert.deepEqual(states(diagnosis), { env: 'unknown', patch: 'hit', fallback: 'shadowed' });
  assert.equal(diagnosis.effective, 'full');
  assert.equal(diagnosis.overriddenBy, null);
  // 这一值来自用户层，不该出现「组合层」的注脚。
  assert.equal(row(diagnosis, 'patch').note, null);
});

test('组合层与用户层同值时：用户层赢，注脚不出组合层说明', () => {
  // user 的 PRESENCE 才是覆盖的判据（宿主注释原文），不是值比较。
  const diagnosis = diagnose({
    base: { defaultMode: 'lite' },
    user: { defaultMode: 'lite' },
    value: { defaultMode: 'lite' },
  });
  assert.equal(row(diagnosis, 'patch').state, 'hit');
  assert.equal(row(diagnosis, 'patch').value, 'lite');
});

test('只有组合层有值：补丁命中并注明来自组合层', () => {
  const diagnosis = diagnose({ base: { defaultMode: 'lite' }, value: { defaultMode: 'lite' } });
  assert.equal(row(diagnosis, 'patch').state, 'hit');
  assert.equal(row(diagnosis, 'patch').note, '这一值来自 profile 组合层，不是用户手写的。');
});

test('env 生效：生效值既不来自补丁也不来自兜底 → env 反推命中', () => {
  // 浏览器读不到 process.env，这是唯一能解释「生效值是 ultra、补丁层却没写」的路径。
  const diagnosis = diagnose({ value: { defaultMode: 'ultra' } });
  assert.deepEqual(states(diagnosis), { env: 'hit', patch: 'absent', fallback: 'shadowed' });
  assert.equal(diagnosis.effective, 'ultra');
  // 补丁层没写过值，就没有「被盖住的东西」：env 顶掉的是兜底，不该算成覆盖了补丁层。
  assert.equal(diagnosis.overriddenBy, null);
  // 反推出来的一行必须自证是反推，不能让用户以为是读到了真值。
  assert.match(row(diagnosis, 'env').note, /反推/);
});

test('组合层写了值但被 env 顶掉：补丁行被覆盖，指出是 env 干的', () => {
  const diagnosis = diagnose({ base: { defaultMode: 'lite' }, value: { defaultMode: 'ultra' } });
  assert.deepEqual(states(diagnosis), { env: 'hit', patch: 'shadowed', fallback: 'shadowed' });
  assert.equal(diagnosis.overriddenBy, 'env');
  assert.equal(row(diagnosis, 'patch').note, DIAGNOSIS_PATCH_SHADOWED);
});

test('用户层写了 lite 但 env 把值顶到 ultra：补丁被覆盖，指出是 env 干的', () => {
  const diagnosis = diagnose({ user: { defaultMode: 'lite' }, value: { defaultMode: 'ultra' } });
  assert.deepEqual(states(diagnosis), { env: 'hit', patch: 'shadowed', fallback: 'shadowed' });
  assert.equal(diagnosis.overriddenBy, 'env');
  assert.equal(row(diagnosis, 'patch').value, 'lite');
});

test('用户层写了非法值：标 invalid 并给统一说明，生效值回落到下一层', () => {
  const diagnosis = diagnose({ user: { defaultMode: 'turbofast' }, value: { defaultMode: DEFAULT_MODE } });
  assert.equal(row(diagnosis, 'patch').state, 'invalid');
  assert.equal(row(diagnosis, 'patch').value, 'turbofast');
  assert.equal(row(diagnosis, 'patch').note, DIAGNOSIS_INVALID_PROBLEM);
  assert.equal(diagnosis.effective, DEFAULT_MODE);
  assert.equal(row(diagnosis, 'fallback').state, 'hit');
});

test('大小写与空白按 coerceMode 归一，不额外放宽', () => {
  const diagnosis = diagnose({ user: { defaultMode: '  LITE  ' }, value: { defaultMode: 'lite' } });
  assert.equal(diagnosis.effective, 'lite');
  assert.equal(row(diagnosis, 'patch').state, 'hit');
});

test('空字符串按未设置处理，不当作非法值', () => {
  // 宿主把「没配」投影成缺键；手写 YAML 里留空则可能落成空串，两者语义相同。
  const diagnosis = diagnose({ user: { defaultMode: '   ' }, value: { defaultMode: DEFAULT_MODE } });
  assert.equal(row(diagnosis, 'patch').state, 'absent');
});

test('非字符串的字段值按非法处理并转成文本展示', () => {
  const diagnosis = diagnose({ user: { defaultMode: 42 }, value: { defaultMode: DEFAULT_MODE } });
  assert.equal(row(diagnosis, 'patch').state, 'invalid');
  assert.equal(row(diagnosis, 'patch').value, '42');
});

test('每一行都带齐六字段，且 label / location 非空', () => {
  const diagnosis = diagnose({ user: { defaultMode: 'lite' }, value: { defaultMode: 'lite' } });
  for (const item of diagnosis.rows) {
    assert.deepEqual(Object.keys(item).sort(), ['label', 'level', 'location', 'note', 'state', 'value']);
    assert.ok(item.label.length > 0);
    assert.ok(item.location.length > 0);
  }
});

test('effective 恒落在四档取值域内', () => {
  for (const mode of RUNTIME_MODES) {
    const diagnosis = diagnose({ value: { defaultMode: mode } });
    assert.ok(RUNTIME_MODES.includes(diagnosis.effective));
  }
});

test('哨兵：diagnosis 的四处字面量与 config/priority 逐字一致', () => {
  // 两条链说不同的话，用户在设置页与日志里会看到两套位置文案——这是最容易漏的漂移。
  assert.equal(DIAGNOSIS_ENV_NAME, PRIORITY_ENV_NAME);
  assert.equal(DIAGNOSIS_PATCH_LOCATION, PATCH_LOCATION);
  assert.equal(DIAGNOSIS_FALLBACK_LOCATION, FALLBACK_LOCATION);
  assert.equal(DIAGNOSIS_INVALID_PROBLEM, INVALID_PROBLEM);
});

test('回归 #05：用户层非法值 + 组合层有无害默认值 → 该行 invalid，非法值不被报成生效', () => {
  // 宿主投影：user 是用户在设置页/补丁里写的原文，base 是组合层的默认值。
  // 两者同时存在时，用户层的垃圾值必须判非法，而不是让组合层的值替它顶成 hit。
  const diagnosis = diagnose({
    base: { defaultMode: 'full' },
    user: { defaultMode: 'bogus' },
    value: { defaultMode: 'full' },
  });
  assert.deepEqual(states(diagnosis), { env: 'unknown', patch: 'invalid', fallback: 'hit' });
  assert.equal(row(diagnosis, 'patch').value, 'bogus');
  assert.equal(diagnosis.effective, 'full');
  // 补丁层自己写了值却没生效，`overriddenBy` 就指它；具体被谁顶掉看兜底行是 hit。
  assert.equal(diagnosis.overriddenBy, 'patch');
});

test('回归 #05：用户层与组合层都合法时值同源，不跨层拼接', () => {
  const diagnosis = diagnose({
    base: { defaultMode: 'lite' },
    user: { defaultMode: 'ultra' },
    value: { defaultMode: 'ultra' },
  });
  assert.deepEqual(states(diagnosis), { env: 'unknown', patch: 'hit', fallback: 'shadowed' });
  assert.equal(row(diagnosis, 'patch').value, 'ultra');
  assert.equal(row(diagnosis, 'patch').note, null);
});

test('回归 #05：用户层非法时，组合层的注脚不能被挪到用户层头上', () => {
  const diagnosis = diagnose({
    base: { defaultMode: 'lite' },
    user: { defaultMode: 'bogus' },
    value: { defaultMode: 'lite' },
  });
  assert.equal(row(diagnosis, 'patch').state, 'invalid');
  assert.equal(row(diagnosis, 'patch').note, DIAGNOSIS_INVALID_PROBLEM);
});
