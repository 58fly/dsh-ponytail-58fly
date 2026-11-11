/** 效率卡三处换算的单测（票 02）：堆叠条比例、`−60%…0` 轴投影、区间条两端排序。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BAND_MAX, BAND_MIN, axisPercent, bandRow, modeSlices } from '../lib/client/mini.js';

test('堆叠条按真实比例分段，总和为 100', () => {
  const slices = modeSlices({ off: 12, lite: 38, full: 71, ultra: 7 });
  assert.deepEqual(
    slices.map((slice) => slice.mode),
    ['off', 'lite', 'full', 'ultra'],
  );
  const sum = slices.reduce((acc, slice) => acc + slice.share, 0);
  assert.ok(Math.abs(sum - 100) < 1e-9, `总和应为 100，实得 ${String(sum)}`);
  assert.ok(Math.abs(slices[2].share - (71 / 128) * 100) < 1e-9);
});

test('堆叠条顺序不随数值大小变：off 永远在第一位', () => {
  const slices = modeSlices({ off: 1, lite: 0, full: 99, ultra: 0 });
  assert.deepEqual(
    slices.map((slice) => slice.mode),
    ['off', 'lite', 'full', 'ultra'],
  );
});

test('四档总和为 0 时返回空数组，不留零宽段', () => {
  assert.deepEqual(modeSlices({ off: 0, lite: 0, full: 0, ultra: 0 }), []);
});

test('负数脏值按 0 计，不让某一段画出负宽度', () => {
  const slices = modeSlices({ off: -5, lite: 10, full: 0, ultra: 0 });
  assert.equal(slices[0].share, 0);
  assert.equal(slices[1].share, 100);
});

test('轴投影：−60% 落在 0，0 落在 100，−30% 落在正中', () => {
  assert.equal(BAND_MIN, -60);
  assert.equal(BAND_MAX, 0);
  assert.equal(axisPercent(-0.6), 0);
  assert.equal(axisPercent(0), 100);
  assert.equal(axisPercent(-0.3), 50);
});

test('轴投影夹住越界值，条不会画到格子外', () => {
  assert.equal(axisPercent(-5), 0);
  assert.equal(axisPercent(0.4), 100);
});

test('区间条把两端排成 [小, 大]，宽度不会是负数', () => {
  const row = bandRow('成本', -0.26, [-0.36, -0.16]);
  assert.deepEqual(row.band, [axisPercent(-0.36), axisPercent(-0.16)]);
  assert.equal(row.center, axisPercent(-0.26));
  assert.ok(row.band[0] < row.band[1]);
});

test('两端颠倒时仍然排好序', () => {
  const row = bandRow('耗时', -0.41, [-0.32, -0.49]);
  assert.deepEqual(row.band, [axisPercent(-0.49), axisPercent(-0.32)]);
});

test('没有区间时只留中点', () => {
  const row = bandRow('轮次', -0.22, null);
  assert.equal(row.band, null);
  assert.equal(row.center, axisPercent(-0.22));
});
