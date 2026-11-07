/**
 * pre-step 接线单测（#07 验收项：断链测试、4 档切换后当轮 reminder 正确）。
 *
 * 这里不需要真的 Cordis：installModeReminder 只用到 `ctx.on` 与 `ctx.logger`，
 * 两个都能用十行假对象顶替。真正必须验证的是**行为**：
 * 1. downstream 拒绝时原样返回（不注入）；
 * 2. 档位没变时不发通知；
 * 3. 档位变了发一条，且只发一次；
 * 4. 任何一步抛错都回到原样，请求照常进行（不断链）。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { installModeReminder } from '../lib/prompt/prestep.js';
import { SessionStore } from '../lib/state/sessions.js';

/** 假 ctx：记下注册的监听器，logger 只收集 warn。 */
const fakeCtx = () => {
  const listeners = new Map();
  const warnings = [];
  return {
    on(name, handler) {
      listeners.set(name, handler);
      return () => listeners.delete(name);
    },
    logger: () => ({ warn: (message) => warnings.push(message) }),
    fire: (name, payload, next) => listeners.get(name)(payload, next),
    warnings,
  };
};

/** 假阶梯正文来源。 */
const fakeSource = (body = '| **lite** | 最小 |\n| **full** | 常规 |') => ({
  get body() {
    return body;
  },
  async refresh() {
    if (body instanceof Error) throw body;
  },
});

/** 假运行时：可改档位。 */
const fakeRuntime = (initial = 'full') => ({
  mode: initial,
});

/**
 * 假端口：形状与 src/prompt/port.ts 的 PromptPorts 一致。
 *
 * mode 必须是 getter——写成字段会让 prestep 每次都读到构造时的档位，
 * 正是 port.ts 注释里警告的那类 bug。会话档案复用真的 SessionStore，
 * 因为它的"baseline 终身不变"语义是 prestep 依赖的真实契约。
 */
const fakePorts = (sessions, runtime) => ({
  get mode() {
    return runtime.mode;
  },
  ensure: (sessionId, fallback) => sessions.ensure(sessionId, fallback),
});

/** 一次 enter 决定，带一条普通用户消息。 */
const enterDecision = () => ({
  kind: 'enter',
  messages: [{ id: 'u1', role: 'user', content: [{ type: 'text', text: '问题' }], source: { kind: 'user' } }],
});

test('档位没变时不注入任何消息', async () => {
  const ctx = fakeCtx();
  const sessions = new SessionStore();
  const runtime = fakeRuntime('full');
  installModeReminder(ctx, { ports: fakePorts(sessions, runtime), source: fakeSource() });
  sessions.ensure('a1', () => 'full');

  const decision = enterDecision();
  const result = await ctx.fire('agent/pre-step', { agent: { id: 'a1' }, signal: { aborted: false } }, async () => decision);
  assert.deepEqual(result.messages.map((item) => item.id), ['u1']);
});

test('档位切换后注入一条通知，且只注入一次', async () => {
  const ctx = fakeCtx();
  const sessions = new SessionStore();
  const runtime = fakeRuntime('full');
  installModeReminder(ctx, { ports: fakePorts(sessions, runtime), source: fakeSource() });
  sessions.ensure('a1', () => 'full');

  runtime.mode = 'lite';
  const payload = { agent: { id: 'a1' }, signal: { aborted: false } };
  const first = await ctx.fire('agent/pre-step', payload, async () => enterDecision());
  assert.equal(first.messages.length, 2);
  assert.equal(first.messages[1].source.kind, 'ponytail-mode-update');
  assert.ok(first.messages[1].content[0].text.includes('LITE'));

  // 下一步：同一档位，不该再来一条。
  const second = await ctx.fire('agent/pre-step', payload, async () => enterDecision());
  assert.deepEqual(second.messages.map((item) => item.id), ['u1']);
});

test('连续切四档，每一步都只带一条、且说的是当步档位', async () => {
  const ctx = fakeCtx();
  const sessions = new SessionStore();
  const runtime = fakeRuntime('full');
  installModeReminder(ctx, { ports: fakePorts(sessions, runtime), source: fakeSource() });
  sessions.ensure('a1', () => 'full');
  const payload = { agent: { id: 'a1' }, signal: { aborted: false } };

  for (const mode of ['off', 'lite', 'full', 'ultra']) {
    runtime.mode = mode;
    const result = await ctx.fire('agent/pre-step', payload, async () => enterDecision());
    const notices = result.messages.filter((item) => item.source.kind === 'ponytail-mode-update');
    assert.equal(notices.length, 1, mode + ' 档的通知条数不对');
    const text = notices[0].content[0].text;
    if (mode === 'off') assert.ok(text.includes('档位已关闭'), 'off 档文案不对');
    else assert.ok(text.includes(mode.toUpperCase()), mode + ' 档文案没带档位名');
  }
});

test('downstream 拒绝时原样返回，不注入', async () => {
  const ctx = fakeCtx();
  const sessions = new SessionStore();
  const runtime = fakeRuntime('full');
  installModeReminder(ctx, { ports: fakePorts(sessions, runtime), source: fakeSource() });
  sessions.ensure('a1', () => 'full');
  runtime.mode = 'lite';

  const rejected = { kind: 'reject' };
  const result = await ctx.fire('agent/pre-step', { agent: { id: 'a1' }, signal: { aborted: false } }, async () => rejected);
  assert.equal(result, rejected);
});

test('断链测试：读正文抛错时请求照常通过，且留下 warn', async () => {
  const ctx = fakeCtx();
  const sessions = new SessionStore();
  const runtime = fakeRuntime('full');
  installModeReminder(ctx, {
    runtime,
    sessions,
    source: {
      get body() {
        return '';
      },
      async refresh() {
        throw new Error('模拟读盘失败');
      },
    },
  });
  sessions.ensure('a1', () => 'full');
  runtime.mode = 'lite';

  const decision = enterDecision();
  const result = await ctx.fire('agent/pre-step', { agent: { id: 'a1' }, signal: { aborted: false } }, async () => decision);
  assert.deepEqual(result.messages.map((item) => item.id), ['u1'], '异常时请求被改了');
  assert.equal(ctx.warnings.length, 1);
  assert.ok(ctx.warnings[0].includes('模拟读盘失败'));
});

test('本步已取消时不注入', async () => {
  const ctx = fakeCtx();
  const sessions = new SessionStore();
  const runtime = fakeRuntime('full');
  installModeReminder(ctx, { ports: fakePorts(sessions, runtime), source: fakeSource() });
  sessions.ensure('a1', () => 'full');
  runtime.mode = 'lite';

  const result = await ctx.fire('agent/pre-step', { agent: { id: 'a1' }, signal: { aborted: true } }, async () => enterDecision());
  assert.deepEqual(result.messages.map((item) => item.id), ['u1']);
});
