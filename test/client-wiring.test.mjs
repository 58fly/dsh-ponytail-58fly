/**
 * 客户端入口的接线测试（#05 验收项 ②「可降级」的正面证据）。
 *
 * **测的是打好的产物 `lib/client.js`，不是源码**：那份文件是
 * `window.__ModuleLoader__.load({ id, factory })` 外壳，浏览器装载时把 factory 里的
 * `require` 指向页面的模块表。这里用一个假的 `window` 把 factory 抠出来，
 * `require` 交给 Node 的真实解析器——于是测试看到的模块边界与宿主一致：
 * 产物 require 了谁、apply 拿到什么上下文、注册项长什么样，全是真货。
 *
 * 覆盖的正是「卸掉客户端 UI 后宿主侧零损失」这条链路的两端：
 *   1. `apply` 只声明 `slots` 这一个硬依赖——没装设置页的部署里条目不会被整条跳过；
 *   2. `configForms` 缺席时，`ctx.inject` 的子 fiber 起不来，**一个槽位都不注册**；
 *   3. `settings.section` 还没被声明时，`slots.inject` 的回调不执行（面板整块缺失）；
 *   4. 依赖齐了之后，注册项与注入面的形状正确，两个写回调的行为正确。
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mock, test } from 'node:test';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const CLIENT_URL = pathToFileURL(require.resolve('../lib/client.js')).href;

/**
 * 模拟浏览器页面的模块表。
 *
 * 这三个包在宿主页面里是**内置 seed 模块**（`dsh-web-frontend` 的 staticModules），
 * 不是从 node_modules 解析的：devDependencies 里那一份只用来取类型，它自己的
 * 运行期依赖（clsx、shiki…）在 Node 里根本装不全，也不该装。所以这里给最小桩，
 * 语义与页面一致——`require` 拿到的是同一个模块对象、不是抛错。
 *
 * 面板本身不被渲染（没有 DOM），所以桩只要能构造出组件引用即可。
 */
const STUB_MODULES = {
  react: {
    useState: (initial) => [initial, () => {}],
    // 面板只测宽（ResizeObserver 在桩里被特性检测挡住），effect 体不跑、也不清理。
    useEffect: () => {},
    // 必须能当对象用：面板读 ref.current 决定要不要挂观测器。
    useRef: (initial) => ({ current: initial }),
  },
  'react/jsx-runtime': {
    Fragment: Symbol.for('react.fragment'),
    jsx: () => null,
    jsxs: () => null,
  },
  '@deepseek-ai/dsh-client-ui-primitives': {
    Button: () => null,
    HoverCard: () => null,
    PathLabel: () => null,
    SegmentedControl: () => null,
    Tag: () => null,
  },
};

/** 页面模块表里的 require：命中桩就用桩，其余交给 Node 真实解析。 */
function pageRequire(specifier) {
  if (Object.hasOwn(STUB_MODULES, specifier)) return STUB_MODULES[specifier];
  return require(specifier);
}

/**
 * 装载客户端产物并拿回它的导出面。
 *
 * 产物顶层就是一次 `window.__ModuleLoader__.load({...})` 调用，所以「装载」等于
 * 给它一个假 window、接住那次调用、再手动执行 factory。
 * @returns 产物的 `module.exports`（`{ inject, apply }`）。
 */
