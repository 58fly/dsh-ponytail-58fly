/**
 * settings 通道的真实接线测试（#04 验收项四的另一半）。
 *
 * `config-runtime.test.mjs` 用替身证明语义，这里证明**接线本身**：
 * 装载真实的 `@deepseek-ai/cordis`，用 `ctx.provide('settings', …)` 顶掉一个最小
 * settings 服务，然后走 `ctx.plugin(Ponytail)`。这条路能验证替身测不出来的东西：
 *
 * - `ctx.inject(['settings'], …)` 在服务缺席时到底会不会起子 fiber；
 * - `runtimeOf()` 的键到底是不是插件自己的 ctx（而不是根 ctx）；
 * - 监听的 `settings/updated` / `loader/volatile-update` 是否真的收到广播；
 * - 卸载后监听是否真的断开（否则热重载会积累幽灵监听）。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Context } from '@deepseek-ai/cordis';
import { SkillRegistry } from '@deepseek-ai/dsh-skill';
import { SystemPrompt, renderPrompt } from '@deepseek-ai/dsh-system-prompt';

import * as Ponytail from '../lib/plugin.js';
import { runtimeOf } from '../lib/plugin.js';

/** ctx.plugin 返回 thenable Fiber；给微任务与定时器一次机会。 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

/** 起一个最小宿主，并可选地顶一个 settings 服务。 */
async function bootHost(options = {}) {
  const ctx = new Context();
  await ctx.plugin(SystemPrompt);
  await ctx.plugin(SkillRegistry);
  await settle();

  const state = {
    revision: options.revision ?? 4,
    patchMode: options.patchMode,
    describeCalls: 0,
    mutateCalls: [],
    documentPath: '/home/u/.dsh/profiles/desktop/cordis.patch.yml',
  };
  const settings = {
    get documentPath() {
      return state.documentPath;
    },
    describe() {
      state.describeCalls += 1;
      return [{ ns: 'ponytail-58fly', revision: state.revision, user: state.patchMode === undefined ? {} : { defaultMode: state.patchMode } }];
    },
    async mutate(ns, ops, expectedRevision) {
      state.mutateCalls.push({ ns, ops, expectedRevision });
      state.revision += 1;
      const set = ops.find((op) => op.op === 'set' && op.path.join('.') === 'defaultMode');
      if (set) state.patchMode = set.value;
    },
  };
  if (options.withSettings !== false) ctx.provide('settings', settings);
  return { ctx, state, settings };
}

test('没有 settings 服务：插件正常装载，档位由内置兜底决定', async () => {
  // 验收项四：无 settings 也要完整工作。这里的「工作」是能被装载、
  // 提示段照常出现、写入给出一句人能读懂的理由。
  const { ctx } = await bootHost({ withSettings: false });
  const fiber = await ctx.plugin(Ponytail);
  await settle();

  const runtime = runtimeOf(fiber.ctx);
  assert.ok(runtime, 'runtimeOf 必须能拿到运行时');
  assert.equal(runtime.hasSettings, false);
  assert.equal(runtime.mode, 'full');

  const assembled = await ctx.systemPrompt.assemble(undefined);
  const section = assembled.sections.find((item) => item.name === 'ponytail-58fly');
  assert.ok(section?.text.startsWith('PONYTAIL 已启用 · 档位：full'), '段正文：' + section?.text);

  const outcome = await runtime.setMode('lite');
  assert.equal(outcome.ok, false);
  assert.match(outcome.reason, /没有 settings 服务/);
  assert.equal(runtime.mode, 'full');

  await fiber.dispose();
  await ctx.fiber.dispose();
});

test('runtimeOf 只认插件自己的 ctx，不认根 ctx', async () => {
  // 用 WeakMap 而不是往 ctx 挂属性，就是为了这条隔离：同进程装两份插件时
  // 两个运行时不能互相污染。
  const { ctx } = await bootHost();
  const fiber = await ctx.plugin(Ponytail);
  await settle();
  assert.ok(runtimeOf(fiber.ctx));
  assert.equal(runtimeOf(ctx), undefined, '根 ctx 不该看到插件内部的运行时');

  // 同一上下文再装一次（composition 测试已证明重名会被拒），这里只验证
  // 第二个 fiber 的 ctx 也不会命中第一个的运行时。
  let second = null;
  try {
    second = await ctx.plugin(Ponytail);
    await settle();
  } catch {
    second = null;
  }
  if (second !== null) {
    assert.notEqual(runtimeOf(second.ctx), runtimeOf(fiber.ctx), '两个实例的运行时必须不同');
    await second.dispose();
  }
  await fiber.dispose();
  await ctx.fiber.dispose();
});

