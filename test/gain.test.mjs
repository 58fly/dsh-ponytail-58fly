/**
 * `/ponytail-gain` 的文案与排版测试（票 07）。
 *
 * 测的是纯函数 `renderGain`：不搭宿主、不碰统计层内部，只喂一份快照看输出。
 * 三条硬要求：空态说清「还没开始计数」、预估永远带「基准推算」与出处、
 * 全仓不出现「你省了」。最后一条在这里用 readFile 直接扫，比 grep 更早红。
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { renderGain } from '../lib/commands/gain.js';

/** 造一份「已开始计数」的快照。 */
function snapshot(overrides = {}) {
  return {
    version: 1,
    managedTurns: 128,
    injections: 96,
    injectedBytes: 24576,
    turnsByMode: { off: 12, lite: 38, full: 71, ultra: 7 },
    modeSwitches: 7,
    commandCalls: 3,
    firstAt: Date.parse('2026-11-08T10:47:00Z'),
    lastAt: Date.parse('2026-11-08T11:04:00Z'),
    revision: 42,
    ...overrides,
  };
}

test('有数据时输出主数字、注入率、四档分布与基准三行', () => {
  const text = renderGain(snapshot());
  assert.match(text, /受管轮次 128/);
  assert.match(text, /注入 96（75%）/);
  assert.match(text, /切档 7 次/);
  assert.match(text, /命令调用 3 次/);
  assert.match(text, /注入字节 24\.0 KB/);
  for (const mode of ['off', 'lite', 'full', 'ultra']) assert.match(text, new RegExp('\\b' + mode + '\\b'));
  assert.match(text, /比没用 ponytail 的情况（基准推算）/);
  assert.match(text, /输出 token/);
  assert.match(text, /这是上游基准，不是本机测量。/);
  assert.match(text, /benchmarks\/results\/2026-10-07-agentic\.md/);
  assert.match(text, /面板里有图形版：设置 → Ponytail → 效率统计。/);
});

test('预估区间跟着非 off 轮次走：128 轮里 12 轮 off → 基数 116', () => {
  const text = renderGain(snapshot());
  assert.match(text, /推算基数：116 个非 off 轮次/);
  // 比例直接来自基准表：-0.45 → -45%；区间 -54%..-35%
  assert.match(text, /约 -45%/);
  assert.match(text, /\[-54%, -35%\]/);
});

test('零数据走空态，且明说没有可推算的量', () => {
  const text = renderGain(snapshot({ managedTurns: 0, injections: 0, injectedBytes: 0, modeSwitches: 0, commandCalls: 0, turnsByMode: { off: 0, lite: 0, full: 0, ultra: 0 }, firstAt: null, lastAt: null, revision: 0 }));
  assert.match(text, /本机运行期累计：还没开始计数/);
  assert.match(text, /发一条消息就会开始记/);
  assert.match(text, /还没有非 off 档位的轮次/);
  assert.doesNotMatch(text, /受管轮次 /);
});

test('全 off 档不算进推算基数，也不会出现负数级推算', () => {
  const text = renderGain(snapshot({ managedTurns: 5, turnsByMode: { off: 5, lite: 0, full: 0, ultra: 0 } }));
  assert.match(text, /还没有非 off 档位的轮次/);
});

test('文案里不出现「你省了」这类可疑表述', async () => {
  const text = await readFile(new URL('../src/commands/gain.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(text, /你省了/);
  assert.doesNotMatch(text, /自动更新/);
});
