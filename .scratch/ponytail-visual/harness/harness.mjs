/**
 * 极简客户端 bundle 宿主替身。真 bundle 只 require 三个 external 包
 * （react / react/jsx-runtime / primitives），这里照着形状补三样宿主环境：
 * `window.__ModuleLoader__`、`useSyncExternalStore`、页面 `fetch`。
 *
 * 面板组件由本文件**直接调用**渲染（不经过 react-dom），所以要给 React 的
 * dispatcher 塞一个最小实现，让 useState / useEffect / useMemo 在组件体里可用。
 */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const react = require('react');
const realUseSync = react.useSyncExternalStore;
react.useSyncExternalStore = (subscribe, getSnapshot) => getSnapshot();

import { createElement as h } from 'react';
import * as primitivesStub from './stubs/primitives.mjs';

const requireStub = (name) => {
  if (name === 'clsx') return (args) => (Array.isArray(args) ? args.filter(Boolean).join(' ') : '');
  if (name.endsWith('.module.css')) return {};
  if (name === '@deepseek-ai/dsh-client-ui-primitives') return { ...primitivesStub, default: undefined };
  return require(name);
};

/** 用一次渲染的 hooks 槽位表。 */
let slots = [];
let index = 0;

/**
 * 假元素：`useCompactWidth` 只向 `ref.current.getBoundingClientRect()` 要宽度。
 * 宽度由 `boot()` 给，于是同一个面板能被渲染成宽栏与紧凑两版——否则紧凑
 * 排版永远测不到（`ResizeObserver` 在 Node 里不会真的报尺寸）。
 */
let panelWidth = 900;
const FAKE_ELEMENT = { getBoundingClientRect: () => ({ width: panelWidth }) };

function makeDispatcher() {
  return {
    useState(initial) {
      const slot = (slots[index++] ??= { value: typeof initial === 'function' ? initial() : initial });
      return [slot.value, (next) => { slot.value = typeof next === 'function' ? next(slot.value) : next; }];
    },
    useRef(initial) {
      return (slots[index++] ??= { current: initial === null ? FAKE_ELEMENT : initial });
    },
    useMemo(factory) {
      return (slots[index++] ??= { value: factory() }).value;
    },
    useCallback(fn) {
      return fn;
    },
    useEffect(fn) {
      queueMicrotask(() => fn());
      return undefined;
    },
    useLayoutEffect() {
      return undefined;
    },
    useContext() {
      return undefined;
    },
    useSyncExternalStore(subscribe, getSnapshot) {
      return getSnapshot();
    },
    useId() {
      return 'id-' + String(index++);
    },
    useReducer(reducer, initial) {
      const slot = (slots[index++] ??= { value: initial });
      return [slot.value, (action) => { slot.value = reducer(slot.value, action); }];
    },
    useTransition() {
      return [false, (fn) => fn()];
    },
    useDebugValue() {},
    useDeferredValue(value) {
      return value;
    },
    useImperativeHandle() {},
    useInsertionEffect() {},
  };
}

const internals =
  react.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE ??
  react.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
const dispatcherRef = internals?.ReactCurrentDispatcher ?? internals?.H;

/** 再渲染一次：保留槽位（状态还在），只把读取位置归零。 */
export function rerender() {
  index = 0;
  dispatcherRef.current = makeDispatcher();
}

/** 重置为一次新渲染：清空槽位，装上 dispatcher。 */
export function resetDispatcher() {
  slots = [];
  index = 0;
  dispatcherRef.current = makeDispatcher();
}

/** 卸掉 dispatcher，导入期不打扰 React 自己的状态。 */
export function clearDispatcher() {
  slots = [];
  index = 0;
  dispatcherRef.current = null;
}

export async function boot(rootDir, pageFetch, width = 900) {
  panelWidth = width;
  clearDispatcher();
  globalThis.fetch = pageFetch;
  // 紧凑分支靠这三样：量宽、合并帧、观察尺寸。桩成同步执行，渲染一次就能出结果。
  globalThis.requestAnimationFrame = (fn) => { fn(); return 0; };
  globalThis.cancelAnimationFrame = () => {};
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  const source = await readFile(new URL('lib/client.js', rootDir), 'utf8');
  let entry = null;
  globalThis.window = { __ModuleLoader__: { load: (e) => { entry = e; return e; } } };
  new Function('module', 'exports', 'require', source)({ exports: {} }, {}, requireStub);
  const exports = entry.factory(requireStub);
  return {
    apply: exports.apply,
    restore: () => { react.useSyncExternalStore = realUseSync; clearDispatcher(); },
  };
}
