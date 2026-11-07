/**
 * 配置运行时的集成测试（#04 四条验收里涉及写入与降级的全部）。
 *
 * 这里**不装载真实宿主**：`settings` 服务只在完整 App 里存在，npm 上发布的
 * `@deepseek-ai/dsh-settings` 只提供类型，运行它需要 configEditor / loader 一整套。
 * 所以我们用一个最小替身，只实现本插件真正调用的三个成员：
 *
 * - `describe()` —— 返回描述符数组（只读本插件需要的那几个字段）；
 * - `mutate(ns, ops, expectedRevision)` —— 写入；
 * - `get documentPath()` —— 诊断展示用。
 *
 * 替身的好处是能把「宿主行为」当成剧本写出来（例如「第一次写抛 SETTINGS_CONFLICT」），
 * 这正是验收项一要求的场景，而真实宿主很难稳定复现。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ConfigRuntime } from '../lib/config/runtime.js';
import { coerceMode } from '../lib/l0/mode.js';

/** 最小 ctx 替身：只提供 logger（ConfigRuntime 用它报订阅者异常）。 */
function fakeCtx() {
  const warnings = [];
  return {
    warnings,
    logger: () => ({
      warn: (message) => warnings.push(String(message)),
    }),
  };
}

/** 造一个 settings 替身。`script` 是每次 mutate 的剧本，最后一项会被重复使用。 */
function fakeSettings(options = {}) {
  const state = {
    revision: options.revision ?? 3,
    patchMode: options.patchMode,
    documentPath: options.documentPath ?? '/home/u/.dsh/profiles/desktop/cordis.patch.yml',
    describeCalls: 0,
    mutateCalls: [],
  };
  const script = [...(options.script ?? [])];
  const settings = {
    get documentPath() {
      return state.documentPath;
    },
    describe() {
      state.describeCalls += 1;
      // 条目不匹配时返回别的插件，验证 pickDescriptor 不是「取第一条」。
      return [
        { ns: 'some-other-plugin', revision: 99, user: { defaultMode: 'off' } },
        {
          ns: 'ponytail-58fly',
          revision: state.revision,
          user: state.patchMode === undefined ? {} : { defaultMode: state.patchMode },
        },
      ];
    },
    async mutate(ns, ops, expectedRevision) {
      state.mutateCalls.push({ ns, ops, expectedRevision });
      const step = script.length > 1 ? script.shift() : script[0];
      if (step === 'conflict') {
        // 模拟别的写入者抢先提交：宿主内部 revision 前进，本次带旧 revision 必失败。
        state.revision += 1;
        const error = new Error('settings namespace "ponytail-58fly" changed since it was read');
        error.code = 'SETTINGS_CONFLICT';
        error.expected = expectedRevision;
        error.actual = state.revision;
        throw error;
      }
      if (step === 'boom') throw new Error('磁盘只读');
      state.revision += 1;
      const set = ops.find((op) => op.op === 'set' && op.path.join('.') === 'defaultMode');
      if (set) state.patchMode = set.value;
    },
  };
  return { settings, state };
}

/** 造一个 config 替身：volatile 字段是活引用，可被原地替换值。 */
function fakeConfig(initial) {
  const box = { value: initial };
  return {
    box,
    config: {
      defaultMode: { get: () => box.value },
      skillDir: { get: () => undefined },
      locale: { get: () => undefined },
    },
  };
}

test('无 settings 服务：插件仍能算出档位，写入诚实地失败', async () => {
  // 验收项四：没有 settings 也要完整工作。这里「工作」的定义是：
  // 档位仍然由 env / 内置兜底决定，且写入给出一句人能读懂的理由，而不是抛异常。
  const ctx = fakeCtx();
  const { config } = fakeConfig(undefined);
  const runtime = new ConfigRuntime({ ctx, config, env: {} });
  assert.equal(runtime.hasSettings, false);
  assert.equal(runtime.mode, 'full');
  assert.equal(runtime.getSnapshot().writable, false);
  assert.equal(runtime.getSnapshot().revision, null);

  const outcome = await runtime.setMode('lite');
  assert.equal(outcome.ok, false);
  assert.match(outcome.reason, /没有 settings 服务/);
  assert.equal(runtime.mode, 'full', '失败的写入不得改变档位');
});

