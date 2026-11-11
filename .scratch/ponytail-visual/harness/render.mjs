/**
 * 真面板 · 静态原型：用真 `lib/client.js` 里的 `apply()` 接线，拿真 `PonytailPanel`
 * 渲染，再交给 `vdom.mjs` 转 HTML。被替换的只有宿主环境（window / 服务 / 统计通道）。
 *
 * 为什么不用 react-dom/server：本仓的 `node_modules` 里没有 react-dom（宿主 bundle
 * 里它是 external，由页面提供），原型也不该为了截图引入依赖。
 */
import { writeFile } from 'node:fs/promises';
import { boot, rerender, resetDispatcher, setExpandHelp } from './harness.mjs';
import { toHtml } from './vdom.mjs';

const here = new URL('./', import.meta.url);
const root = new URL('../../../', import.meta.url);

const STATS = {
  managedTurns: 128, injections: 96, injectedBytes: 40960, modeSwitches: 7, commandCalls: 21,
  turnsByMode: { off: 12, lite: 38, full: 71, ultra: 7 },
  firstAt: 1760000000000, lastAt: 1760086000000,
};

const m = (v) => ({ defaultMode: v });
const SCENARIOS = {
  'b-clean': { config: { status: 'ready', writable: true, revision: 12, value: m('full'), base: m('full') }, stats: STATS },
  'a-shaded': { config: { status: 'ready', writable: true, revision: 12, value: m('ultra'), base: m('full'), user: m('lite') }, stats: STATS },
  'd-invalid': { config: { status: 'ready', writable: true, revision: 12, value: m('full'), base: m('full'), user: m('bogus') }, stats: STATS },
  'e-compact': { config: { status: 'ready', writable: true, revision: 12, value: m('ultra'), base: m('full'), user: m('lite') }, stats: STATS },
  'f-320': { config: { status: 'ready', writable: true, revision: 12, value: m('ultra'), base: m('full'), user: m('lite') }, stats: STATS },
  'g-invalid-320': { config: { status: 'ready', writable: true, revision: 12, value: m('full'), base: m('full'), user: m('bogus') }, stats: STATS },
  'c-empty': { config: { status: 'ready', writable: true, revision: 12, value: m('full'), base: m('full') }, stats: { ...STATS, managedTurns: 0, injections: 0, injectedBytes: 0, modeSwitches: 0, commandCalls: 0, turnsByMode: { off: 0, lite: 0, full: 0, ultra: 0 }, firstAt: null, lastAt: null } },
};

/** 统计通道桩：真面板通过页面 `fetch` 打 `/api/ponytail-stats/snapshot`，原型直接回一份快照。 */
let activeStats = null;
const pageFetch = async (_request) => new Response(JSON.stringify({ snapshot: activeStats, assumption: '' }), { status: 200, headers: { 'content-type': 'application/json' } });


/* 宿主 renderer 注入的 `useSnapshot`：原型里直接给固定快照。 */
let activeConfig = null;

const panels = {};

/** 面板宽度：只有紧凑场景才收窄，其余按侧栏默认宽度渲染。 */
const WIDTHS = { 'e-compact': 420, 'f-320': 320, 'g-invalid-320': 320 };

for (const [name, scenario] of Object.entries(SCENARIOS)) {
  // 每个场景重新求值一次 bundle：面板模块是单例，复用会把上一份统计带过来。
  activeStats = scenario.stats;
  const app = await boot(root, pageFetch, WIDTHS[name] ?? 900);
  let spec = null;
  const form = {
    getSnapshot: () => scenario.config,
    subscribe: () => () => {},
    set: async () => true,
    unset: async () => true,
  };
  const sidebar = { mounted: { getSnapshot: () => 'session-1' }, openResource: () => {} };
  const ctx = {
    inject(names, callback) {
      callback({
        configForms: { get: () => form },
        sidebarRight: sidebar,
        effect: (fn) => fn(),
        slots: { inject: (slot, fn) => fn(), register: (s, component) => { spec = { ...s, component }; } },
        logger: (scope) => ({ warn: (m) => process.stderr.write('[warn ' + scope + '] ' + m + '\n'), info() {}, debug() {} }),
      });
      return Promise.resolve();
    },
    logger: (scope) => ({ warn: (m) => process.stderr.write('[warn ' + scope + '] ' + m + '\n'), info() {}, debug() {} }),
  };
  app.apply(ctx);
  activeStats = scenario.stats;
  activeConfig = scenario.config;
  await new Promise((r) => setTimeout(r, 30));
  const props = spec.inject();
  resetDispatcher();
  const element = () => spec.component({ ...props, useSnapshot: () => activeConfig });
  element();
  // 让 effect 里那次 `setCompact` 落地，再重生一次——紧凑排版只在第二遍出现。
  await new Promise((resolve) => setTimeout(resolve, 0));
  rerender();
  panels[name] = toHtml(element());
  resetDispatcher();
}

/* 第二轮：把七个 `?` 全打开再渲一遍，专门量悬浮卡宽度与是否被截。 */
setExpandHelp(true);
const opened = {};
for (const [name, scenario] of Object.entries(SCENARIOS)) {
  if (!['b-clean', 'a-shaded', 'd-invalid', 'e-compact', 'f-320'].includes(name)) continue;
  activeStats = scenario.stats;
  const app = await boot(root, pageFetch, WIDTHS[name] ?? 900);
  let spec = null;
  const form = { getSnapshot: () => scenario.config, subscribe: () => () => {}, set: async () => true, unset: async () => true };
  const ctx = {
    inject(names, callback) {
      callback({
        configForms: { get: () => form },
        sidebarRight: { mounted: { getSnapshot: () => 'session-1' }, openResource: () => {} },
        effect: (fn) => fn(),
        slots: { inject: (slot, fn) => fn(), register: (s, component) => { spec = { ...s, component }; } },
        logger: (scope) => ({ warn: (m) => process.stderr.write('[warn ' + scope + '] ' + m + '\n'), info() {}, debug() {} }),
      });
      return Promise.resolve();
    },
    logger: (scope) => ({ warn: (m) => process.stderr.write('[warn ' + scope + '] ' + m + '\n'), info() {}, debug() {} }),
  };
  app.apply(ctx);
  await new Promise((r) => setTimeout(r, 30));
  const props = spec.inject();
  resetDispatcher();
  const element = () => spec.component({ ...props, useSnapshot: () => scenario.config });
  element();
  await new Promise((resolve) => setTimeout(resolve, 0));
  rerender();
  opened[name] = toHtml(element());
  resetDispatcher();
}
await writeFile(new URL('./out/panels-help.json', here), JSON.stringify(opened, null, 2), 'utf8');

await writeFile(new URL('./out/panels.json', here), JSON.stringify(panels, null, 2), 'utf8');
for (const [name, html] of Object.entries(panels)) process.stdout.write(`${name}: ${html.length} bytes\n`);
