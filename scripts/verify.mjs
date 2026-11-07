/**
 * 产物与仓库纯度检查（`pnpm run verify`）。
 *
 * 为什么需要它：上游 `scripts/verify.mjs` 只检查"文件存在"与"目录存在"，
 * 于是 `lib/` 提交进 Git 后产物漂移、`as` 断言悄悄变多、分层被反向 import
 * 都不会被任何检查拦住——这些正是我们重构要消灭的东西，必须变成红灯。
 *
 * 每条检查失败都给出"哪个文件、哪一行、怎么改"，不接受只报一句失败。
 */
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── 自检模式（`node scripts/verify.mjs --selftest`）─────────────────────────
/**
 * 为什么 verify 自己要带 --selftest：
 *
 * 有些纯度断言在"干净仓库"里永远为绿——没人会真的把 `new Function` 写进产物，
 * 也没人会故意让 cordis.patch.yml 的 id 漂掉。于是"这条检查是活的"本身成了
 * 一个无法证明的声明。`--selftest` 把**同一批扫描函数**喂给人为构造的脏输入，
 * 要求每个扫描器都报红；扫描器漏报就说明这条卡口是装饰，verify 直接失败。
 *
 * 它同时是 #11 的验收证据来源："三份纯度/清单脚本都有失败用例"这句话在这里
 * 变成可复现的一条命令。
 */
const SELFTEST = process.argv.includes('--selftest');

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

/** 收集失败项，最后一次性报出（避免改一条跑一次的来回）。 */
const failures = [];
/** 未到本票范围、但要提醒的项。 */
const warnings = [];

/**
 * @param condition - 检查是否通过。
 * @param message - 失败时的完整说明（含怎么改）。
 */
function check(condition, message) {
  if (!condition) failures.push(message);
}

/** 读文本，读不到返回 null（不抛）。 */
async function readText(path) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

/** 递归列出目录下的文件（相对 root，统一用 / 分隔）。 */
async function listFiles(dir) {
  const out = [];
  const walk = async (current) => {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out.push(relative(root, full).split(sep).join('/'));
    }
  };
  await walk(dir);
  return out.sort();
}

/**
 * 把注释内容替换成等长空白，保留换行与字符串字面量。
 *
 * 存在的理由：本仓库在多处注释里**引用**了要禁止的写法（例如解释
 * "上游只能靠 (ctx as unknown as {...}) 双重断言调 section"），
 * 朴素的行内 substring 搜索会把解释文字判成违规。只扫描代码区，
 * 行号保持不变，报错位置才对得上。
 */
function stripComments(text) {
  let out = '';
  let i = 0;
  /** @type {'code' | 'line' | 'block' | '"' | "'" | '`'} */
  let mode = 'code';
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (mode === 'code') {
      if (ch === '/' && next === '/') { mode = 'line'; out += '  '; i += 2; continue; }
      if (ch === '/' && next === '*') { mode = 'block'; out += '  '; i += 2; continue; }
      if (ch === '"' || ch === "'" || ch === '`') { mode = ch; out += ch; i += 1; continue; }
      out += ch; i += 1; continue;
    }
    if (mode === 'line') {
      out += ch === '\n' ? '\n' : ' ';
      if (ch === '\n') mode = 'code';
      i += 1; continue;
    }
    if (mode === 'block') {
      if (ch === '*' && next === '/') { mode = 'code'; out += '  '; i += 2; continue; }
      out += ch === '\n' ? '\n' : ' ';
      i += 1; continue;
    }
    // 字符串字面量内部：原样保留（转义跳两格），避免把 '//' 当注释。
    if (ch === '\\') { out += ch + (next ?? ''); i += 2; continue; }
    if (ch === mode) { mode = 'code'; out += ch; i += 1; continue; }
    out += ch; i += 1; continue;
  }
  return out;
}

// ── 1. package.json 的身份与依赖面 ────────────────────────────────────────
const pkgText = await readText(join(root, 'package.json'));
check(pkgText !== null, 'package.json 不存在');
const pkg = pkgText === null ? {} : JSON.parse(pkgText);

const l0PathsText = await readText(join(root, 'src/l0/paths.ts'));
const pluginId = /export const PLUGIN_ID = '([^']+)'/.exec(l0PathsText ?? '')?.[1];
check(pluginId !== undefined, 'src/l0/paths.ts 里找不到 PLUGIN_ID 常量');

// 包名 = dsh-<PLUGIN_ID>：前缀 dsh- 是 npm 生态里"这是个 dsh 插件"的约定，
// 后缀必须与 PLUGIN_ID 一致，否则配置目录、槽位 key、模块 id 会指向三处不同的名字。
check(
  pluginId !== undefined && pkg.name === `dsh-${pluginId}`,
  `package.json#name（${pkg.name}）必须是 dsh-<PLUGIN_ID> 形态，即 dsh-${pluginId ?? '<missing>'}：` +
    '两者不一致会让配置目录、槽位 key、模块 id 指向不同的地方。',
);

const deps = pkg.dependencies ?? {};
check(
  Object.keys(deps).length === 0,
  `v0.1 的运行时依赖定案是零依赖，但 package.json#dependencies 有 ${Object.keys(deps).join(', ')}：` +
    'dsh plugin add <本地目录> 生成的是 link:，pnpm 不会装插件的 dependencies，' +
    '任何运行时 import 都会 ERR_MODULE_NOT_FOUND。要加依赖必须同时改这条定案。',
);

const peer = pkg.peerDependencies ?? {};
const peerKeys = Object.keys(peer).sort();
check(
  JSON.stringify(peerKeys) === JSON.stringify(['@deepseek-ai/cordis', '@deepseek-ai/schemastery']),
  `peerDependencies 只应有 @deepseek-ai/cordis 与 @deepseek-ai/schemastery，实际是 ${peerKeys.join(', ') || '(空)'}：` +
    '写 @deepseek-ai/dsh 之类会被宿主 unmetRequirements 的 startsWith("@deepseek-ai/dsh-") 过滤掉，' +
    '永远不生效，只会误导读者。',
);

