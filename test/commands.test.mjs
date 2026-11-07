/**
 * 命令层的真接线测试（#05 验收项二的自动化部分）。
 *
 * 票面要求「卸掉 UI 后面板能做的事仍能完成」。UI 是 v0.2 的可选前端，等价路径
 * 有两条：设置面板写 `defaultMode`、以及 `/ponytail <档位>` 命令。前者由
 * `config-wiring.test.mjs` 覆盖，后者此前只有手工推理——这个文件补上它。
 *
 * 测的是**真宿主**：装载真的 `@deepseek-ai/cordis` 与真的
 * `@deepseek-ai/dsh-commands`，用 `ctx.provide('settings', …)` 顶一个最小
 * settings 服务，再走 `ctx.plugin(Ponytail)`。替身测不出来的东西在这里才测得出：
 *
 * - `ctx.inject(['commands'], …)` 到底有没有把定义真的塞进命令表；
 * - `find(agent, 'ponytail').handler` 拿到的返回值是不是宿主认的三种 kind；
 * - 卸载插件后命令是否真的从表里消失（否则热重载会积累幽灵命令）。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Context } from '@deepseek-ai/cordis';
import CommandRuntime from '@deepseek-ai/dsh-commands';
import { SkillRegistry } from '@deepseek-ai/dsh-skill';
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt';

import * as Ponytail from '../lib/plugin.js';
import { runtimeOf } from '../lib/plugin.js';

/** ctx.plugin 返回 thenable Fiber；给微任务与定时器一次机会。 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

/** 命令表按 agent 分层；测试只需要一个稳定的会话 id。 */
const AGENT = { id: 'cmd-session', session: 'cmd-session' };

/** 造一次调用；宿主真实传入的字段里我们只用 rawInput。 */
function invoke(definition, rawInput) {
  return definition.handler({
    commandId: 'cmd-1',
    agent: AGENT,
    rawInput,
    attachments: [],
    signal: new AbortController().signal,
  });
}

/** 起最小宿主：cordis + systemPrompt + skills + commands，可选 settings。 */
async function bootHost(options = {}) {
  const ctx = new Context();
  await ctx.plugin(SystemPrompt);
  await ctx.plugin(SkillRegistry);
  await ctx.plugin(CommandRuntime);
  await settle();

  const state = {
    revision: options.revision ?? 7,
    patchMode: options.patchMode,
    mutateCalls: [],
  };
  const settings = {
    get documentPath() {
      return '/home/u/.dsh/profiles/desktop/cordis.patch.yml';
    },
    describe() {
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
  return { ctx, state };
}

test('命令真的进了命令表，名字与描述对得上', async () => {
  const { ctx } = await bootHost();
  const fiber = await ctx.plugin(Ponytail);
  await settle();

  const names = ctx.commands.list(AGENT).map((descriptor) => descriptor.name);
  assert.ok(names.includes('ponytail'), '命令表里必须有 ponytail，实得：' + names.join(', '));

  const definition = ctx.commands.find(AGENT, 'ponytail');
  assert.ok(definition, 'find 必须能解析到定义');
  assert.equal(definition.description, '查看或切换 Ponytail 档位');
  assert.equal(typeof definition.handler, 'function');

  await fiber.dispose();
  await ctx.fiber.dispose();
});

test('不带参数只报现状，不写配置', async () => {
  const { ctx, state } = await bootHost({ patchMode: 'full' });
  const fiber = await ctx.plugin(Ponytail);
  await settle();

  const definition = ctx.commands.find(AGENT, 'ponytail');
  const result = await invoke(definition, '');

  assert.equal(result.kind, 'success');
  assert.match(result.text, /当前档位：full/);
  assert.match(result.text, /用法：\/ponytail \[off\|lite\|full\|ultra\]/);
  assert.equal(state.mutateCalls.length, 0, '只看不改，不该有任何写入');

  await fiber.dispose();
  await ctx.fiber.dispose();
});

test('合法档位写进 settings，并回报新档位', async () => {
  const { ctx, state } = await bootHost({ patchMode: 'full' });
  const fiber = await ctx.plugin(Ponytail);
  await settle();

  const definition = ctx.commands.find(AGENT, 'ponytail');
  const result = await invoke(definition, '  ULTRA  ');

  assert.equal(result.kind, 'success', JSON.stringify(result));
  assert.match(result.text, /档位已切换为 ultra/);
  assert.equal(state.mutateCalls.length, 1);
  assert.deepEqual(state.mutateCalls[0].ops, [{ op: 'set', path: ['defaultMode'], value: 'ultra' }]);
  assert.equal(runtimeOf(fiber.ctx).mode, 'ultra');

  await fiber.dispose();
  await ctx.fiber.dispose();
});

test('不认识的档位报错且一个字都不写', async () => {
  const { ctx, state } = await bootHost({ patchMode: 'full' });
  const fiber = await ctx.plugin(Ponytail);
  await settle();

  const definition = ctx.commands.find(AGENT, 'ponytail');
  const result = await invoke(definition, 'turbo');

  assert.equal(result.kind, 'error');
  assert.match(result.text, /未知档位「turbo」/);
  assert.match(result.text, /off \/ lite \/ full \/ ultra/);
  assert.equal(state.mutateCalls.length, 0, '解析失败绝不能顺手写一个默认档');

  await fiber.dispose();
  await ctx.fiber.dispose();
});

test('没有 settings 服务：命令仍在表里，切档给出人能读懂的理由', async () => {
  // 这是「卸掉某一块能力仍然可用」的正例：commands 在、settings 不在，
  // 命令不该消失（用户还得能问「现在什么档位」），写操作则如实失败。
  const { ctx } = await bootHost({ withSettings: false });
  const fiber = await ctx.plugin(Ponytail);
  await settle();

  const definition = ctx.commands.find(AGENT, 'ponytail');
  assert.ok(definition);

  const read = await invoke(definition, '');
  assert.equal(read.kind, 'success');
  assert.match(read.text, /当前档位：full/);

  const write = await invoke(definition, 'lite');
  assert.equal(write.kind, 'error');
  assert.match(write.text, /没有 settings 服务/);

  await fiber.dispose();
  await ctx.fiber.dispose();
});

test('卸掉插件后命令从表里消失，不留幽灵', async () => {
  const { ctx } = await bootHost();
  const fiber = await ctx.plugin(Ponytail);
  await settle();
  assert.ok(ctx.commands.list(AGENT).some((descriptor) => descriptor.name === 'ponytail'));

  await fiber.dispose();
  await settle();
  const after = ctx.commands.list(AGENT).map((descriptor) => descriptor.name);
  assert.equal(after.includes('ponytail'), false, '卸载后不该还剩 ponytail，实得：' + after.join(', '));

  await ctx.fiber.dispose();
});
