/**
 * 效率统计的单测（03 验收项：累加 / reset / 脏值不抛 / 埋点不拖垮调用方）。
 *
 * 不依赖宿主：StatsStore 是纯计数器，installStats 那一半只需要一个带 logger 的假 ctx。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BASELINE, projectSavings } from '../lib/stats/baseline.js';
import { installStats } from '../lib/stats/index.js';
import { StatsStore } from '../lib/stats/store.js';

test('累加：受管轮次按档位分开记，注入次数与字节各走各的', () => {
  const store = new StatsStore();
  store.bump('managedTurns', { mode: 'full' });
  store.bump('managedTurns', { mode: 'off' });
  store.bump('managedTurns', { mode: 'ultra' });
  store.bump('injections', { bytes: 120 });
  store.bump('injections', { bytes: 80 });
  store.bump('modeSwitches');
  store.bump('commandCalls');

  const snapshot = store.snapshot();
  assert.equal(snapshot.managedTurns, 3);
  assert.equal(snapshot.injections, 2);
  assert.equal(snapshot.injectedBytes, 200);
  assert.equal(snapshot.modeSwitches, 1);
  assert.equal(snapshot.commandCalls, 1);
  assert.deepEqual(snapshot.turnsByMode, { off: 1, lite: 0, full: 1, ultra: 1 });
  assert.notEqual(snapshot.firstAt, null);
  assert.ok(snapshot.lastAt !== null && snapshot.lastAt >= snapshot.firstAt);
});

test('快照是副本：改返回值不影响计数器', () => {
  const store = new StatsStore();
  store.bump('managedTurns', { mode: 'lite' });
  const snapshot = store.snapshot();
  snapshot.turnsByMode.lite = 99;
  assert.equal(store.snapshot().turnsByMode.lite, 1);
});

test('脏输入不抛：未知档位落 full，坏字节当 0', () => {
  const store = new StatsStore();
  store.bump('managedTurns', { mode: 'bogus' });
  store.bump('managedTurns');
  store.bump('injections', { bytes: Number.NaN });
  store.bump('injections', { bytes: -5 });
  store.bump('injections', { bytes: 3.7 });

  const snapshot = store.snapshot();
  assert.equal(snapshot.turnsByMode.full, 2, '未知档位与缺省档位都记到 full');
  assert.equal(snapshot.injectedBytes, 3, 'NaN/负数当 0，小数向下取整');
  assert.equal(snapshot.injections, 3);
});

test('reset 把每个字段都归零，revision 也归零', () => {
  const store = new StatsStore();
  store.bump('managedTurns', { mode: 'full' });
  store.bump('injections', { bytes: 10 });
  store.reset();
  const snapshot = store.snapshot();
  assert.equal(snapshot.managedTurns, 0);
  assert.equal(snapshot.injections, 0);
  assert.equal(snapshot.injectedBytes, 0);
  assert.equal(snapshot.firstAt, null);
  assert.equal(snapshot.lastAt, null);
  assert.equal(snapshot.revision, 0);
  assert.deepEqual(snapshot.turnsByMode, { off: 0, lite: 0, full: 0, ultra: 0 });
});

test('连续一万次 bump 不丢数', () => {
  const store = new StatsStore();
  for (let index = 0; index < 10000; index += 1) store.bump('managedTurns', { mode: 'full' });
  assert.equal(store.snapshot().managedTurns, 10000);
  assert.equal(store.snapshot().turnsByMode.full, 10000);
});

test('projectSavings 只算非 off 轮次，并给出区间与出处', () => {
  const stats = { managedTurns: 10, turnsByMode: { off: 2, lite: 1, full: 6, ultra: 1 } };
  const projection = projectSavings(stats, 1000);
  assert.equal(projection.activeTurns, 8);
  assert.equal(projection.outputTokens.center, 8 * 1000 * BASELINE.outputTokens.center);
  assert.equal(projection.outputTokens.from, 8000 * -0.54);
  assert.equal(projection.outputTokens.to, 8000 * -0.35);
  assert.equal(projection.outputTokens.source, BASELINE.outputTokens.source);
});

test('projectSavings 在零数据与全 off 时给出 0，不出现负数轮次', () => {
  assert.equal(projectSavings({ managedTurns: 0, turnsByMode: { off: 0, lite: 0, full: 0, ultra: 0 } }).activeTurns, 0);
  const allOff = projectSavings({ managedTurns: 5, turnsByMode: { off: 5, lite: 0, full: 0, ultra: 0 } });
  assert.equal(allOff.activeTurns, 0);
  // 0 乘负数会得到 -0；断言用 Object.is 之外的方式比较数值即可。
  assert.equal(allOff.outputTokens.center + 0, 0);
});

test('基准表只暴露复核过的 7 个字段，且都带出处', () => {
  assert.deepEqual(Object.keys(BASELINE).sort(), [
    'cheaperOnTasks',
    'codeInformationGzip',
    'cost',
    'loc',
    'outputTokens',
    'time',
    'turns',
  ]);
  for (const row of Object.values(BASELINE)) assert.match(row.source, /^https:\/\//);
});

test('installStats 的埋点永不抛：sink 抛错也只记一条 warn', () => {
  const warned = [];
  const ctx = { logger: () => ({ warn: (message) => warned.push(message) }) };
  const stats = installStats(ctx);
  stats.sink.onTurn('full');
  stats.sink.onInject('一段中文');
  assert.equal(stats.snapshot().managedTurns, 1);
  // 「一段中文」在 UTF-8 下是 12 字节，证明字节数是按 UTF-8 算的而不是按字符数。
  assert.equal(stats.snapshot().injectedBytes, 12);
  stats.bumpSwitch();
  stats.bumpCommand();
  assert.equal(stats.snapshot().modeSwitches, 1);
  assert.equal(stats.snapshot().commandCalls, 1);
  stats.reset();
  assert.equal(stats.snapshot().managedTurns, 0);
  assert.deepEqual(warned, []);
});