check(
  typeof pkg.engines?.dsh === 'string' && pkg.engines.dsh.includes('<0.2.3-0'),
  'engines.dsh 必须是 >=0.2.0-rc.1 <0.2.3-0 形态：' +
    '宿主 unmetRequirements 看到 engines.dsh 会直接 return，不再检查 peerDependencies，' +
    '这是唯一的版本闸门；且 <0.2.3-0 才能排除 0.3.0 系列。',
);

check(
  typeof pkg.dsh?.bundle?.patch === 'string',
  'package.json#dsh.bundle.patch 缺失：宿主靠它把插件插进 profile 的配置图。',
);

// ── 1b. dsh.client 声明与客户端源码必须互相印证 ────────────────────────────
/**
 * **双向检查，因为两个方向的坏法不一样**：
 *
 *   有声明、无注册 → 宿主装出一张只有标题的空卡片（#11 ⑥ 的「半张 UI」）；
 *   有注册、无声明 → 宿主**根本不装载这个包**（`$H/dsh-client-modules/lib/index.js:789-790`
 *                    见到 `decl === void 0` 直接 `return null`），源码在、产物也在，
 *                    真机上永远不出现——#14 就是这个状态。
 *
 * 只查一边，另一半就能悄悄漂掉；两边一起才把「说一套做一套」钉死。
 *
 * 形状判据取自宿主 `parseDshClient`（`$H/dsh-client-modules/lib/index.js:86-100`）；
 * `exports["./client"]` 缺失会被同文件 `:792` 直接抛错。
 */

/** 宿主真正读的四个声明键，多写一个都是没人读的死键。 */
const CLIENT_DECLARATION_KEYS = ['platform', 'inject', 'external', 'immediately'];

/**
 * 判定 `dsh.client` 声明的形状是否符合宿主的 `parseDshClient`。
 * @param declaration - `package.json#dsh.client` 的原始值。
 * @returns 不合规原因；合规或整段缺席时 undefined。
 */
function judgeClientDeclaration(declaration) {
  if (declaration === undefined) return undefined;
  if (typeof declaration !== 'object' || declaration === null) return 'dsh.client 必须是对象';
  const unknown = Object.keys(declaration).filter((key) => !CLIENT_DECLARATION_KEYS.includes(key));
  if (unknown.length > 0) return `dsh.client 有宿主不读的键：${unknown.join(', ')}（只认 ${CLIENT_DECLARATION_KEYS.join('/')}）`;
  if (typeof declaration.platform !== 'string') return 'dsh.client.platform 必须是字符串';
  if (declaration.platform !== 'web') {
    return `dsh.client.platform 必须是 "web"，实际是 ${JSON.stringify(declaration.platform)}：宿主 resolveMeta 对别的平台直接 return null，等于整段白写`;
  }
  for (const field of ['inject', 'external']) {
    const value = declaration[field];
    if (value === undefined) continue;
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
      return `dsh.client.${field} 必须是字符串数组`;
    }
  }
  if (declaration.immediately !== undefined && typeof declaration.immediately !== 'boolean') {
    return 'dsh.client.immediately 必须是布尔';
  }
  if (Array.isArray(declaration.inject) && !declaration.inject.every((name) => name.startsWith('@deepseek-ai/dsh-client-'))) {
    return `dsh.client.inject 必须是 @deepseek-ai/dsh-client-* 全名：${JSON.stringify(declaration.inject)}。宿主按包名查模块图，短名会被静默跳过。`;
  }
  return undefined;
}

/**
 * 判定「声明」与「源码注册动作」是否互相印证。
 * @param input - 三个观测点。
 * @param input.declaration - `package.json#dsh.client`。
 * @param input.registers - 客户端源码里是否存在 `slots.register` / `slots.inject` 调用。
 * @param input.exportsField - `package.json#exports`。
 * @returns 全部不合规原因；合规时为空数组。
 */
function judgeClientWiring({ declaration, registers, exportsField }) {
  const problems = [];
  const shape = judgeClientDeclaration(declaration);
  if (shape !== undefined) problems.push(shape);
  if (declaration !== undefined) {
    const key = typeof exportsField === 'object' && exportsField !== null ? exportsField['./client'] : undefined;
    const target = typeof key === 'string' ? key : key?.default;
    if (typeof target !== 'string') {
      problems.push(
        '声明了 dsh.client 却没有 exports["./client"]：宿主 resolveMeta 会抛 ' +
          '"declares dsh.client but exports no \'./client\' bundle"，插件装不起来。',
      );
    }
  }
  if (registers && declaration === undefined) {
    problems.push(
      'src/client 里有槽位注册动作，但 package.json 没有 dsh.client：' +
        '宿主 resolveMeta 见到 decl === undefined 直接 return null，客户端半边根本不装载，面板在真机上永远不出现。',
    );
  }
  if (!registers && declaration !== undefined) {
    problems.push(
      '声明了 dsh.client，但 src/client 里没有任何 slots.register / slots.inject：' +
        '宿主会装出一张只有标题的空卡片，正是 #11 ⑥ 要避免的「半张 UI」。',
    );
  }
  return problems;
}

