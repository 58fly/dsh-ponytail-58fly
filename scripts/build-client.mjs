/**
 * 把 `src/client/index.ts` 打成 `lib/client.js`。
 *
 * **为什么不用上游的做法**：上游 `scripts/build-client.mjs` 在一个 Node 脚本里
 * 用模板字符串拼出**整个**客户端文件（1400+ 行 JSX 以文本形式存在），代价是
 * 这批代码完全没有类型检查、没有编辑器高亮、没有 lint；脚本自己的注释都写着
 * "内联在字符串模板里极易被误编辑"。我们改成真 `.tsx` 源码 + esbuild 打包，
 * 类型由 `tsc --noEmit` 覆盖（见 `src/client/panel.tsx`），本脚本只负责
 * 最后一道"外壳"。
 *
 * **外壳为什么必须存在**：宿主页面通过 `window.__ModuleLoader__.load()` 收取
 * 客户端 bundle（契约见 `@deepseek-ai/dsh-client-modules` 的
 * `ClientBundleRegistration`：`{ id, chunk?, factory }`，factory 收到一个
 * `require`）。esbuild 的 CJS 产物正好以 `require("x")` 的形式请求外部模块，
 * 所以把产物包进 `factory: (require) => {...}` 即可，不需要再拼任何业务代码。
 *
 * **external 名单的来历**：宿主页面只提供固定的模块表（staticModules，11 个键），
 * 不在这张表里的裸包名在运行时 `require` 会失败。名单从页面构建产物中抄出，
 * 见 `HOST_MODULES` 的注释；名单外的依赖一律被 esbuild 内联进 bundle。
 */
import { build } from 'esbuild';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const entry = join(root, 'src', 'client', 'index.ts');
const outfile = join(root, 'lib', 'client.js');

/**
 * `src/client/` 里**不含 JSX、不 import 宿主包**的纯模块，另外单独打一份 ESM
 * 到 `lib/client/`。
 *
 * 为什么不是 .tsx：那两个文件是浏览器外壳，import 了 React 与宿主 primitives，
 * Node 里既 import 不到（宿主的 `clsx` 没装）也无法用 tsc 编译成 ESM
 * （tsc 只产 CJS，而本包的 package.json 是 `"type": "module"`，CJS 产物连
 * 相对 import 都会炸）。纯模块没有这个包袱，单独出一份就能被 `node --test`
 * 直接测——归因是这次改造唯一的纯逻辑，值得这条通道。
 */
const PURE_MODULES = ['attribution.ts'];

/**
 * 宿主页面提供（`dsh-web-frontend` 的 staticModules）的模块，必须 external。
 * 名单来源：`dist/assets/index-*.js` 中的模块表字面量。
 */
const HOST_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  'zod',
  '@tanstack/react-virtual',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
];

const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

const result = await build({
  entryPoints: [entry],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'browser',
  target: ['es2022'],
  jsx: 'automatic',
  external: HOST_MODULES,
  charset: 'utf8',
  legalComments: 'none',
  logLevel: 'warning',
});

const [output] = result.outputFiles;
if (!output) throw new Error('esbuild 没有产出文件');

/** 缩进一次，让外壳里的产物仍可读（源码映射靠 tsc 的 declarationMap，不靠这里）。 */
const body = output.text
  .split('\n')
  .map((line) => (line.length > 0 ? '      ' + line : line))
  .join('\n');

const shell = `// 由 scripts/build-client.mjs 生成，请勿手改。
// 源码：src/client/index.ts（及同目录 .tsx）。改源码后重跑 \`pnpm run build\`。
window.__ModuleLoader__.load({
  id: ${JSON.stringify(pkg.name)},
  factory: (require) => {
    const module = { exports: {} };
    (function (module) {
${body}
    })(module);
    return module.exports;
  },
});
`;

await mkdir(dirname(outfile), { recursive: true });
await writeFile(outfile, shell, 'utf8');

const size = Buffer.byteLength(shell);
console.log(`client bundle -> lib/client.js (${size} bytes, id=${pkg.name})`);

/** 构建期断言：external 名单里的每一项都必须真的被产物 require 到，或至少不被内联。 */
const reqs = new Set();
for (const m of shell.matchAll(/require\("([^"]+)"\)/g)) reqs.add(m[1]);
const unknown = [...reqs].filter((r) => !HOST_MODULES.includes(r));
if (unknown.length > 0) {
  throw new Error(
    `客户端产物 require 了宿主不提供的模块：${unknown.join(', ')}。` +
      '要么加进 HOST_MODULES（仅当宿主页面确实提供），要么让源码不再依赖它。',
  );
}
console.log(`external requires: ${[...reqs].sort().join(', ') || '(无)'}`);

/* 纯模块单独出一份 ESM：单文件、不打包、不 external——它们本来就零依赖。 */
await mkdir(join(root, 'lib', 'client'), { recursive: true });
for (const file of PURE_MODULES) {
  await build({
    entryPoints: [join(root, 'src', 'client', file)],
    outfile: join(root, 'lib', 'client', file.replace(/\.ts$/, '.js')),
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: ['es2022'],
    logLevel: 'warning',
  });
}
console.log(`pure client modules -> lib/client/ (${PURE_MODULES.join(', ')})`);