test('settings 到位后，档位从 describe 的 user 投影读出来', async () => {
  const { ctx } = await bootHost({ patchMode: 'lite', revision: 11 });
  const fiber = await ctx.plugin(Ponytail);
  await settle();

  const runtime = runtimeOf(fiber.ctx);
  assert.equal(runtime.hasSettings, true);
  assert.equal(runtime.mode, 'lite');

  const snapshot = runtime.getSnapshot();
  assert.equal(snapshot.revision, 11);
  assert.equal(snapshot.writable, true);
  assert.equal(snapshot.documentPath, '/home/u/.dsh/profiles/desktop/cordis.patch.yml');
  assert.equal(snapshot.chain.length, 3);

  const assembled = await ctx.systemPrompt.assemble(undefined);
  assert.ok(assembled.sections.find((item) => item.name === 'ponytail-58fly')?.text.startsWith('PONYTAIL 已启用 · 档位：lite'));

  await fiber.dispose();
  await ctx.fiber.dispose();
});

test('settings/updated 广播触发重读，面板不靠轮询', async () => {
  const { ctx, state } = await bootHost({ patchMode: 'lite' });
  const fiber = await ctx.plugin(Ponytail);
  await settle();
  const runtime = runtimeOf(fiber.ctx);
  assert.equal(runtime.mode, 'lite');
  const before = state.describeCalls;

  state.patchMode = 'ultra';
  ctx.emit('settings/updated', 'ponytail-58fly');
  await settle();

  assert.ok(state.describeCalls > before, '收到广播必须重新 describe');
  assert.equal(runtime.mode, 'ultra');

  await fiber.dispose();
  await ctx.fiber.dispose();
});

test('loader/volatile-update 广播也触发重读', async () => {
  // 这条事件是 volatile 字段原地更新的唯一信号，而且它的参数只是键路径，
  // 不含值——所以监听器只能「重读一次」，不能从参数推。
  const { ctx, state } = await bootHost({ patchMode: 'lite' });
  const fiber = await ctx.plugin(Ponytail);
  await settle();
  const runtime = runtimeOf(fiber.ctx);
  const before = state.describeCalls;

  state.patchMode = 'off';
  ctx.emit('loader/volatile-update', [['defaultMode']]);
  await settle();

  assert.ok(state.describeCalls > before);
  assert.equal(runtime.mode, 'off');

  // off 档位下提示段返回空串。注意 assemble() 的 sections 里它**仍然在**（宿主
  // 不在这一步过滤），真正丢掉空段的是 renderPrompt() —— 那才是发给模型的文本。
  const assembled = await ctx.systemPrompt.assemble(undefined);
  const section = assembled.sections.find((item) => item.name === 'ponytail-58fly');
  assert.equal(section?.text, '', 'off 档位渲染空串');
  assert.equal(renderPrompt(assembled).includes('ponytail:'), false, '空段不得进入最终提示文本');

  await fiber.dispose();
  await ctx.fiber.dispose();
});

test('经真实注入的服务写入成功后，档位与诊断同时更新', async () => {
  const { ctx, state } = await bootHost({ patchMode: 'lite', revision: 2 });
  const fiber = await ctx.plugin(Ponytail);
  await settle();
  const runtime = runtimeOf(fiber.ctx);

  const outcome = await runtime.setMode('ultra');
  assert.equal(outcome.ok, true);
  assert.equal(runtime.mode, 'ultra');
  assert.equal(state.mutateCalls.length, 1);
  assert.equal(state.mutateCalls[0].ns, 'ponytail-58fly');
  assert.deepEqual(state.mutateCalls[0].ops, [{ op: 'set', path: ['defaultMode'], value: 'ultra' }]);
  assert.equal(state.mutateCalls[0].expectedRevision, 2, '必须带读到的 revision 做乐观锁');

  const patch = runtime.getSnapshot().chain.find((item) => item.level === 'patch');
  assert.equal(patch.value, 'ultra');
  assert.equal(patch.hit, true);

  await fiber.dispose();
  await ctx.fiber.dispose();
});

test('卸载后监听真的断开，广播不再触达（热重载不积幽灵监听）', async () => {
  const { ctx, state } = await bootHost({ patchMode: 'lite' });
  const fiber = await ctx.plugin(Ponytail);
  await settle();
  await fiber.dispose();
  await settle();

  const before = state.describeCalls;
  ctx.emit('settings/updated', 'ponytail-58fly');
  ctx.emit('loader/volatile-update', [['defaultMode']]);
  await settle();
  assert.equal(state.describeCalls, before, '卸载后不得再 describe');

  await ctx.fiber.dispose();
});

test('非法配置写不进去：mutate 抛错时档位不变且诊断可见', async () => {
  const { ctx, state, settings } = await bootHost({ patchMode: 'lite', revision: 5 });
  const fiber = await ctx.plugin(Ponytail);
  await settle();
  const runtime = runtimeOf(fiber.ctx);

  settings.mutate = async (ns, ops, expectedRevision) => {
    state.mutateCalls.push({ ns, ops, expectedRevision });
    throw new Error('Config field "defaultMode" is not volatile');
  };

  const outcome = await runtime.setMode('ultra');
  assert.equal(outcome.ok, false);
  assert.match(outcome.reason, /is not volatile/);
  assert.equal(runtime.mode, 'lite', '写失败不得改变档位');
  assert.match(
    runtime.getSnapshot().chain.find((item) => item.level === 'patch').problem,
    /is not volatile/,
  );

  await fiber.dispose();
  await ctx.fiber.dispose();
});