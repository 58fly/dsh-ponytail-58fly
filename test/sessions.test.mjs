/**
 * 会话状态的单测（#07 验收项：baseline 终身不变）。
 *
 * 不依赖宿主：SessionStore 是纯容器，installSessionStore 那一半才需要 ctx。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SessionStore } from '../lib/state/sessions.js';

test('首次 ensure 用 resolve 定档，此后终身不变', () => {
  const store = new SessionStore();
  let calls = 0;
  const resolve = () => {
    calls += 1;
    return 'full';
  };
  const entry = store.ensure('s1', resolve);
  assert.equal(entry.baselineMode, 'full');
  // 之后的档位变化不影响 baseline：这正是"前缀不变"的来源。
  const again = store.ensure('s1', () => 'ultra');
  assert.equal(again.baselineMode, 'full');
  assert.equal(calls, 1, '已建档的会话不该再调 resolve');
});

test('announcedMode 初始等于 baselineMode（诞生时不额外发通知）', () => {
  const store = new SessionStore();
  const entry = store.ensure('s1', () => 'lite');
  assert.equal(entry.announcedMode, 'lite');
});

test('返回的是活引用：就地改 announcedMode 会被记住', () => {
  const store = new SessionStore();
  const entry = store.ensure('s1', () => 'full');
  entry.announcedMode = 'ultra';
  assert.equal(store.get('s1').announcedMode, 'ultra');
});

test('不同会话互不干扰', () => {
  const store = new SessionStore();
  store.ensure('s1', () => 'lite');
  store.ensure('s2', () => 'ultra');
  assert.equal(store.get('s1').baselineMode, 'lite');
  assert.equal(store.get('s2').baselineMode, 'ultra');
});

test('delete 之后重新建档会重新定档', () => {
  const store = new SessionStore();
  store.ensure('s1', () => 'lite');
  assert.equal(store.delete('s1'), true);
  assert.equal(store.delete('s1'), false);
  assert.equal(store.get('s1'), undefined);
  assert.equal(store.ensure('s1', () => 'ultra').baselineMode, 'ultra');
});

test('size 反映当前会话数', () => {
  const store = new SessionStore();
  assert.equal(store.size, 0);
  store.ensure('s1', () => 'full');
  assert.equal(store.size, 1);
  store.delete('s1');
  assert.equal(store.size, 0);
});