test('无 settings 时 env 仍然生效', () => {
  const { config } = fakeConfig(undefined);
  const runtime = new ConfigRuntime({ ctx: fakeCtx(), config, env: { PONYTAIL_DEFAULT_MODE: 'ultra' } });
  assert.equal(runtime.mode, 'ultra');
  assert.equal(runtime.report.chain.find((x) => x.level === 'env').hit, true);
});

test('接入 settings 后 refresh 从 describe 的 user 投影取补丁层', async () => {
  // 这是诊断诚实性的关键：descriptor.value 已经把 env 与兜底混进去了，
  // 拿它当 patch 层会让面板把「兜底的 full」说成「用户配的 full」。
  const { config } = fakeConfig(undefined);
  const { settings } = fakeSettings({ patchMode: 'lite', revision: 7 });
  const runtime = new ConfigRuntime({ ctx: fakeCtx(), config, env: {} });
  runtime.attachSettings(settings, {});
  await runtime.refresh();

  const snapshot = runtime.getSnapshot();
  assert.equal(snapshot.writable, true);
  assert.equal(snapshot.revision, 7);
  assert.equal(snapshot.documentPath, '/home/u/.dsh/profiles/desktop/cordis.patch.yml');
  assert.equal(snapshot.effective, 'lite');
  assert.equal(snapshot.chain.find((x) => x.level === 'patch').value, 'lite');
  assert.equal(snapshot.chain.find((x) => x.level === 'patch').hit, true);
});

test('人为制造一次 SETTINGS_CONFLICT 后，下一次写入仍然成功（验收项一）', async () => {
  // 上游 B-02 的根因：写完不重新读 revision，于是后续每次写入都带着旧 revision，
  // 永久冲突。这里的断言是「第一次冲突之后，第二次用了从 describe 新读到的 revision」。
  const { config } = fakeConfig(undefined);
  const { settings, state } = fakeSettings({ patchMode: undefined, revision: 1, script: ['conflict', 'ok'] });
  const runtime = new ConfigRuntime({ ctx: fakeCtx(), config, env: {} });
  runtime.attachSettings(settings, {});
  await runtime.refresh();
  assert.equal(runtime.getSnapshot().revision, 1);

  const outcome = await runtime.setMode('lite');
  assert.equal(outcome.ok, true, '冲突一次之后必须重试成功');
  assert.equal(outcome.note, null);

  assert.equal(state.mutateCalls.length, 2, '必须恰好写两次：失败一次 + 重试一次');
  assert.equal(state.mutateCalls[0].expectedRevision, 1);
  assert.equal(state.mutateCalls[1].expectedRevision, 2, '重试必须带刷新后的 revision');
  assert.equal(state.mutateCalls[1].ns, 'ponytail-58fly');
  assert.deepEqual(state.mutateCalls[1].ops, [{ op: 'set', path: ['defaultMode'], value: 'lite' }]);
  assert.equal(runtime.mode, 'lite', '写入成功后档位必须真的变了');
});

test('连续两次冲突不无限重试：第二次失败如实返回', async () => {
  // 持续冲突说明有别的写入者在竞争，把一次点击变成写盘风暴没有任何好处。
  const { config } = fakeConfig(undefined);
  const { settings, state } = fakeSettings({ revision: 1, script: ['conflict', 'conflict'] });
  const runtime = new ConfigRuntime({ ctx: fakeCtx(), config, env: {} });
  runtime.attachSettings(settings, {});
  await runtime.refresh();

  const outcome = await runtime.setMode('lite');
  assert.equal(outcome.ok, false);
  assert.match(outcome.reason, /changed since it was read/);
  assert.equal(state.mutateCalls.length, 2, '最多两次，不重试第三次');
});

test('非冲突错误照实返回，并落进 patch 层的 problem（验收项三的可见性）', async () => {
  const { config } = fakeConfig(undefined);
  const { settings } = fakeSettings({ revision: 1, script: ['boom'] });
  const runtime = new ConfigRuntime({ ctx: fakeCtx(), config, env: {} });
  runtime.attachSettings(settings, {});
  await runtime.refresh();
  const before = runtime.mode;

  const outcome = await runtime.setMode('lite');
  assert.equal(outcome.ok, false);
  assert.match(outcome.reason, /磁盘只读/);
  assert.equal(runtime.mode, before, '验收项三：写失败不得改变运行档位');
  const patch = runtime.report.chain.find((x) => x.level === 'patch');
  assert.match(patch.problem, /磁盘只读/, '拒绝原因必须出现在诊断里，不能只 warn');
});

