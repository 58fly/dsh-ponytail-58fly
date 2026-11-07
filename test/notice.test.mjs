/**
 * 单通知幂等的单测（#07 验收项：4 档切换后当轮 reminder 正确、不累积、不重复）。
 *
 * 幂等的对象是 `decision.messages`——**本步要送进模型的批次**，不是会话历史。
 * 四条用例分别覆盖：追加、原位替换、移除、拒绝步不碰。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MODE_UPDATE_KIND, applyModeUpdate, createModeUpdateMessage } from '../lib/prompt/notice.js';

/** 一条普通用户消息，用来当"批次里原有的东西"。 */
const plain = (text) => ({ id: 'm-' + text, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } });

/** 造一个 enter 决定。 */
const enter = (...messages) => ({ kind: 'enter', messages });

test('批次里没有旧通知时：追加一条', () => {
  const message = createModeUpdateMessage('lite', 'full', '正文');
  const result = applyModeUpdate(enter(plain('问题')), message);
  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[0].id, 'm-问题');
  assert.equal(result.messages[1].source.kind, MODE_UPDATE_KIND);
});

test('批次里已有旧通知时：原位替换，不累积', () => {
  const first = createModeUpdateMessage('lite', 'full', '第一次');
  const second = createModeUpdateMessage('ultra', 'lite', '第二次');
  const once = applyModeUpdate(enter(plain('问题')), first);
  const twice = applyModeUpdate(once, second);
  assert.equal(twice.messages.length, 2, '同一步里出现了两条通知');
  assert.equal(twice.messages[1].content[0].text, '第二次');
  assert.equal(twice.messages[1].source.mode, 'ultra');
});

test('不需要通知时（update 为 null）：把批次里的残留剔掉', () => {
  const message = createModeUpdateMessage('lite', 'full', '正文');
  const withNotice = applyModeUpdate(enter(plain('问题')), message);
  const cleaned = applyModeUpdate(withNotice, null);
  assert.deepEqual(cleaned.messages.map((item) => item.id), ['m-问题']);
});

test('不需要通知且批次干净时：内容不变', () => {
  const result = applyModeUpdate(enter(plain('问题')), null);
  assert.deepEqual(result.messages.map((item) => item.id), ['m-问题']);
});

test('downstream 拒绝这一步时：无条件原样返回', () => {
  const message = createModeUpdateMessage('lite', 'full', '正文');
  const rejected = { kind: 'reject' };
  assert.equal(applyModeUpdate(rejected, message), rejected);
  assert.equal(applyModeUpdate(rejected, null), rejected);
});

test('通知消息的形状：user 角色 + text 块 + 带 mode 的 source', () => {
  const message = createModeUpdateMessage('ultra', 'lite', '正文');
  assert.equal(message.role, 'user');
  assert.equal(message.content.length, 1);
  assert.equal(message.content[0].type, 'text');
  assert.equal(message.content[0].text, '正文');
  assert.deepEqual(message.source, { kind: MODE_UPDATE_KIND, mode: 'ultra', previousMode: 'lite' });
  assert.equal(typeof message.id, 'string');
  assert.ok(message.id.length > 0);
});

test('两次造消息得到不同 id（否则宿主会把它们当成同一条）', () => {
  const a = createModeUpdateMessage('lite', 'full', '正文');
  const b = createModeUpdateMessage('lite', 'full', '正文');
  assert.notEqual(a.id, b.id);
});