/** 客户端源码里是否有真的槽位注册动作（注释里的说明不算）。 */
const CLIENT_REGISTRATION = /\bslots\s*\.\s*(?:register|inject)\s*\(/;

const clientBlock = pkg.dsh?.client;
const clientSourceText = await readText(join(root, 'src/client/index.ts'));
check(
  clientSourceText !== null,
  'src/client/index.ts 不存在：它是 v0.2 唯一的客户端入口，删掉它就要同时删 package.json#dsh.client。',
);
const clientRegisters = clientSourceText !== null && CLIENT_REGISTRATION.test(stripComments(clientSourceText));
const clientProblems = judgeClientWiring({
  declaration: clientBlock,
  registers: clientRegisters,
  exportsField: pkg.exports,
});
check(
  clientProblems.length === 0,
  'dsh.client 的声明与客户端源码对不上：\n    - ' + clientProblems.join('\n    - '),
);

// ── 2. 构建产物 ──────────────────────────────────────────────────────────
const pluginJs = await readText(join(root, 'lib/plugin.js'));
check(pluginJs !== null, 'lib/plugin.js 不存在：先跑 pnpm run build');
if (pluginJs !== null) {
  check(/export\s*\{[^}]*\bapply\b/.test(pluginJs) || /export\s+(async\s+)?function\s+apply/.test(pluginJs),
    'lib/plugin.js 没有导出 apply：Cordis 要求函数式插件导出 apply。');
  check(/export\s*\{[^}]*\binject\b/.test(pluginJs) || /export\s+const\s+inject/.test(pluginJs),
    'lib/plugin.js 没有导出 inject：宿主据此判断依赖是否就绪。');
  check(/export\s*\{[^}]*\bConfig\b/.test(pluginJs) || /export\s+const\s+Config/.test(pluginJs),
    'lib/plugin.js 没有导出 Config：设置面板靠它生成表单，缺了就没有 UI。');
}

const clientJs = await readText(join(root, 'lib/client.js'));
check(clientJs !== null, 'lib/client.js 不存在：先跑 pnpm run build');
if (clientJs !== null) {
  check(
    clientJs.includes('__ModuleLoader__.load('),
    'lib/client.js 不是 ModuleLoader 外壳：宿主页面用 window.__ModuleLoader__.load({id, factory}) 收 bundle。',
  );
  check(
    clientJs.includes(JSON.stringify(pkg.name)),
    `lib/client.js 的模块 id 必须等于包名 ${pkg.name}：id 与包名不一致会让模块图把两处当成不同条目。`,
  );
  check(
    !clientJs.includes('@wenaixi/'),
    'lib/client.js 里还有 @wenaixi/ 字样：改名没改干净，客户端会 require 不存在的模块。',
  );
  const requires = [...clientJs.matchAll(/require\("([^"]+)"\)/g)].map((m) => m[1]);
  const hostProvided = new Set([
    'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client',
    '@deepseek-ai/cordis', 'zod', '@tanstack/react-virtual',
    '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-slots',
    '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-dockkit',
  ]);
  const stray = [...new Set(requires)].filter((name) => !hostProvided.has(name));
  check(stray.length === 0, `lib/client.js require 了宿主页面不提供的模块：${stray.join(', ')}`);
}

const dts = await listFiles(join(root, 'lib/types'));
check(dts.length > 0, 'lib/types/ 没有 .d.ts 产物：tsconfig.build.json 的 declarationDir 没生效？');
check(
  dts.some((file) => file.endsWith('plugin.d.ts')),
  'lib/types/plugin.d.ts 不存在：package.json#types 指向它，缺了等于没有类型。',
);

// lib/ 不得混入源码或测试（.d.ts 与 .d.ts.map 是声明产物，不算源码）。
const libFiles = await listFiles(join(root, 'lib'));
const junk = libFiles.filter(
  (file) =>
    !file.endsWith('.d.ts') &&
    !file.endsWith('.d.ts.map') &&
    (file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.test.mjs')),
);
check(junk.length === 0, `lib/ 里混进了源码或测试文件：${junk.join(', ')}`);

// ── 2b. 产物的运行时依赖面（零依赖定案的机器化检查） ──────────────────────
/**
 * 服务端产物只允许三类 import：
 *   - `node:` 内置模块；
 *   - 相对路径；
 *   - 宿主 profile 里真实可解析的两个 peer（cordis、schemastery）。
 *
 * 为什么必须机器化：宿主 profile 的 node_modules 只有 cosmokit 与 schemastery
 * （实测 `createRequire('~/.dsh/profiles/desktop/package.json').resolve('@deepseek-ai/dsh-skill')`
 * 报 MODULE_NOT_FOUND），`@deepseek-ai/dsh-*` 这类包只活在 App 打包树里，
 * **不参与插件自己的解析**。所以任何 `import ... from '@deepseek-ai/dsh-xxx'`
 * 的值导入都会在安装后第一次装载时 ERR_MODULE_NOT_FOUND——而上游正是因为
 * 对这类包全用 `import type`（编译后擦除）才活下来的。
 * 类型导入在 .d.ts 里合法，在 .js 里非法，所以这条只查 lib 下的 .js。
 */
const RUNTIME_ALLOWED_BARE = new Set(['@deepseek-ai/cordis', '@deepseek-ai/schemastery']);
for (const file of libFiles.filter((name) => name.endsWith('.js'))) {
  const code = await readText(join(root, file));
  if (code === null) continue;
  const specifiers = [...code.matchAll(/(?:^|\n)\s*(?:import|export)[^;]*?from\s*'([^']+)'/g)].map((m) => m[1]);
  for (const specifier of specifiers) {
    if (specifier.startsWith('node:') || specifier.startsWith('.')) continue;
    check(
      RUNTIME_ALLOWED_BARE.has(specifier),
      `${file} 在运行时 import 了 ${specifier}：宿主 profile 解析不到它（只有 cordis 与 schemastery），` +
        '装完第一次装载就 ERR_MODULE_NOT_FOUND。要么改成 import type，要么把它加进 RUNTIME_ALLOWED_BARE 并解释理由。',
    );
  }
}

// ── 3. 分层方向与循环依赖 ────────────────────────────────────────────────
/**
 * 允许的依赖方向（只列更下层）：
 *   plugin.ts  —— 装配入口，可以引用全部四层
 *   四层        —— 只可引用 l0
 *   client/**  —— 只可引用 l0（浏览器 bundle 里不能出现 node: 内置模块）
 * l0 不依赖任何自研层。
 */
const LAYERS = ['l0', 'prompt', 'state', 'config', 'skills'];
const ALLOWED_DEPENDENCIES = new Map([
  ['l0', []],
  ['prompt', ['l0']],
  ['state', ['l0']],
  ['config', ['l0']],
  ['skills', ['l0']],
  ['client', ['l0']],
]);

const sources = (await listFiles(join(root, 'src'))).filter(
  (file) => file.endsWith('.ts') || file.endsWith('.tsx'),
);
const sourceSet = new Set(sources);

/** 判断某个源文件属于哪个层；`src/plugin.ts` 记为 'root'。 */
function layerOf(file) {
  const segment = file.split('/')[1];
  if (segment === undefined) return null;
  if (file === 'src/plugin.ts') return 'root';
  return LAYERS.includes(segment) || segment === 'client' ? segment : 'root';
}

/** 把相对说明符解析成仓内源文件路径（NodeNext 的 .js → .ts/.tsx 映射）。 */
function resolveSpecifier(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null;
  const base = join(dirname(fromFile), specifier).split(sep).join('/');
  const candidates = base.endsWith('.js')
    ? [`${base.slice(0, -3)}.ts`, `${base.slice(0, -3)}.tsx`]
    : [`${base}.ts`, `${base}.tsx`, base];
  return candidates.find((candidate) => sourceSet.has(candidate)) ?? null;
}

/** fromFile → 它 import 的仓内源文件列表（含 type-only import：类型也会绑死依赖方向）。 */
function importsOf(text, fromFile) {
  const specifiers = [...text.matchAll(/(?:from|import)\s+'([^']+)'/g)].map((m) => m[1]);
  const out = [];
  for (const specifier of specifiers) {
    const resolved = resolveSpecifier(fromFile, specifier);
    if (resolved !== null) out.push(resolved);
  }
  return out;
}

const graph = new Map();
const stripped = new Map();
for (const file of sources) {
  const raw = await readText(join(root, file));
  if (raw === null) continue;
  const code = stripComments(raw);
  stripped.set(file, code);
  graph.set(file, importsOf(code, file));
}

for (const [file, targets] of graph) {
  const fromLayer = layerOf(file);
  if (fromLayer === null || fromLayer === 'root') continue;
  const allowed = ALLOWED_DEPENDENCIES.get(fromLayer) ?? [];
  for (const target of targets) {
    const toLayer = layerOf(target);
    if (toLayer === null || toLayer === fromLayer || toLayer === 'root') {
      check(toLayer !== 'root',
        `${file} 引用了装配入口 ${target}：四层不得反向依赖 plugin.ts，装配顺序只由它单向表达。`);
      continue;
    }
    check(allowed.includes(toLayer),
      `${file} 引用了 ${toLayer} 层（${target}）：分层的允许方向是 ` +
        `plugin.ts → {prompt,state,config,skills} → l0，${fromLayer} 只可引用 ${allowed.join('、') || '（无，l0 必须自足）'}。`);
  }
}

// 循环依赖：DFS 找环，报出完整环路（只报同层互引会漏掉 A→B→A 这种跨文件环）。
const VISITING = 1;
const DONE = 2;
const visitState = new Map();
const stack = [];
const reportedCycles = new Set();
function walkCycle(file) {
  const state = visitState.get(file) ?? 0;
  if (state === DONE) return;
  if (state === VISITING) {
    const start = stack.indexOf(file);
    const cycle = [...stack.slice(start), file].join(' → ');
    if (!reportedCycles.has(cycle)) {
      reportedCycles.add(cycle);
      failures.push(`检测到循环依赖：${cycle}。环会让模块初始化顺序依赖加载顺序，` +
        '公用逻辑应下沉到 l0，或抽成该层的 index.ts 门面单向引用。');
    }
    return;
  }
  visitState.set(file, VISITING);
  stack.push(file);
  for (const target of graph.get(file) ?? []) {
    if (graph.has(target)) walkCycle(target);
  }
  stack.pop();
  visitState.set(file, DONE);
}
for (const file of graph.keys()) walkCycle(file);

// ── 4. 类型断言纪律 ──────────────────────────────────────────────────────
let asUnknownAs = 0;
let bangCount = 0;
for (const [file, code] of stripped) {
  for (const [index, line] of code.split('\n').entries()) {
    if (line.includes('as unknown as')) {
      asUnknownAs += 1;
      failures.push(
        `${file}:${index + 1} 出现 \`as unknown as\`：这是上游 72 处断言的根源，本项目要求零处。`,
      );
    }
    // 非空断言（!）只可能出现在成员访问 / 调用 / 索引之前；逻辑非 !x 的 ! 前面不是标识符。
    if (/[A-Za-z0-9_\])]!\s*[.([]/.test(line)) bangCount += 1;
  }
}
check(asUnknownAs === 0, `全仓 \`as unknown as\` 应为 0 处，实际 ${asUnknownAs} 处`);
if (bangCount > 0) {
  warnings.push(`非空断言 ! 出现 ${bangCount} 处（上游是 4 处），请确认每一处都确实不可能为 null`);
}

// 客户端目录不得 import 服务端层（会把 node:fs 拖进浏览器 bundle）。
// 这条已在第 3 组用 ALLOWED_DEPENDENCIES 覆盖，此处只做冗余提示，防止有人放宽矩阵。
for (const [file, targets] of graph) {
  if (!file.startsWith('src/client/')) continue;
  for (const target of targets) {
    if (!target.startsWith('src/client/') && !target.startsWith('src/l0/')) {
      failures.push(`${file} 引用了 ${target}：客户端 bundle 里不能出现服务端模块（会带上 node: 内置依赖）。`);
    }
  }
}

// ── 5. L0 必须无 node: 依赖 ──────────────────────────────────────────────
for (const file of sources) {
  if (!file.startsWith('src/l0/')) continue;
  const code = stripped.get(file) ?? '';
  check(
    !/from\s+'node:/.test(code),
    `${file} import 了 node: 内置模块：l0 要同时被浏览器端与服务端引用，必须零 node: 依赖。`,
  );
}

// ── 6. package.json#files 白名单与实际产物一致 ───────────────────────────
/**
 * 这一组曾经只做字符串比对（"files 里有没有 lib/plugin.js"），结果放过了
 * 一个真事故：files 只写 lib/plugin.js 时，tarball 里只有那一个文件，
 * 而 lib/ 下另有 9 个被相对 import 的模块（config/schema.js、l0/mode.js …），
 * 用户装完第一次装载就是 ERR_MODULE_NOT_FOUND。
 * 所以改成把 files 的模式展开成 glob，再拿真实产物去撞：一个都不能漏。
 */
const filesField = pkg.files ?? [];

/**
 * 把 glob 模式转成正则源。支持本项目用到的全部写法：
 *   双星后紧跟斜杠 —— 零个或多个目录段（关键：lib 下双层 js 模式必须能匹配到
 *                    lib/plugin.js 这种只隔一层的文件，否则直接漏检）
 *   `**`   任意字符
 *   `*`    路径段内任意字符
 * 其余字符按字面量转义。
 */
function globToRegExpSource(pattern) {
  let out = '';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        if (pattern[i + 2] === '/') {
          out += '(?:.*/)?';
          i += 3;
        } else {
          out += '.*';
          i += 2;
        }
        continue;
      }
      out += '[^/]*';
      i += 1;
      continue;
    }
    if ('\\.+^${}()|[]?'.includes(ch)) {
      out += '\\' + ch;
      i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** 把 npm files 的一条模式转成正则；以 / 结尾的目录模式匹配其下一切。 */
function filesPatternToRegExp(pattern) {
  if (pattern.endsWith('/')) {
    return new RegExp('^' + globToRegExpSource(pattern.slice(0, -1)) + '/');
  }
  return new RegExp('^' + globToRegExpSource(pattern) + '$');
}
const filesMatchers = filesField.map(filesPatternToRegExp);
const coveredBy = (file) => filesMatchers.some((matcher) => matcher.test(file));

// 必须发布的产物：lib 下每一个 .js 与 .d.ts 都得命中 file 模式。
const shipped = libFiles.filter((file) => file.endsWith('.js') || file.endsWith('.d.ts'));
const uncovered = shipped.filter((file) => !coveredBy(file));
check(
  uncovered.length === 0,
  `这些产物没有被 package.json#files 覆盖，用户装完 import 时会 ERR_MODULE_NOT_FOUND：${uncovered.join(', ')}` +
    `（当前 files = ${JSON.stringify(filesField)}；要覆盖整个产物树就写 lib/**/*.js 与 lib/types/**/*.d.ts）`,
);

// 反向：声明映射与 sourcemap 不该进发布物（体积翻倍且对用户无用）。
// 这条要在 libFiles 全集上判，不能只看 shipped —— shipped 本来就不含 .map。
const leaked = libFiles.filter((file) => file.endsWith('.map') && coveredBy(file));
check(
  leaked.length === 0,
  `sourcemap 被 package.json#files 覆盖到了：${leaked.join(', ')}。写 lib/**/*.js 会连 .js.map 一起带进发布物，要改成显式排除或接受它。`,
);

// cordis.patch.yml 是 dsh.bundle.patch 指向的文件，漏了安装直接失败。
check(coveredBy('cordis.patch.yml'), 'package.json#files 没有覆盖 cordis.patch.yml：dsh.bundle.patch 指向它，装了也起不来。');
check(
  !filesField.some((item) => item === 'src/' || item === 'docs/' || item === 'test/'),
  'package.json#files 不应包含 src/ docs/ test/：它们只是仓库内容，不该进 tarball。',
);

/**
 * bundle patch 里 skillDir 必须使用的包内标记。
 *
 * 与 src/l0/paths.ts 的 PACKAGE_ROOT_TOKEN 是同一个字符串；这里独立写一份而不是
 * 从源码里抠，是为了让 verify 与源码**互为校验**（两边都改了才算对）。
 */
const PACKAGE_ROOT_TOKEN = '$' + '{package}';
/**
 * 从 bundle patch 全文里取出 skillDir 的值。
 * @param text - cordis.patch.yml 全文。
 * @returns 声明值，未声明时 undefined。
 */
function readDeclaredSkillDir(text) {
  return /skillDir:\s*"?([^"\n]+)"?/.exec(text)?.[1]?.trim();
}
/**
 * 判定 skillDir 声明是否合规（必须存在且以包内标记开头）。
 * @param text - cordis.patch.yml 全文。
 * @returns 不合规原因；合规时 undefined。
 */
function judgeSkillDirDeclaration(text) {
  const value = readDeclaredSkillDir(text);
  if (value === undefined) return '未声明';
  if (!value.startsWith(PACKAGE_ROOT_TOKEN)) return '没走标记：' + value;
  return undefined;
}

const patchFile = await readText(join(root, 'cordis.patch.yml'));
check(patchFile !== null, 'cordis.patch.yml 不存在：dsh.bundle.patch 指向它，缺了安装会失败');
if (patchFile !== null) {
  check(
    patchFile.includes(pkg.name),
    `cordis.patch.yml 里没有包名 ${pkg.name}：宿主要靠它把插件插进配置图。`,
  );
  check(
    pluginId !== undefined && patchFile.includes(pluginId),
    `cordis.patch.yml 里的 id 必须等于 PLUGIN_ID（${pluginId ?? '<missing>'}）：id 与包名不一致会让配置图的条目名与配置命名空间对不上。`,
  );
  check(!patchFile.includes('@wenaixi/'), 'cordis.patch.yml 里还有 @wenaixi/ 字样：改名没改干净。');

  // skillDir 必须走包内标记。三种写法各有各的坏法：
  //   裸相对路径 → 按 $DSH_HOME 解析，落到 $DSH_HOME/node_modules/… 这个不存在的位置；
  //   绝对路径   → 只对某台机器的某种布局成立，发布物里写死必然有一半用户装完是空的；
  //   干脆不写   → 退回 $DSH_HOME/<PLUGIN_ID>/skills（用户自定义目录，本包零写盘永不写），
  //                装完技能面 0 个——"装完即用"就不成立了。
  const skillDirVerdict = judgeSkillDirDeclaration(patchFile);
  check(
    skillDirVerdict === undefined,
    'cordis.patch.yml 的 skillDir 不合规（' + skillDirVerdict + '）：' +
      '必须用 ' + PACKAGE_ROOT_TOKEN + ' 标记指向包自身。缺省值是 $DSH_HOME 下的用户自定义目录，' +
      '装完技能面会是 0 个；裸相对路径会被按 $DSH_HOME 解析到不存在的位置；绝对路径只对一种安装布局成立。',
  );
  // 标记本身也得在源码里真的有实现，否则 patch 写了个谁也不认识的字符串。
  check(
    l0PathsText?.includes('PACKAGE_ROOT_TOKEN') === true && l0PathsText?.includes(PACKAGE_ROOT_TOKEN.slice(1)) === true,
    'src/l0/paths.ts 里找不到 PACKAGE_ROOT_TOKEN 的 ' + PACKAGE_ROOT_TOKEN + ' 实现：patch 里的标记没有对应的解析。',
  );
}

// ── 7. 技能目录（内容校验交给 scripts/check-skills.mjs） ────────────────────
// 这里只看"发布物里到底有没有技能"：skills/ 已进 package.json 的 files，
// 目录空了就是发了半个插件，所以从提醒升级为失败。
const skillDirs = (await readdir(join(root, 'skills'), { withFileTypes: true }).catch(() => null)) ?? [];
const skillCount = skillDirs.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.')).length;
check(skillCount > 0, 'skills/ 下没有任何技能目录：六个技能是发布物的一部分，check:skills 会说得更细');
if (skillCount > 0) {
  warnings.push(`skills/ 有 ${skillCount} 个技能目录；内容合规性由 pnpm run check:skills 校验`);
}

// ── 8. README 与 LICENSE（npm 发布必需） ─────────────────────────────────
check((await readText(join(root, 'README.md'))) !== null, 'README.md 不存在');
check((await readText(join(root, 'LICENSE'))) !== null, 'LICENSE 不存在：package.json 声明 MIT，必须带上正文');

// ── 9. 纯度：#11 产物纯度三项（白名单已在 2b，这里补禁 eval 与清单一致性） ──
/**
 * 为什么禁 new Function / eval(：
 *
 * 宿主装载插件走的是 ESM（`@deepseek-ai/cordis-plugin-loader` 的
 * HostResolvedRootInclude 用 `internal.import(specifier, baseUrl, {})` 解析包名），
 * 产物的模块身份由 URL 决定。任何一处 `new Function(...)` / `eval(...)` 都会：
 *   1) 绕过这条解析路径，把宿主 profile 的 baseUrl 变成隐式契约；
 *   2) 在宿主开了 CSP / `--disallow-code-generation-from-strings` 的嵌入场景里直接抛错；
 *   3) 让"产物是纯静态 ESM"这条发布声明变成假话。
 * 我们一次都没用过它，所以这条检查的失败用例只能是**人为注入**的：脚本
 * `--selftest` 会把一行注入探针喂给同一个扫描函数，证明它真的会红。
 */
const DYNAMIC_CODE_PATTERNS = [
  { label: 'new Function(', pattern: /\bnew\s+Function\s*\(/ },
  { label: 'eval(', pattern: /(^|[^.\w$])eval\s*\(/ },
];
function scanDynamicCode(code) {
  return DYNAMIC_CODE_PATTERNS.filter(({ pattern }) => pattern.test(code)).map(({ label }) => label);
}
const shippedJs = libFiles.filter((name) => name.endsWith('.js'));
const dynamicHits = [];
for (const file of shippedJs) {
  const code = await readText(join(root, file));
  if (code === null) continue;
  const strippedCode = stripComments(code);
  for (const label of scanDynamicCode(strippedCode)) dynamicHits.push(`${file} 用了 ${label}`);
}
check(
  dynamicHits.length === 0,
  `产物里出现动态代码执行：${dynamicHits.join('；')}。宿主用 ESM 装载插件，动态代码会绕开模块解析并在 CSP 场景下抛错。`,
);

// ── 9b. 纯度：禁止值导入宿主私有实现细节（子路径导入） ───────────────────
/**
 * #2b 只盯**包名**白名单（@deepseek-ai/cordis | @deepseek-ai/schemastery），
 * 它挡不住 `@deepseek-ai/cordis/lib/loader.js` 这种子路径导入——包名对了，
 * 但把宿主的内部文件布局当成了公开契约，宿主换一次打包布局就断。
 * 公开面只有包根或 package.json 里 exports 声明过的子路径。
 */
const DEEP_SUBPATH = /^(@[^/]+\/[^/]+)\/([^/]+(?:\/[^/]+)*)$/;
/**
 * 找出代码里所有指向宿主包子路径的值导入。
 *
 * @param code - 已剥注释的源码。
 * @param selfName - 本包名，自引用不在此列。
 * @returns 违规的 specifier 清单。
 */
function scanDeepSubpathImports(code, selfName) {
  const hits = [];
  for (const match of code.matchAll(/(?:^|\n)\s*(?:import|export)[^;]*?from\s*'([^']+)'/g)) {
    const specifier = match[1];
    const sub = DEEP_SUBPATH.exec(specifier);
    if (sub === null) continue;
    if (sub[1] === selfName) continue;
    hits.push(specifier);
  }
  return hits;
}
const deepHits = [];
for (const file of shippedJs) {
  const code = await readText(join(root, file));
  if (code === null) continue;
  for (const specifier of scanDeepSubpathImports(stripComments(code), pkg.name)) {
    deepHits.push(`${file} 导入了 ${specifier}`);
  }
}
check(
  deepHits.length === 0,
  `产物里有子路径导入宿主包：${deepHits.join('；')}。宿主只承诺包根，内部文件布局随时会变。`,
);

// ── 10. 清单卡口：package.json 声明必须与源码/磁盘一致 ────────────────────
/**
 * 主题：**声明即真相**。三处声明最容易和实现漂移，各钉一条：
 *   1) exports['./client'] 指向的文件必须在 disks 上——宿主 dsh-client-modules
 *      的 clientExportOf 只认这个键，指向不存在的文件会静默不回落到别处；
 *   2) exports['./locale/*.json'] 对应的目录必须存在——子路径导出指向空目录时，
 *      npm 照发，用户 import 才炸；
 *   3) cordis.patch.yml 里的 id/name 必须逐字节等于 PLUGIN_ID 与包名——本文件
 *      是 dsh.bundle.patch 的落点，id 漂了会让设置命名空间与配置目录对不上。
 */
/**
 * 从 cordis.patch.yml 里读出真正被插入配置图的 id 与 name。
 *
 * 只认 `- id: X` 与 `name: Y` 这两种形状——本仓的 patch 只有 insert 一种
 * 语义（bundle patch 只负责把插件挂上去，改别人由用户层补丁做），所以不需要
 * 通用 YAML 解析；不引 yaml 依赖是刻意的，verify 要能在零依赖下跑。
 *
 * @param text - cordis.patch.yml 的全文。
 * @returns id 行与 name 行的有序清单。
 */
function parsePatchIdentity(text) {
  const patchRows = text
    .split('\n')
    .map((line) => /^\s*-\s*id:\s*(\S+)\s*$/.exec(line)?.[1])
    .filter((id) => id !== undefined);
  const patchNames = text
    .split('\n')
    .map((line) => /^\s*name:\s*["']?([^"'\s]+)["']?\s*$/.exec(line)?.[1])
    .filter((name) => name !== undefined && !name.startsWith('.'));
  return { patchRows, patchNames };
}

const exportEntries = Object.entries(pkg.exports ?? {});
const missingExportTargets = [];
for (const [key, value] of exportEntries) {
  const target = typeof value === 'string' ? value : value?.default ?? value?.import;
  if (typeof target !== 'string' || target.includes('*')) continue;
  if (!existsSync(join(root, target.replace(/^\.\//, '')))) missingExportTargets.push(`${key} -> ${target}`);
}
check(
  missingExportTargets.length === 0,
  `exports 指向了不存在的文件：${missingExportTargets.join('；')}。宿主按 exports 查模块图，缺文件等于入口失效。`,
);
for (const [key, value] of exportEntries) {
  if (!key.includes('*')) continue;
  const prefix = value?.default ?? value?.import ?? (typeof value === 'string' ? value : undefined);
  if (typeof prefix !== 'string') continue;
  const dir = dirname(join(root, prefix.replace(/^\.\//, '')));
  check(
    existsSync(dir),
    `exports['${key}'] 指向不存在的目录 ${dir}：要么建目录放占位文件，要么把这条子路径导出删掉。`,
  );
}

if (patchFile !== null) {
  const { patchRows, patchNames } = parsePatchIdentity(patchFile);
  check(
    patchRows.length > 0,
    'cordis.patch.yml 里没有任何 "- id: ..." 行：dsh.bundle.patch 指向的文件要能插进配置图。',
  );
  check(
    patchRows.every((id) => id === pluginId),
    `cordis.patch.yml 的 id 必须全部等于 PLUGIN_ID（${pluginId ?? '<missing>'}），实际是 ${JSON.stringify(patchRows)}。`,
  );
  check(
    patchNames.includes(pkg.name),
    `cordis.patch.yml 的 name 里没有包名 ${pkg.name}，实际是 ${JSON.stringify(patchNames)}。`,
  );
}

// ── 11. 零垃圾承诺：插件源码不得自己写盘 ─────────────────────────────────
/**
 * 为什么这条是硬约束：插件的全部持久状态都由宿主
 * `ctx.settings`（`handle.forms.mutate(PLUGIN_ID, ops, revision)`）代管，
 * 自己写盘就会在用户家目录里留下卸载后清不掉的残渣。所以"零垃圾"在源码层是
 * 一条可机器化的否定断言：**一个写盘 API 都不许出现**。
 */
const WRITE_APIS = /\b(writeFileSync|writeFile|mkdirSync|mkdir|appendFileSync|appendFile|unlinkSync|unlink|renameSync|rename|rmSync|rm|cpSync|createWriteStream)\b/;
const diskWriters = [];
for (const file of sources) {
  const code = await readText(join(root, file));
  if (code === null) continue;
  if (WRITE_APIS.test(stripComments(code))) diskWriters.push(file);
}
check(
  diskWriters.length === 0,
  `源码里出现写盘调用：${diskWriters.join('，')}。插件状态一律交给 ctx.settings，自己写盘会留下卸载残渣。`,
);

// ── 12. --selftest：每条纯度扫描器必须对自己的脏输入报红 ─────────────────
/**
 * 每个用例形如 { name, run, expect }：run 返回"扫描器判定的失败"，expect 是
 * 期望看到的失败（用于断言"报红的原因就是我以为的那一条"，而不是别的偶发失败）。
 * 扫描器漏报 → 这里的 check 就红，于是 --selftest 本身也失败。
 */
if (SELFTEST) {
  const selfCases = [
    {
      name: '动态代码扫描器识别 new Function',
      run: () => scanDynamicCode('const f = new Function("return 1");')[0],
      expect: 'new Function(',
    },
    {
      name: '动态代码扫描器识别 eval',
      run: () => scanDynamicCode('const v = eval("1 + 1");')[0],
      expect: 'eval(',
    },
    {
      name: '动态代码扫描器不误报方法名',
      run: () => scanDynamicCode('const v = obj.eval(1); const w = "x.eval(1)";')[0],
      expect: undefined,
    },
    {
      name: '写盘扫描器识别 writeFileSync',
      run: () => (WRITE_APIS.test(stripComments('import { writeFileSync } from \'node:fs\'; writeFileSync(p, 1);')) ? 'hit' : undefined),
      expect: 'hit',
    },
    {
      name: '写盘扫描器不误报注释里的 mkdir',
      run: () => (WRITE_APIS.test(stripComments('// 这里刻意不 mkdir，交给宿主\nconst a = 1;')) ? 'hit' : undefined),
      expect: undefined,
    },
    {
      name: 'patch 解析器认出漂掉的 id',
      run: () => {
        const { patchRows, patchNames } = parsePatchIdentity('- insert:\n    - id: drift-id\n      name: "dsh-ponytail-58fly"\n');
        return patchRows.every((id) => id === pluginId) ? undefined : `id 漂移：${JSON.stringify(patchRows)}`;
      },
      expect: `id 漂移：${JSON.stringify(['drift-id'])}`,
    },
    {
      name: 'patch 解析器认出被改名掉的 name',
      run: () => {
        const { patchNames } = parsePatchIdentity('- insert:\n    - id: ' + String(pluginId) + '\n      name: "some-other-package"\n');
        return patchNames.includes(pkg.name) ? undefined : `name 不含包名：${JSON.stringify(patchNames)}`;
      },
      expect: `name 不含包名：${JSON.stringify(['some-other-package'])}`,
    },
    {
      name: 'files 覆盖判定认出没进白名单的产物',
      run: () => (coveredBy('lib/not-in-files.js') ? undefined : 'lib/not-in-files.js 未被 files 覆盖'),
      expect: undefined,
    },
    {
      name: '白名单判定拒绝宿主私有包',
      run: () => (RUNTIME_ALLOWED_BARE.has('@deepseek-ai/dsh-skill') ? undefined : '拒绝 @deepseek-ai/dsh-skill'),
      expect: '拒绝 @deepseek-ai/dsh-skill',
    },
    {
      name: '子路径扫描器认出宿主内部文件',
      run: () => {
        const hits = scanDeepSubpathImports("import x from '@deepseek-ai/cordis/lib/loader.js'", pkg.name);
        return hits.length === 1 ? hits[0] : undefined;
      },
      expect: '@deepseek-ai/cordis/lib/loader.js',
    },
    {
      name: 'skillDir 判据认出没走标记的裸相对路径',
      run: () => judgeSkillDirDeclaration('- insert:\n    - id: ' + String(pluginId) + '\n      config:\n        skillDir: "skills"\n'),
      expect: '没走标记：skills',
    },
    {
      name: 'skillDir 判据认出干脆没声明',
      run: () => judgeSkillDirDeclaration('- insert:\n    - id: ' + String(pluginId) + '\n'),
      expect: '未声明',
    },
    {
      name: 'skillDir 判据放过走了标记的声明',
      run: () => judgeSkillDirDeclaration('- insert:\n    - id: ' + String(pluginId) + '\n      config:\n        skillDir: "' + PACKAGE_ROOT_TOKEN + '/skills"\n'),
      expect: undefined,
    },
    {
      name: 'dsh.client 联动判据认出「有注册无声明」',
      run: () => {
        const problems = judgeClientWiring({
          declaration: undefined,
          registers: true,
          exportsField: { './client': { default: './lib/client.js' } },
        });
        return problems.some((p) => p.includes('根本不装载')) ? '有注册无声明' : undefined;
      },
      expect: '有注册无声明',
    },
    {
      name: 'dsh.client 联动判据认出「有声明无注册」',
      run: () => {
        const problems = judgeClientWiring({
          declaration: { platform: 'web', inject: ['@deepseek-ai/dsh-client-ui-settings'] },
          registers: false,
          exportsField: { './client': { default: './lib/client.js' } },
        });
        return problems.some((p) => p.includes('半张 UI')) ? '有声明无注册' : undefined;
      },
      expect: '有声明无注册',
    },
    {
      name: 'dsh.client 联动判据认出平台写错',
      run: () => {
        const problems = judgeClientWiring({
          declaration: { platform: 'node', inject: ['@deepseek-ai/dsh-client-ui-settings'] },
          registers: true,
          exportsField: { './client': { default: './lib/client.js' } },
        });
        return problems.some((p) => p.includes('platform 必须是 "web"')) ? 'platform 写错' : undefined;
      },
      expect: 'platform 写错',
    },
    {
      name: 'dsh.client 联动判据认出 inject 写了短名',
      run: () => {
        const problems = judgeClientWiring({
          declaration: { platform: 'web', inject: ['dsh-client-ui-settings'] },
          registers: true,
          exportsField: { './client': { default: './lib/client.js' } },
        });
        return problems.some((p) => p.includes('必须是 @deepseek-ai/dsh-client-* 全名')) ? 'inject 短名' : undefined;
      },
      expect: 'inject 短名',
    },
    {
      name: 'dsh.client 联动判据放过合规声明',
      run: () => {
        const problems = judgeClientWiring({
          declaration: { platform: 'web', inject: ['@deepseek-ai/dsh-client-ui-settings'] },
          registers: true,
          exportsField: { './client': { default: './lib/client.js' } },
        });
        return problems.length === 0 ? '放过' : problems.join('|');
      },
      expect: '放过',
    },
    {
      name: '子路径扫描器放过包根',
      run: () => {
        const hits = scanDeepSubpathImports("import { Context } from '@deepseek-ai/cordis'", pkg.name);
        return hits.length === 0 ? '放过' : hits.join(',');
      },
      expect: '放过',
    },
  ];
  let selfPassed = 0;
  for (const testCase of selfCases) {
    let actual;
    try {
      actual = testCase.run();
    } catch (error) {
      actual = `抛错：${error instanceof Error ? error.message : String(error)}`;
    }
    if (actual === testCase.expect) {
      selfPassed += 1;
      console.log(`  ✓ selftest · ${testCase.name}`);
    } else {
      check(
        false,
        `selftest 失败 · ${testCase.name}：期望 ${JSON.stringify(testCase.expect)}，实际 ${JSON.stringify(actual)}。` +
          '扫描器漏报会让这条卡口变成装饰，必须先修扫描器。',
      );
    }
  }
  console.log(`--selftest：${selfPassed}/${selfCases.length} 条扫描器用例通过`);
}

// ── 汇总 ────────────────────────────────────────────────────────────────
for (const warning of warnings) console.warn(`warn: ${warning}`);
if (failures.length > 0) {
  console.error(`\nverify 失败 ${failures.length} 项：\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}\n`);
  process.exit(1);
}
console.log(
  `verify 通过（${sources.length} 个源文件，${libFiles.length} 个产物文件，${warnings.length} 条提醒）`,
);