test('非法档位：不发请求、档位不变', async () => {
  const { config } = fakeConfig(undefined);
  const { settings, state } = fakeSettings({ patchMode: 'ultra' });
  const runtime = new ConfigRuntime({ ctx: fakeCtx(), config, env: {} });
  runtime.attachSettings(settings, {});
  await runtime.refresh();
  const callsBefore = state.mutateCalls.length;

  // 'LITE ' 会被 coerceMode 归一成 'lite'，属合法输入，用 coerceMode 过滤掉。
  for (const raw of ['turbo', undefined, 42, null, '']) {
    if (coerceMode(raw) !== null) continue;
    const outcome = await runtime.setMode(raw);
    assert.equal(outcome.ok, false, String(raw));
    assert.match(outcome.reason, /档位无效/);
  }
  assert.equal(state.mutateCalls.length, callsBefore, '非法值不得触达宿主');
  assert.equal(runtime.mode, 'ultra', '档位不得被非法输入改变');
});

test('环境变量压制时仍写入，但必须给出 note（不是失败）', async () => {
  // 值确实写进文件了，用户下次取消环境变量就会生效。报失败是错误的。
  const { config } = fakeConfig(undefined);
  const { settings } = fakeSettings({ revision: 1 });
  const runtime = new ConfigRuntime({ ctx: fakeCtx(), config, env: { PONYTAIL_DEFAULT_MODE: 'ultra' } });
  runtime.attachSettings(settings, {});
  await runtime.refresh();
  assert.equal(runtime.mode, 'ultra');

  const outcome = await runtime.setMode('lite');
  assert.equal(outcome.ok, true);
  assert.match(outcome.note, /PONYTAIL_DEFAULT_MODE 的优先级更高/);
  assert.match(outcome.note, /ultra/);
});

test('订阅只在档位或诊断真的变了时触发', async () => {
  const { config } = fakeConfig(undefined);
  const { settings, state } = fakeSettings({ revision: 0 });
  const runtime = new ConfigRuntime({ ctx: fakeCtx(), config, env: {} });
  runtime.attachSettings(settings, {});
  await runtime.refresh();

  let calls = 0;
  const off = runtime.subscribe(() => {
    calls += 1;
  });
  await runtime.refresh();
  assert.equal(calls, 0, '什么都没变时不得通知');

  state.patchMode = 'lite';
  await runtime.refresh();
  assert.equal(calls, 1, '档位变了必须通知');

  off();
  state.patchMode = 'ultra';
  await runtime.refresh();
  assert.equal(calls, 1, '退订后不再通知');
});

test('describe 抛错时保留旧报告，并把原因记进诊断', async () => {
  const { config } = fakeConfig(undefined);
  const { settings } = fakeSettings({ patchMode: 'lite' });
  const runtime = new ConfigRuntime({ ctx: fakeCtx(), config, env: {} });
  runtime.attachSettings(settings, {});
  await runtime.refresh();
  assert.equal(runtime.mode, 'lite');

  settings.describe = () => {
    throw new Error('configEditor 已失效');
  };
  await runtime.refresh();
  assert.equal(runtime.mode, 'lite', '读失败不得把档位重置成兜底');
  assert.match(runtime.report.chain.find((x) => x.level === 'patch').problem, /configEditor 已失效/);
});

test('dispose 之后所有回调变成 no-op', async () => {
  const { config } = fakeConfig(undefined);
  const { settings } = fakeSettings({ patchMode: 'lite' });
  const runtime = new ConfigRuntime({ ctx: fakeCtx(), config, env: {} });
  runtime.attachSettings(settings, {});
  await runtime.refresh();
  let calls = 0;
  runtime.subscribe(() => {
    calls += 1;
  });
  runtime.dispose();
  await runtime.refresh();
  assert.equal(calls, 0);
  assert.equal((await runtime.setMode('ultra')).ok, false, 'dispose 后不得再写盘');
});

test('volatile 活引用被宿主原地更新后，refresh 能读到新值', async () => {
  // 宿主的 _commitVolatile() 用 updateVolatile() 原地改引用背后的值，
  // 所以 ConfigRuntime 必须持有 config 对象本身，而不是抄一份值。
  const { config, box } = fakeConfig(undefined);
  const runtime = new ConfigRuntime({ ctx: fakeCtx(), config, env: {} });
  assert.equal(runtime.mode, 'full');
  box.value = 'lite';
  await runtime.refresh();
  assert.equal(runtime.mode, 'lite');
  assert.equal(runtime.report.chain.find((x) => x.level === 'patch').value, 'lite');
});