async function loadClient() {
  const delivered = [];
  const previous = globalThis.window;
  globalThis.window = {
    __ModuleLoader__: {
      load(spec) {
        delivered.push(spec);
      },
    },
  };
  try {
    await import(CLIENT_URL + '?t=' + String(Date.now()) + String(Math.random()));
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
  assert.equal(delivered.length, 1, '产物必须恰好调用一次 __ModuleLoader__.load');
  const spec = delivered[0];
  assert.equal(spec.id, 'dsh-ponytail-58fly');
  return spec.factory(pageRequire);
}

/** 假 form：记录 `set` / `unset` 的调用，返回可配置的接受与否。 */
function fakeForm(options = {}) {
  const calls = [];
  return {
    calls,
    accept: options.accept ?? true,
    getSnapshot() {
      return { status: 'ready', value: { defaultMode: 'full' }, base: {}, user: undefined, revision: 3, writable: true };
    },
    subscribe() {
      return () => {};
    },
    async set(field, value) {
      calls.push(['set', field, value]);
      return this.accept;
    },
    async unset(field) {
      calls.push(['unset', field]);
      return this.accept;
    },
  };
}

/**
 * 假客户端 ctx：只实现 `apply` 用到的那几个面。
 * @param options - `forms` 为 null 表示这台部署没有 configForms 服务。
 */
function fakeCtx(options = {}) {
  const state = { deps: [], warnings: [], registered: [], slotInjectKeys: [], effects: [], opened: [] };
  const ctx = {
    inject(deps, callback) {
      state.deps.push(deps);
      if (options.forms === null || options.forms === undefined) {
        // 服务永远缺席：真实 cordis 里子 fiber 一直 pending，回调永不执行。
        return new Promise(() => {});
      }
      const scope = {
        configForms: { get: (entryId) => (options.getFormsEntryId?.(entryId), options.forms) },
        // 票 06：没有会话时 `mounted` 回 undefined，`openResource` 永远不该被叫到。
        sidebarRight: {
          mounted: { getSnapshot: () => options.sessionId },
          openResource: (address) => {
            state.opened.push(address);
            if (options.sessionId === undefined) throw new Error('sidebarRight: no session surface is mounted');
          },
        },
        effect(factory, _label) {
          state.effects.push(factory);
          const disposer = factory();
          return typeof disposer === 'function' ? disposer : () => {};
        },
        slots: {
          inject(key, callback) {
            state.slotInjectKeys.push(key);
            if (options.declared === false) return () => {};
            const disposer = callback();
            return typeof disposer === 'function' ? disposer : () => {};
          },
          register(entry, component) {
            state.registered.push({ entry, component });
            return () => {};
          },
        },
      };
      callback(scope);
      return Promise.resolve({ dispose: () => {} });
    },
    logger(_scope) {
      return { warn: (message) => state.warnings.push(message) };
    },
  };
  return { ctx, state };
}

/** 让 `void Promise.resolve(...).catch(...)` 那一拍跑完。 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

test('产物只声明 slots 一个硬依赖：没装设置页的部署里客户端条目不会被整条跳过', async () => {
  const client = await loadClient();
  assert.deepEqual([...client.inject], ['slots']);
  assert.equal(typeof client.apply, 'function');
});

test('configForms 缺席时一个槽位都不注册，也不抛错', async () => {
  const client = await loadClient();
  const { ctx, state } = fakeCtx({ forms: null });
  client.apply(ctx);
  await settle();
  assert.deepEqual(
    state.deps,
    [['configForms', 'sidebarRight']],
    'configForms 与 sidebarRight 必须走运行时 ctx.inject，不能进顶层 inject',
  );
  assert.deepEqual(state.slotInjectKeys, [], '服务缺席时不该去碰任何槽位');
  assert.deepEqual(state.registered, []);
  assert.deepEqual(state.warnings, [], '服务缺席是正常降级，不是错误，不该 warn');
});

test('settings.section 还没被声明时，slots.inject 的回调不执行（面板整块缺失）', async () => {
  const client = await loadClient();
  const { ctx, state } = fakeCtx({ forms: fakeForm(), declared: false });
  client.apply(ctx);
  await settle();
  assert.deepEqual(state.slotInjectKeys, ['settings.section'], '必须走 slots.inject 而不是裸 register');
  assert.deepEqual(state.registered, [], '槽位未声明时不允许注册');
});

test('依赖齐了之后注册的是 settings.section，带 id/order/label，且没有裸 register', async () => {
  const client = await loadClient();
  const form = fakeForm();
  const { ctx, state } = fakeCtx({ forms: form });
  client.apply(ctx);
  await settle();
  assert.equal(state.registered.length, 1);
  const { entry, component } = state.registered[0];
  assert.equal(entry.name, 'settings.section');
  assert.equal(entry.id, 'ponytail-58fly');
  assert.equal(entry.order, 50);
  assert.equal(entry.label, 'Ponytail');
  assert.equal(typeof entry.inject, 'function', 'inject 必须是工厂（renderer 只在渲染时调用它）');
  assert.equal(typeof component, 'function', '注册项的组件必须是函数');
  // 注入面：hooks.snapshot 交给 renderer 改名成 useSnapshot；两个写回调原样挂上。
  const face = entry.inject();
  assert.equal(face.hooks.snapshot, form, 'snapshot 源必须是 form 本身（它有 getSnapshot/subscribe）');
  assert.equal(typeof face.writeMode, 'function');
  assert.equal(typeof face.resetMode, 'function');
});

test('面板拿到的 useSnapshot 与注入的 hooks 同名约定一致（renderer 把 snapshot 改名成 useSnapshot）', async () => {
  const client = await loadClient();
  const form = fakeForm();
  const { ctx, state } = fakeCtx({ forms: form });
  client.apply(ctx);
  await settle();
  const face = state.registered[0].entry.inject();
  // renderer 的 standardHookPropName('snapshot') === 'useSnapshot'；这里钉住「我们只提供 snapshot」，
  // 免得有人把 props 名直接写成 useSnapshot 又在 renderer 那边改名，变成双重前缀。
  assert.deepEqual(Object.keys(face.hooks), ['snapshot', 'statsStore'], '效率读接口也走 hooks，不另造 props 约定');
  assert.equal(face.useSnapshot, undefined);
});

test('writeMode 归一化后才落盘，非法值不动 form', async () => {
  const client = await loadClient();
  const form = fakeForm();
  const { ctx, state } = fakeCtx({ forms: form });
  client.apply(ctx);
  await settle();
  const face = state.registered[0].entry.inject();

  const ok = await face.writeMode('  LITE  ');
  assert.deepEqual(form.calls, [['set', 'defaultMode', 'lite']], '写之前必须过 coerceMode');
  assert.equal(ok.ok, true);
  assert.match(ok.message, /lite/);

  form.calls.length = 0;
  const bad = await face.writeMode('turbo');
  assert.deepEqual(form.calls, [], '非法档位不允许发起写入');
  assert.equal(bad.ok, false);
  assert.match(bad.message, /turbo/);
});

test('宿主拒绝写入时返回可读原因，不假装成功', async () => {
  const client = await loadClient();
  const form = fakeForm({ accept: false });
  const { ctx, state } = fakeCtx({ forms: form });
  client.apply(ctx);
  await settle();
  const face = state.registered[0].entry.inject();
  const outcome = await face.writeMode('ultra');
  assert.equal(outcome.ok, false);
  assert.match(outcome.message, /宿主拒绝/);
});

test('resetMode 走 unset；拒绝时同样返回 false', async () => {
  const client = await loadClient();
  const form = fakeForm();
  const { ctx, state } = fakeCtx({ forms: form });
  client.apply(ctx);
  await settle();
  const face = state.registered[0].entry.inject();
  const ok = await face.resetMode();
  assert.deepEqual(form.calls, [['unset', 'defaultMode']]);
  assert.equal(ok.ok, true);

  const refusing = fakeForm({ accept: false });
  const second = fakeCtx({ forms: refusing });
  client.apply(second.ctx);
  await settle();
  const rejected = await second.state.registered[0].entry.inject().resetMode();
  assert.equal(rejected.ok, false);
});

test('面板接线抛错时降级成一条 warn，面板不出现但客户端条目不崩', async () => {
  const client = await loadClient();
  const { ctx, state } = fakeCtx({ forms: fakeForm() });
  // 让 get() 抛错，模拟宿主条目 id 对不上时的真实故障。真实 cordis 里
  // ctx.inject 的回调跑在子 fiber 里，异常由 fiber 结算成 rejection，
  // 所以这里也按 fiber 的语义：捕获后 reject，而不是同步冒到 apply 外面。
  const broken = {
    ...ctx,
    inject(deps, callback) {
      state.deps.push(deps);
      const scope = {
        configForms: {
          get() {
            throw new Error('entry "ponytail-58fly" is not registered');
          },
        },
        effect: () => () => {},
        slots: { inject: () => () => {}, register: () => () => {} },
      };
      try {
        callback(scope);
        return Promise.resolve({ dispose: () => {} });
      } catch (error) {
        return Promise.reject(error);
      }
    },
  };
  client.apply(broken);
  await settle();
  assert.deepEqual(state.registered, [], '接线失败时不允许留下半张面板');
  assert.equal(state.warnings.length, 1, '必须恰好记一条 warn');
  assert.match(state.warnings[0], /客户端面板接线失败/);
  assert.match(state.warnings[0], /not registered/);
});

test('效率读接口挂在 hooks 上，且首次读取失败时不假装有数据', async () => {
  const client = await loadClient();
  const form = fakeForm();
  const calls = [];
  const { ctx, state } = fakeCtx({ forms: form });
  // 传输换成页面全局 fetch 的桩：客户端不再依赖 connection 服务的形状。
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (request) => {
    const payload = JSON.parse(await request.text());
    calls.push([new URL(request.url).pathname, request.method, payload]);
    if (payload === 'reset') {
      return new Response(
        JSON.stringify({
          snapshot: {
            version: 1,
            managedTurns: 0,
            injections: 0,
            injectedBytes: 0,
            turnsByMode: { off: 0, lite: 0, full: 0, ultra: 0 },
            modeSwitches: 0,
            commandCalls: 0,
            firstAt: null,
            lastAt: null,
            revision: 0,
          },
          assumption: 'x',
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    }
    throw new Error('channel offline');
  };
  const wrapped = {
    ...ctx,
    inject(deps, callback) {
      state.deps.push(deps);
      const scope = {
        configForms: { get: () => form },
        effect(factory) {
          const disposer = factory();
          return typeof disposer === 'function' ? disposer : () => {};
        },
        slots: {
          inject(_key, callback) {
            const disposer = callback();
            return typeof disposer === 'function' ? disposer : () => {};
          },
          register(entry, component) {
            state.registered.push({ entry, component });
            return () => {};
          },
        },
      };
      callback(scope);
      return Promise.resolve({ dispose: () => {} });
    },
  };
  try {
    client.apply(wrapped);
    await settle();
  } finally {
    globalThis.fetch = realFetch;
  }
  const face = state.registered[0].entry.inject();
  assert.equal(typeof face.stats.refresh, 'function');
  assert.equal(typeof face.stats.reset, 'function');
  assert.equal(face.stats.snapshot, null, '首次读取失败时不留半截数据');
  assert.equal(face.stats.status, 'error', '通道不通必须是可见的错误态，不是空态');
  const outcome = await face.stats.reset();
  assert.equal(outcome.ok, true);
  assert.equal(face.stats.snapshot.managedTurns, 0);
  assert.deepEqual(calls.map((call) => call[2]), [null, 'reset']);
  assert.equal(calls[0][0], '/api/ponytail-stats/snapshot', '端点路径与服务端 Fetch 路由必须是同一份契约');
  assert.equal(calls[0][1], 'POST', '服务端只认 POST');
});

test('订阅时才开始轮询，退订即停；快照引用只在有新结果时换', async () => {
  const client = await loadClient();
  const form = fakeForm();
  const calls = [];
  const { ctx, state } = fakeCtx({ forms: form });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (request) => {
    calls.push([new URL(request.url).pathname, request.method, JSON.parse(await request.text())]);
    return new Response(
      JSON.stringify({
        snapshot: {
          version: 1,
          managedTurns: calls.length,
          injections: 0,
          injectedBytes: 0,
          turnsByMode: { off: 0, lite: 0, full: calls.length, ultra: 0 },
          modeSwitches: 0,
          commandCalls: 0,
          firstAt: 1,
          lastAt: 2,
          revision: calls.length,
        },
        assumption: 'x',
      }),
      { headers: { 'content-type': 'application/json' } },
    );
  };
  const wrapped = {
    ...ctx,
    inject(deps, callback) {
      state.deps.push(deps);
      callback({
        configForms: { get: () => form },
        effect(factory) {
          const disposer = factory();
          return typeof disposer === 'function' ? disposer : () => {};
        },
        slots: {
          inject(_key, fn) {
            const disposer = fn();
            return typeof disposer === 'function' ? disposer : () => {};
          },
          register(entry, component) {
            state.registered.push({ entry, component });
            return () => {};
          },
        },
      });
      return Promise.resolve({ dispose: () => {} });
    },
  };
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    client.apply(wrapped);
    await settle();
    const face = state.registered[0].entry.inject();
    const store = face.hooks.statsStore;
    const before = calls.length;
    assert.ok(before >= 1, '挂载时先拉一次');

    const first = store.getSnapshot();
    assert.equal(store.getSnapshot(), first, '没有新结果时必须返回同一个引用，否则面板每帧重渲染');
    assert.equal(first.port, face.stats, '快照里的 port 就是注入给面板的那个读接口');

    let notified = 0;
    const unsubscribe = store.subscribe(() => {
      notified += 1;
    });
    mock.timers.tick(2000);
    await settle();
    assert.equal(calls.length, before + 1, '订阅之后每 STATS_POLL_MS 重读一次');
    assert.ok(notified > 0, '重读有结果时要叫醒订阅者');
    const second = store.getSnapshot();
    assert.notEqual(second, first, '有新结果后必须换引用，否则面板看不见变化');
    assert.equal(second.port, first.port);

    const afterUnsubscribe = calls.length;
    unsubscribe();
    mock.timers.tick(6000);
    await settle();
    assert.equal(calls.length, afterUnsubscribe, '退订后不再打宿主端点');
    assert.equal(store.getSnapshot(), second, '没人订阅时也不再换引用');
  } finally {
    mock.timers.reset();
    globalThis.fetch = realFetch;
  }
});
