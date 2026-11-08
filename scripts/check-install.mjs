#!/usr/bin/env node
/**
 * 安装形态端到端验证：把打好的包真的装进一个"像 DSH profile 的目录"里，再 import 起来。
 *
 * 它证明两件事，这两件事在开发机上永远暴露不出来：
 *   1. 运行时依赖真的为零 —— 那个临时 profile 里只装 cordis 与 schemastery（宿主 profile
 *      里真实存在的两个 @deepseek-ai 包），插件能装载，就说明产物没有偷偷 import 别的东西。
 *      这条不是 verify 的重复：verify 查的是产物文本里的说明符，这里查的是 pnpm 装完之后
 *      Node 的解析器真的能找到它。
 *   2. files 白名单带上了运行时需要的东西 —— lib/plugin.js、lib/client.js、cordis.patch.yml
 *      任何一个漏在包外，用户装完就是一插件加载失败。
 *
 * 为什么非要进 CI：宿主 profile 的 node_modules 只有 cosmokit 与 schemastery，
 * 对 @deepseek-ai/dsh-* 的值导入在开发机上不会报错（devDependencies 里都有），
 * 只会在用户装完第一次装载时 ERR_MODULE_NOT_FOUND。这个脚本把那个瞬间提前到 CI。
 *
 * 模式 `assemble` 是 #11 加的：前两种模式只证明"包能 import"，装完插件到底有没有
 * 进配置图、技能面是不是六个、切档重启后是否还在，全都证明不了。assemble 用一个
 * 自建的 cordis 根（Loader + Include），按 profile 真实形态把
 * system-prompt / skill / skill-filesystem / commands / 插件 装进同一棵树，
 * 然后断言：
 *   1. `ctx.skills.list()` 里有六个 ponytail-* 技能；
 *   2. `ctx.systemPrompt.assemble()` 里的 `ponytail-58fly` section 非空；
 *   3. 换档位重启后 section 内容随之变化（off → full → ultra）；
 *   4. 整个过程在 `$DSH_HOME` 里不新增任何路径（零垃圾）。
 * 它不认识 dsh-app-boot：那玩意儿的 bundle 层会去解析几十个 @deepseek-ai/dsh-*，
 * 在零依赖 profile 里必然 ERR_MODULE_NOT_FOUND，与本包无关。
 *
 * 用法：
 *   node scripts/check-install.mjs --mode tarball --tarball ./dsh-ponytail-58fly-0.1.0.tgz
 *   node scripts/check-install.mjs --mode link
 *   node scripts/check-install.mjs --mode assemble --tarball ./dsh-ponytail-58fly-0.1.0.tgz
 *   node scripts/check-install.mjs --mode assemble --selftest
 */

import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PNPM = process.env.PNPM ?? 'pnpm';

/** 解析 --mode / --tarball 两个参数。 */
function parseArgs(argv) {
  const out = { mode: 'link', tarball: null, selftest: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--mode') {
      out.mode = argv[++i];
    } else if (arg === '--tarball') {
      out.tarball = argv[++i];
    } else if (arg === '--selftest') {
      out.selftest = true;
    } else {
      throw new Error('未知参数 ' + arg);
    }
  }
  if (out.mode !== 'tarball' && out.mode !== 'link' && out.mode !== 'assemble') {
    throw new Error('--mode 只能是 tarball、link 或 assemble');
  }
  if (out.selftest) return out;
  if ((out.mode === 'tarball' || out.mode === 'assemble') && out.tarball === null) {
    throw new Error('--mode ' + out.mode + ' 必须配 --tarball <路径>');
  }
  return out;
}

/**
 * 宿主 profile 里真实存在的两个 @deepseek-ai 包。
 * 这个列表写死是有意的：它描述的是"宿主给了什么"，不是"我们希望有什么"。
 * 将来要是宿主 profile 多了包，这里必须手动加 —— 加之前先问一句"用户机器上真有吗"。
 */
const HOST_PROVIDED = {
  '@deepseek-ai/cordis': '~4.1.0',
  '@deepseek-ai/schemastery': '~3.19.0',
};

/**
 * 宿主 profile 里"顺带就在"的包：它们不是我们声明的依赖，是 cordis 自己被装进来时
 * 带下来的传递依赖。列在这里只是为了让下面的"多出包"提示保持安静，不是许可清单。
 */
const HOST_INCIDENTAL = new Set(['@deepseek-ai/cosmokit']);

/** 照 dsh-app-boot 的 PROFILE_PNPM_WORKSPACE 模板写 profile 的 workspace 文件。 */
const PROFILE_WORKSPACE = ['packages:', '  - .', '', 'nodeLinker: hoisted', 'autoInstallPeers: false', ''].join('\n');

const args = parseArgs(process.argv.slice(2));
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const pluginName = pkg.name;

// ── 1. 准备一个像 profile 的临时目录 ──────────────────────────────────────
const profileDir = await mkdtemp(join(tmpdir(), 'pt-install-'));
console.log('profile 目录：' + profileDir);

/** 探针自己的 $DSH_HOME：独立于装配探针的临时 home，装前/装后/卸载后都在这一份上比对。 */
const profileHome = join(profileDir, 'dsh-home');

/**
 * 递归列出目录下所有**文件**的相对路径（相对 homePath）。
 * 只收文件、不收目录：空目录不影响"零写盘"，而且不同 pnpm 版本建的空目录不一样。
 */
async function snapshotHome(homePath) {
  const out = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out.push(full.slice(homePath.length));
    }
  }
  if (existsSync(homePath)) await walk(homePath);
  return out;
}

async function dependencySpecifier() {
  if (args.mode === 'link') return 'link:' + root;
  const tarball = isAbsolute(args.tarball) ? args.tarball : resolve(root, args.tarball);
  const info = await stat(tarball).catch(() => null);
  if (info === null) throw new Error('tarball 不存在：' + tarball);
  // 把 tarball 复制进 profile 目录，避免 pnpm 的 file: 相对路径歧义。
  const local = join(profileDir, 'plugin.tgz');
  await cp(tarball, local);
  return 'file:./plugin.tgz';
}

/**
 * 装 profile 依赖。
 *
 * assemble 模式要把 cordis 的 Loader / Include / Group 装进来，它们不在
 * HOST_PROVIDED 里（宿主是从自己的打包树解析的），所以额外钉三个包：
 * 它们随 cordis 4.1.0 的 peerDependencies（~1.1.0）走，写死版本号会让矩阵
 * 在 cordis 抬版本那天静默失配，所以这里用 cordis 自带的 peer 约束 —— 即
 * 不写版本，让 npm 按 cordis 的 peer 解析。
 */
const DSH_VERSION = process.env.PT_DSH_VERSION ?? '0.2.2-rc.1';
const ASSEMBLE_EXTRA = {
  // dsh-skill / dsh-system-prompt / dsh-commands / dsh-skill-filesystem 是 **peer**，
  // 宿主从自己的打包树里给它们；探针必须显式装进来，否则 ctx.skills 根本不存在。
  // 版本由 PT_DSH_VERSION 指定，矩阵 CI 每个宿主版本跑一次，这样"装得上"是逐版本
  // 证明的，而不是"在 latest 上碰巧装得上"。
  '@deepseek-ai/dsh-skill': DSH_VERSION,
  '@deepseek-ai/dsh-system-prompt': DSH_VERSION,
  '@deepseek-ai/dsh-commands': DSH_VERSION,
  '@deepseek-ai/dsh-skill-filesystem': DSH_VERSION,
  // dsh-skill 自己的 peer：宿主打包树里本来就有，pnpm + autoInstallPeers:false 不会替我们装。
  '@deepseek-ai/dsh-scope': DSH_VERSION,
  '@deepseek-ai/dsh-llm': DSH_VERSION,
  '@deepseek-ai/cordis-plugin-loader': '^1.1.0',
  '@deepseek-ai/cordis-plugin-include': '^1.1.0',
  '@deepseek-ai/cordis-plugin-group': '^1.1.0',
  // 宿主自己的客户端模块登记服务：用它才能问出“宿主有没有看见我们的客户端半边”。
  // 它只 peer cordis，装进探针 profile 与装在宿主里是同一个实现。
  '@deepseek-ai/dsh-client-modules': DSH_VERSION,
};

/**
 * 客户端产物外壳的判定：文件里有 __ModuleLoader__.load( 外壳，且 load 的 id 就是包名。
 * 不按行号定位 —— 实测外壳出现在前两行注释之后，按行号判会在产物加上第三行注释那天假红。
 */
const MODULE_LOADER_SHELL = /__ModuleLoader__\s*\.\s*load\s*\(/;
/** 宿主抛出来的错误，只取 message；非 Error 才退化成 String。 */
const describeError = (error) => (error instanceof Error ? error.message : String(error));
const MODULE_ID_FIELD = /\bid\s*:\s*["'`]([^"'`]+)["'`]/;

function judgeClientShell(code, expectedId) {
  if (!MODULE_LOADER_SHELL.test(code)) return { ok: false, reason: 'not-a-shell' };
  const id = MODULE_ID_FIELD.exec(code)?.[1];
  if (id !== expectedId) return { ok: false, reason: 'id-mismatch', id };
  return { ok: true, id };
}

/**
 * 宿主没认我们时，说清是哪一种 —— 四种成因的判据各不相同，混成一句“断言失败”等于没报。
 *
 * 前三类读 manifest 就能判（宿主在解析阶段就退出了），第四类要宿主解析成功之后才发现，
 * 所以这里的分类只覆盖“宿主为什么要么返 null 要么抛错”，产物缺失由调用方另说。
 */
function classifyClientMiss(manifest) {
  const client = manifest.dsh !== null && typeof manifest.dsh === 'object' ? manifest.dsh.client : undefined;
  if (client === undefined) {
    return '声明缺失：package.json 的 dsh 段里没有 client，宿主根本不会装载客户端半边';
  }
  if (typeof client !== 'object' || client === null) {
    return '声明形态非法：dsh.client 必须是对象，宿主会直接抛错';
  }
  if (client.platform !== 'web') {
    return '平台不是网页：dsh.client.platform 是 ' + JSON.stringify(client.platform) + '，宿主只认 "web"';
  }
  const mapping = manifest.exports?.['./client'];
  const entry = typeof mapping === 'string' ? mapping : mapping?.default;
  if (typeof entry !== 'string' || entry.length === 0) {
    return '导出映射缺客户端入口：声明了 dsh.client 却拿不到 exports["./client"]，宿主会抛错';
  }
  return null;
}

/**
 * 起一棵“只够问出宿主判定”的最小树：装载器 + 客户端模块登记服务 + 本包一个 entry。
 *
 * 为什么 cordis.yml 必须落在 profile 目录（而不是临时 home）：
 * cordis-plugin-include 会把子树的 baseUrl 设成 cordis.yml 所在目录，而宿主解析包名是从
 * 那个 baseUrl 出发的。真宿主的 profile 目录同时放着 cordis.yml 与 node_modules，探针要是
 * 把 cordis.yml 写进一个没有 node_modules 的临时 home，宿主当然解析不到本包 —— 那不是
 * “宿主没认我们”，是探针自己给错了目录。这一步用唯一文件名，避免多棵树互相覆盖。
 *
 * @param profileDirPath - 装着 node_modules 的 profile 目录（= 真宿主的 profile 形态）。
 * @param pluginNameForEntry - 要装进树的包名。
 * @param tag - 文件名后缀，同一进程里起多棵树时区分。
 */
async function bootDiscoveryTree(profileDirPath, pluginNameForEntry, tag) {
  const { createRequire } = await import('node:module');
  const { pathToFileURL } = await import('node:url');
  const { writeFileSync } = await import('node:fs');
  const req = createRequire(join(profileDirPath, 'probe.cjs'));
  const importFrom = async (specifier) => import(pathToFileURL(req.resolve(specifier)).href);
  const cordis = await importFrom('@deepseek-ai/cordis');
  const Loader = (await importFrom('@deepseek-ai/cordis-plugin-loader')).default;
  const Include = (await importFrom('@deepseek-ai/cordis-plugin-include')).default;
  const clientModules = await importFrom('@deepseek-ai/dsh-client-modules');

  const cfgPath = join(profileDirPath, 'pt-discovery-' + tag + '.yml');
  writeFileSync(cfgPath, JSON.stringify([{ id: pluginNameForEntry, name: pluginNameForEntry }], null, 2));
  const ctx = new cordis.Context();
  // 顶层 baseUrl 只用来解析这个绝对 file URL；子树 baseUrl 由 include 自己改成 cfg 所在目录。
  ctx.baseUrl = pathToFileURL(profileDirPath + '/').href;
  await ctx.plugin(Loader);
  ctx.loader.builtins.include = Include;
  // 登记服务必须在装载器起来之后挂：它的构造函数要读 ctx.loader.entries()，
  // 也要接上 internal/plugin 事件，挂早了什么都看不到。
  await ctx.plugin(clientModules.ClientModuleRegistry);
  await ctx.loader.create({ id: 'include', name: 'cordis:include', config: { path: pathToFileURL(cfgPath).href } });
  await ctx.get('loader').await();
  // 一次 microtask 的 flush 不够：flush 自己也是 queueMicrotask 里跑的，再等一拍让图稳定。
  await new Promise((r) => setTimeout(r, 200));
  return { ctx, cm: ctx.clientModules, serviceAvailable: ctx.get('clientModules') !== undefined };
}

/**
 * 问宿主要五项判定。这是本票的核心：不是“我们自认为声明对了”，是宿主自己认不认。
 *
 * 平台那一项只能间接证明：宿主对 platform 的门禁是“不是 web 就 return null”，
 * 返回值里根本不携带 platform 字段。所以“解析函数返回非空”这条同时证明了平台是网页——
 * 反向自检里把 platform 改成 node 时必须变红，就是这条的证伪面。
 *
 * @param profileDirPath - profile 目录。
 * @param pluginDir - 插件在 node_modules 里的落点（读 manifest 与产物用）。
 * @param tag - 树标识。
 * @param options.checkProvenance - 是否断言“宿主读到的是包里这一份”。反向自检的一复关掉它，
 *   因为副本化之后 link 形态的解析器仍可能指回仓库，那与“宿主有没有认我们”无关。
 * @returns 五项判定 + 原始解析结果，供调用方打印与断言。
 */
async function discoverClient(profileDirPath, pluginDir, tag, options = {}) {
  const { checkProvenance = true } = options;
  const { realpath, readFile } = await import('node:fs/promises');
  const { pathToFileURL } = await import('node:url');
  const manifest = JSON.parse(await readFile(join(pluginDir, 'package.json'), 'utf8'));
  const miss = classifyClientMiss(manifest);
  // 清单本身就是坏的：结论在起树之前就定了，不要再问宿主。
  // 否则宿主可能给出别的说法（link 形态下它甚至会解析回仓库那一份），
  // 把“声明缺失”盖成“产物不是同一个文件”，反向自检就红在错误的文案上。
  if (miss !== null) throw new Error(miss);
  const { ctx, cm, serviceAvailable } = await bootDiscoveryTree(profileDirPath, pluginName, tag);
  try {
    if (!serviceAvailable) {
      throw new Error('宿主客户端模块登记服务没有挂上：ctx.clientModules 不存在，后面五项无从谈起');
    }
    const baseUrl = pathToFileURL(profileDirPath + '/').href;
    // 宿主对"声明了 dsh.client 却拿不到 exports['./client']"是**直接抛错**，不是返 null。
    // 两条失败路径（返 null / 抛错）都要落到同一句分类文案上，否则用户看到的是一句
    // 宿主内部异常，看不出是自己清单写错了。
    let resolved;
    try {
      resolved = cm.resolveMeta(pluginName, baseUrl);
    } catch (error) {
      // 走到这里说明清单四要素都在（否则上面已经抛了），抛错的只能是包本身或探针目录。
      throw new Error('宿主解析本包时抛错：' + describeError(error));
    }
    const graph = cm.graph();
    const row = (graph.entries ?? []).find((entry) => entry.id === pluginName);
    const clientPath = cm.clientPath(pluginName);

    // 宿主没认：按分类给文案，不要只丢一句“取不到”。
    if (resolved === null || resolved === undefined) {
      throw new Error('宿主解析不出本包，但声明的四要素都在 —— 探针给错了 profile 目录或 baseUrl');
    }
    if (row === undefined) {
      throw new Error('模块图里没有本包这一行：宿主解析得到但没登记进图（compose 阶段被丢了）');
    }
    if (typeof clientPath !== 'string' || clientPath.length === 0) {
      throw new Error('按包名取不到客户端产物路径：登记服务里有本包但没记 clientPath');
    }
    // 临时目录在 macOS 上是 /var → /private/var 的软链，两侧必须都规约再比。
    const realClientPath = await realpath(clientPath).catch(() => null);
    if (realClientPath === null) {
      throw new Error('产物文件不存在：宿主指向 ' + clientPath + '，这个路径上什么也没有');
    }
    const realExpected = await realpath(join(pluginDir, 'lib', 'client.js')).catch(() => null);
    if (realExpected === null) {
      throw new Error('包内没有 lib/client.js：files 白名单或构建产物有问题');
    }
    // 归属断言：宿主读到的到底是不是“包里这一份”。
    // 反向自检的“一复”会关掉它 —— 副本化之后 link 形态的解析器仍可能指回仓库那份，
    // 那是解析器的来源归属，不是“宿主有没有认我们”。main 那次永远开着。
    if (checkProvenance && realClientPath !== realExpected) {
      throw new Error('宿主取到的产物与包内的不是同一个文件：宿主 ' + realClientPath + '，包内 ' + realExpected);
    }
    const code = await readFile(realExpected, 'utf8');
    const shell = judgeClientShell(code, pluginName);
    if (!shell.ok) {
      throw new Error(
        shell.reason === 'not-a-shell'
          ? 'lib/client.js 不是 __ModuleLoader__.load 外壳，浏览器端会装不进去'
          : 'lib/client.js 外壳里的模块 id 是 ' + JSON.stringify(shell.id) + '，与包名 ' + JSON.stringify(pluginName) + ' 不一致',
      );
    }
    if (!Array.isArray(resolved.meta.external)) {
      throw new Error('宿主给出的外部依赖不是数组：' + JSON.stringify(resolved.meta.external));
    }
    const declaredClient = manifest.dsh.client;
    const declaredExternal = Array.isArray(declaredClient.external) ? declaredClient.external : [];
    if (resolved.meta.external.join(',') !== declaredExternal.join(',')) {
      throw new Error('宿主读到的外部依赖与声明不一致：声明 ' + JSON.stringify(declaredExternal) + '，宿主 ' + JSON.stringify(resolved.meta.external));
    }
    const realManifest = await realpath(join(pluginDir, 'package.json'));
    // manifestPath 是宿主较新版本才给的字段（dsh-client-modules >= 0.2.2-alpha.2）；
    // 更早的宿主 meta 里只有 clientPath，没有它。compat 矩阵要跨整个 engines.dsh 区间，
    // 所以这条归属断言只能在宿主真给了路径时判定 —— 拿 undefined 去比会把老宿主全判成红。
    const hostManifest = resolved.meta.manifestPath;
    if (checkProvenance && typeof hostManifest === 'string' && hostManifest !== realManifest) {
      throw new Error('宿主读的 manifest 不是包内那一份：宿主 ' + hostManifest + '，包内 ' + realManifest);
    }
    return {
      discovered: true,
      graphHasRow: true,
      clientPath: realClientPath,
      resolveMetaReturned: true,
      platformGate: 'resolveMeta 非 null 即证明 dsh.client.platform === "web"（平台门禁是它唯一的平台判据）',
      external: resolved.meta.external,
      inject: resolved.meta.inject ?? [],
      manifestPath: typeof hostManifest === 'string' ? hostManifest : null,
      shellId: shell.id,
      rev: row.rev,
    };
  } finally {
    await ctx.fiber.dispose();
  }
}

/**
 * assemble 模式的核心：把插件装进一棵真 cordis 树，然后逐条断言。
 *
 * @param profileDirPath - 装了 node_modules 的 profile 目录。
 * @param pluginDir - 插件在 node_modules 里的落点。
 * @returns 断言摘要，供调用方打印。
 */
async function assembleProbe(profileDirPath, pluginDir, beforeInstall) {
  const { createRequire } = await import('node:module');
  const { pathToFileURL } = await import('node:url');
  const { mkdirSync, readFileSync, writeFileSync } = await import('node:fs');
  // 每一棵树用独立 home：宿主会把 cordis.yml 和 "已装载过" 的缓存落在这里，
  // 复用同一个 home 会让第二棵树读到第一棵的状态（技能表为空、section 缺失）。
  const newHome = async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pt-assemble-home-'));
    mkdirSync(dir, { recursive: true });
    return dir;
  };
  let home = await newHome();
  const req = createRequire(join(profileDirPath, 'probe.cjs'));
  const importFrom = async (specifier) => import(pathToFileURL(req.resolve(specifier)).href);
  const cordis = await importFrom('@deepseek-ai/cordis');
  const Loader = (await importFrom('@deepseek-ai/cordis-plugin-loader')).default;
  const Include = (await importFrom('@deepseek-ai/cordis-plugin-include')).default;
  const Group = (await importFrom('@deepseek-ai/cordis-plugin-group')).default;

  // 提示词段的注册名在插件源码里叫 SECTION_NAME（src/prompt/index.ts），
  // 与包名/PLUGIN_ID 都不是同一个字符串，探针必须用同一个常量。
  const SECTION_NAME = 'ponytail-58fly';
  const bundledSkillDir = join(pluginDir, 'skills');
  /** 按 profile 的真实形态搭一棵最小的宿主树：技能面 + 提示词面 + 命令面 + 插件。 */
  const entriesFor = (skillDirOverride, treeHome) => [
    { id: 'system-prompt', name: '@deepseek-ai/dsh-system-prompt', config: { personaPrefix: '' } },
    { id: 'skill', name: '@deepseek-ai/dsh-skill' },
    {
      id: 'skill-filesystem',
      name: '@deepseek-ai/dsh-skill-filesystem',
      config: { dshHome: treeHome, agentsHome: join(treeHome, 'agents'), bundledSkillDir },
    },
    { id: 'commands', name: '@deepseek-ai/dsh-commands' },
    {
      id: pluginName,
      name: pluginName,
      ...(skillDirOverride === undefined ? {} : { config: { skillDir: skillDirOverride } }),
    },
  ];

  /** 起一棵树、读回技能列表与提示词 section，然后拆掉。 */
  async function bootOnce(skillDirOverride) {
    const bootHome = await newHome();
    home = bootHome;
    const entryList = entriesFor(skillDirOverride, bootHome);
    const cfgPath = join(bootHome, 'cordis.yml');
    writeFileSync(cfgPath, JSON.stringify(entryList, null, 2));
    const ctx = new cordis.Context();
    ctx.baseUrl = pathToFileURL(bootHome + '/').href;
    ctx.provide('dshHomePath', { home: bootHome });
    await ctx.plugin(Loader);
    ctx.loader.builtins.include = Include;
    ctx.loader.builtins.group = Group;
    await ctx.loader.create({ id: 'include', name: 'cordis:include', config: { path: pathToFileURL(cfgPath).href } });
    await ctx.get('loader').await();
    // 等技能的首次指纹扫描：宿主 skill-filesystem 是异步索引，抢跑会拿到空表。
    // 这一拍只影响探针时长，不影响插件行为。
    await new Promise((r) => setTimeout(r, 1500));
    const skills = await ctx.get('skills').list({});
    const assembly = await ctx.get('systemPrompt').assemble({});
    // section 的 text 是 (context) => string 的函数，不是字符串：直接取 .text 拿到的是
    // 函数本身（String() 成源码），必须按宿主的方式调用一次才算渲染。
    const sectionList = (assembly.sections ?? []).map((item) => ({
      name: item.name,
      text: typeof item.text === 'function' ? String(item.text({}) ?? '') : String(item.text ?? ''),
    }));
    const section = sectionList.find((item) => item.name === SECTION_NAME);
    if (process.env.PT_DEBUG_ASSEMBLE === '1') {
      console.log('[probe] entries:', JSON.stringify(entryList.map((e) => e.id)));
      console.log('[probe] sections:', JSON.stringify(sectionList.map((s) => [s.name, s.text.length])));
      console.log('[probe] skills:', JSON.stringify(skills.map((s) => s.name)));
      console.log('[probe] sectionText len:', String(section?.text ?? '').length);
    }
    await ctx.fiber.dispose();
    return {
      skillNames: skills.map((skill) => skill.name).sort(),
      sectionText: section?.text ?? '',
      home: bootHome,
    };
  }

  const expectedSkills = (await readdir(bundledSkillDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();
  if (expectedSkills.length === 0) throw new Error('包内 skills/ 是空的：技能面装完不会有任何技能');

  // 1) 完全不带 skillDir：必须**只降级不崩**。技能面是空的（六个技能由本插件的
  //    provider 按 skillDir 提供，不是宿主 bundledSkillDir 给的），但装配要成功、
  //    段正文要走兜底而不能抛错。
  const bare = await bootOnce(undefined);
  const bareSectionDegraded = bare.sectionText.includes('阶梯正文不可用');
  console.log(
    '缺省 skillDir：技能 ' + bare.skillNames.length + ' 个；阶梯正文' +
      (bareSectionDegraded ? '降级 "阶梯正文不可用"（预期，未配 skillDir 时的兜底）' : '照常可用'),
  );
  if (!bareSectionDegraded) throw new Error('缺省 skillDir 时应当降级，实际正文照常——兜底路径没被走到');

  // 2) ${package}/skills：这是 cordis.patch.yml 声明的值，也是"装完即用"的判据。
  //    必须真的从**装好的那份 patch**里取值来跑，而不是脚本自己拼绝对路径——
  //    否则 patch 写错、标记没被解析，这一格照样绿。
  const installedPatch = await readFile(join(pluginDir, 'cordis.patch.yml'), 'utf8');
  const declaredSkillDir = /skillDir:\s*"?([^"\n]+)"?/.exec(installedPatch)?.[1]?.trim();
  if (!declaredSkillDir) throw new Error('装好的 cordis.patch.yml 没有声明 skillDir：装完技能面必然是空的');
  if (!declaredSkillDir.includes('${package}')) {
    throw new Error('patch 里的 skillDir 没走 ${package} 标记（裸相对路径会落到 $DSH_HOME 下）：' + declaredSkillDir);
  }
  const full = await bootOnce(declaredSkillDir);
  if (full.skillNames.join(',') !== expectedSkills.join(',')) {
    throw new Error('技能面不对：期望 ' + expectedSkills.join(',') + '，实际 ' + full.skillNames.join(','));
  }
  if (!(full.sectionText.length > bare.sectionText.length)) {
    throw new Error(
      '显式 skillDir 后阶梯正文没有变长：bare=' + bare.sectionText.length + ' full=' + full.sectionText.length +
        '；且缺省档' + (bareSectionDegraded ? '已降级' : '居然没降级'),
    );
  }

  // 3) 切档：换环境变量重启，section 内容必须随之变化（证明档位真的生效）。
  const byMode = {};
  for (const mode of ['off', 'lite', 'full', 'ultra']) {
    process.env.PONYTAIL_DEFAULT_MODE = mode;
    const run = await bootOnce(bundledSkillDir);
    byMode[mode] = run.sectionText.length;
  }
  delete process.env.PONYTAIL_DEFAULT_MODE;
  if (!(byMode.off < byMode.full && byMode.full !== byMode.ultra)) {
    throw new Error('切档没有改变提示词体量：' + JSON.stringify(byMode));
  }

  // 4) 零垃圾：装完 + 跑完，$DSH_HOME 里只该有探针自己写的 cordis.yml。
  const strays = await snapshotHome(home);
  const unexpectedStrays = strays.filter((rel) => rel !== '/cordis.yml');
  if (unexpectedStrays.length > 0) {
    throw new Error('插件在 $DSH_HOME 里留下了路径：' + unexpectedStrays.join('，'));
  }

  // 5) 与装前快照做差集：装了、跑了、切了四档，$DSH_HOME 里不许长出任何新路径。
  // 注意：/cordis.yml 是装配探针自己写的宿主配置文件（测试脚手架），不是插件写的。
  // 差集里要给它开个口子，否则这条断言永远红。
  const newPaths =
    beforeInstall === undefined
      ? []
      : strays.filter((rel) => rel !== '/cordis.yml' && !beforeInstall.has(rel));
  if (newPaths.length > 0) {
    throw new Error('安装/运行后在 $DSH_HOME 里新增了路径：' + newPaths.join('，'));
  }

  // 6) 宿主自己认不认我们：问客户端模块登记服务，而不是自查声明文本。
  //    这一格跑在装配之后：装配证明"宿主侧能力齐了"，这一格证明"客户端半边也能被看见"。
  const discovered = await discoverClient(profileDirPath, pluginDir, 'main');

  return {
    skills: full.skillNames,
    sectionLengths: byMode,
    homeStrays: strays,
    homeNewPaths: newPaths,
    bareSectionDegraded,
    bareSkills: bare.skillNames,
    discovered,
  };
}

/**
 * 卸载后必须什么都不剩：profile 的 node_modules 里不再有插件，$DSH_HOME 里也不新增路径。
 *
 * 卸载用 pnpm remove 而不是 rm -rf：硬链/软链布局下 rm 会顺藤摸瓜删到仓库（前面踩过一次）。
 * 这里只断言"插件与它带来的解析结果都消失"，不做"文件系统逐字节回滚"这种过强承诺。
 */
async function uninstallProbe(profileDirPath, homePath) {
  const remove = await run(PNPM, ['remove', pluginName, '--reporter=append-only'], {
    cwd: profileDirPath,
    maxBuffer: 32 * 1024 * 1024,
  });
  console.log(remove.stdout.trim().split('\n').slice(-2).join('\n'));

  if (existsSync(join(profileDirPath, 'node_modules', pluginName))) {
    throw new Error('卸载后 node_modules 里仍留着插件目录');
  }
  // 解析器也不能再看见它：这才是"别处还引用着"的证据。
  const probe = [
    'const { createRequire } = await import(\'node:module\');',
    'const req = createRequire(' + JSON.stringify(join(profileDirPath, 'package.json')) + ');',
    'let seen = true;',
    'try { req.resolve(' + JSON.stringify(pluginName) + '); } catch { seen = false; }',
    "if (seen) throw new Error('卸载后仍然能解析到插件');",
  ].join('\n');
  await run(process.execPath, ['--input-type=module', '-e', probe], {
    cwd: profileDirPath,
    maxBuffer: 8 * 1024 * 1024,
  });

  const strays = await snapshotHome(homePath);
  const unexpectedStrays = strays.filter((rel) => rel !== '/cordis.yml');
  if (unexpectedStrays.length > 0) {
    throw new Error('卸载后 $DSH_HOME 里仍有插件留下的路径：' + unexpectedStrays.join('，'));
  }

  return { homeStrays: strays, fullyGone: true };
}

try {
  const specifier = args.tarball === null ? 'link:' + root : await dependencySpecifier();

  await mkdir(profileHome, { recursive: true });
  process.env.DSH_HOME = profileHome;
  await writeFile(join(profileDir, 'pnpm-workspace.yaml'), PROFILE_WORKSPACE, 'utf8');
  const dependencies = Object.assign({}, HOST_PROVIDED);
  if (args.mode === 'assemble') Object.assign(dependencies, ASSEMBLE_EXTRA);
  // selftest 只验"装配断言是活的"，不验安装形态；没有 tarball 时退回 link 形态，
  // 免得 CI 为了跑一条反向用例还要先打包。
  dependencies[pluginName] = specifier;
  const manifest = { name: 'pt-install-probe', private: true, type: 'module', dependencies };
  await writeFile(join(profileDir, 'package.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  // ── 2. 装 ────────────────────────────────────────────────────────────
  // 装前先拍一张 $DSH_HOME 快照：零垃圾的判据是"前后差集为空"，不是"白名单里只有某几个名"。
  // 白名单只能证明"我认识这些路径"，差集才能证明"没新增"。
  const beforeInstall = new Set(await snapshotHome(profileHome));
  const install = await run(PNPM, ['install', '--reporter=append-only'], {
    cwd: profileDir,
    maxBuffer: 32 * 1024 * 1024,
  });
  console.log(install.stdout.trim().split('\n').slice(-3).join('\n'));

  // ── 3. 装了之后就一定得在，不在就是 files 白名单漏了 ────────────────
  let installedDir = join(profileDir, 'node_modules', pluginName);
  const mustExist = [
    'package.json',
    'lib/plugin.js',
    'lib/client.js',
    'cordis.patch.yml',
    'README.md',
    'LICENSE',
  ];
  for (const rel of mustExist) {
    if (!existsSync(join(installedDir, rel))) {
      throw new Error('包内缺少 ' + rel + '：files 白名单或构建产物有问题');
    }
  }

  // 客户端产物必须是 ModuleLoader 外壳，而不是被 esbuild 打成的裸 CJS。
  const clientCode = await readFile(join(installedDir, 'lib/client.js'), 'utf8');
  if (!clientCode.includes('__ModuleLoader__.load(')) {
    throw new Error('lib/client.js 不是 __ModuleLoader__.load 外壳，浏览器端会装不进去');
  }

  // ── 4. 真的 import 一次：这一步才是"零运行时依赖"的证明 ─────────────
  const probe = [
    'const mod = await import(' + JSON.stringify(pluginName) + ');',
    "const missing = ['apply', 'inject', 'Config'].filter((key) => !(key in mod));",
    "if (missing.length > 0) throw new Error('产物缺少导出：' + missing.join(', '));",
    "if (typeof mod.apply !== 'function') throw new Error('apply 不是函数');",
    "if (!Array.isArray(mod.inject)) throw new Error('inject 不是数组');",
    'const schema = mod.Config;',
    // schemastery 的 schema 是 function（带 type/meta/dict 属性的构造器），不是普通对象，
    // 所以这里只判"可调用或可索引"且带 ~standard —— 判 typeof === 'object' 会把好 schema 判死。
    "if (schema === null || (typeof schema !== 'object' && typeof schema !== 'function') || !('~standard' in schema)) {",
    "  throw new Error('Config 不是 schemastery schema（缺 ~standard）');",
    '}',
    '// 非法配置必须被 schemastery 拒掉：证明 Config 真的被 cordis 用得上。',
    "const invalid = await schema['~standard'].validate({ defaultMode: 'nope' });",
    "if (!invalid.issues) throw new Error('Config 没有拒绝非法档位，schema 可能没接上');",
    "console.log('import ok: name=' + mod.name + ' inject=' + JSON.stringify(mod.inject));",
  ].join('\n');
  const imported = await run(process.execPath, ['--input-type=module', '-e', probe], {
    cwd: profileDir,
    maxBuffer: 8 * 1024 * 1024,
  });
  console.log(imported.stdout.trim());

  // ── 5. 把 node_modules 里的 @deepseek-ai 打出来，让"宿主给了什么"一直可见 ──
  // 不用 pnpm ls --json：link: 形态下它的 dependencies 段会缺失，
  // 读目录反而更直接地描述"解析器能看到哪些包"这件事。
  const scopeDir = join(profileDir, 'node_modules', '@deepseek-ai');
  const visible = existsSync(scopeDir) ? await readdir(scopeDir) : [];
  console.log('node_modules/@deepseek-ai 可见：' + (visible.join(', ') || '（空）'));
  const PROBE_ONLY = new Set(Object.keys(ASSEMBLE_EXTRA).map((name) => name));
  const unexpected = visible.filter((name) => {
    const full = '@deepseek-ai/' + name;
    // assemble 模式会额外装宿主 peer 与 cordis 装载器，它们由探针引入，不是"宿主新给的包"。
    if (PROBE_ONLY.has(full)) return false;
    if (args.mode === 'assemble' && full.startsWith('@deepseek-ai/dsh-') && !HOST_INCIDENTAL.has(full)) return false;
    return full !== pluginName && !(full in HOST_PROVIDED) && !HOST_INCIDENTAL.has(full);
  });
  if (unexpected.length > 0) {
    console.log('注意：多出 ' + unexpected.join(', ') + '（若是宿主新给的包，请更新 HOST_PROVIDED）');
  }

  // ── 6. assemble：真装配（#11）────────────────────────────────────────
  if (args.mode === 'assemble') {
    const summary = await assembleProbe(profileDir, installedDir, beforeInstall);
    console.log('技能面：' + summary.skills.join(', '));
    // 注意：体量**不单调**是正常的。阶梯正文按档位裁掉另外三行，剩下的那句
    // 长短不一（lite 那行要引用"上面这些规则"，反而是四行里最长的）。
    // 这里断言的是"档位真的改变了渲染结果"，不是"档位越高正文越长"。
    console.log('四档提示词体量：' + JSON.stringify(summary.sectionLengths));
    console.log('$DSH_HOME 内路径：' + summary.homeStrays.join(', '));
    // 宿主判定五项：这是我们问宿主得到的答案，不是我们自查声明的结果。
    const d = summary.discovered;
    console.log('宿主判定：模块图按包名找到本包 = ' + d.graphHasRow + '（rev=' + d.rev + '）');
    console.log('宿主判定：客户端产物路径 = ' + d.clientPath);
    console.log('宿主判定：按包名取到客户端产物 = ' + d.resolveMetaReturned);
    console.log('宿主判定：平台 = 网页（' + d.platformGate + '）');
    console.log('宿主判定：外部依赖 = ' + JSON.stringify(d.external) + '（声明 ' + JSON.stringify(d.inject) + ' inject）');
    console.log('宿主判定：产物外壳 id = ' + JSON.stringify(d.shellId));
    if (args.selftest) {
      // selftest 证明的是"断言是活的"：故意把技能目录指向空目录，装配必须报红。
      let caught = null;
      try {
        const emptyDir = join(profileDir, 'empty-skills');
        const { mkdirSync } = await import('node:fs');
        mkdirSync(emptyDir, { recursive: true });
        // link 形态下 installedDir 是指向仓库的软链，直接 rm 会删掉仓库里的 skills/。
        // 先把 link 换成真副本再动它。
        // 关键：不能直接 rm installedDir/skills。link 形态下那是仓库里的真目录
        // （软链指回 /Volumes/data/dsh-ponytail），assemble 形态下 pnpm 的 hoisted
        // 布局也可能把它硬链到同一份 inode —— 两种情况下 selftest 都会把仓库的
        // skills/ 清空。所以只在"探针自己造的副本"上做手脚。
        const safePluginDir = join(profileDir, 'plugin-copy');
        await cp(installedDir, safePluginDir, { recursive: true, dereference: true });
        const saved = join(safePluginDir, 'skills');
        installedDir = safePluginDir;
        await cp(saved, join(profileDir, 'skills.bak'), { recursive: true });
        await rm(saved, { recursive: true, force: true });
        await cp(emptyDir, saved, { recursive: true });
        await assembleProbe(profileDir, installedDir, beforeInstall);
      } catch (error) {
        caught = error;
      }
      if (caught === null) {
        throw new Error('selftest 失败：把 skills/ 清空后装配仍然通过 —— 技能面断言是装饰');
      }
      console.log('selftest ✓ 空技能目录被装配探针拦住：' + caught.message);

      // 反向自检：客户端发现断言必须是活的。三破一复 —— 每种破坏都要红，
      // 而且红的文案要对得上成因；恢复后必须绿。少了这一段，"宿主判定五项"就只是
      // 一堆打印，谁也不知道它会不会在真出问题时照样通过。
      //
      // 破坏对象是 node_modules 里那份。必须先换成真副本再动，两个原因：
      // link 形态下它是指向仓库的软链，直接改会改到仓库的 package.json；
      // tarball/assemble 形态下 pnpm 把文件硬链接到全局 store，直接改会改到 store 里
      // 那份，连别的 profile 一起污染。无条件副本化比"判断是不是软链"覆盖得更全。
      const nmPlugin = join(profileDir, 'node_modules', pluginName);
      const realCopy = join(profileDir, 'plugin-client-copy');
      await cp(nmPlugin, realCopy, { recursive: true, dereference: true });
      await rm(nmPlugin, { recursive: true, force: true });
      await cp(realCopy, nmPlugin, { recursive: true, dereference: true });
      const manifestPath = join(nmPlugin, 'package.json');
      const originalManifestText = await readFile(manifestPath, 'utf8');
      const brokenCases = [
        {
          label: '删掉 dsh.client 声明',
          expect: '声明缺失',
          mutate: (m) => {
            delete m.dsh.client;
            return m;
          },
        },
        {
          label: '把平台改成 node',
          expect: '平台不是网页',
          mutate: (m) => {
            m.dsh.client.platform = 'node';
            return m;
          },
        },
        {
          label: '删掉导出映射里的客户端入口',
          expect: '导出映射缺客户端入口',
          mutate: (m) => {
            delete m.exports['./client'];
            return m;
          },
        },
      ];
      let brokeCount = 0;
      try {
        for (const [index, brokenCase] of brokenCases.entries()) {
          const mutated = brokenCase.mutate(JSON.parse(originalManifestText));
          await writeFile(manifestPath, JSON.stringify(mutated, null, 2) + '\n', 'utf8');
          let failure = null;
          try {
            await discoverClient(profileDir, nmPlugin, 'selftest-' + index);
          } catch (error) {
            failure = error;
          }
          if (failure === null) {
            throw new Error('selftest 失败：' + brokenCase.label + ' 之后宿主仍然认我们 —— 发现断言是装饰');
          }
          if (!failure.message.includes(brokenCase.expect)) {
            throw new Error(
              'selftest 失败：' + brokenCase.label + ' 的失败文案没落到「' + brokenCase.expect +
                '」，实际是：' + failure.message,
            );
          }
          brokeCount += 1;
          console.log('selftest ✓ ' + brokenCase.label + ' 被打红：' + failure.message);
        }
      } finally {
        await writeFile(manifestPath, originalManifestText, 'utf8');
      }
      // 一复：manifest 恢复原样之后必须重新变绿，否则前面三条"红"可能只是探针坏了。
      const recovered = await discoverClient(profileDir, nmPlugin, 'selftest-recover', { checkProvenance: false });
      if (recovered.discovered !== true) {
        throw new Error('selftest 失败：manifest 恢复后宿主仍不认我们 —— 探针本身坏了');
      }
      console.log('selftest ✓ 三破一复通过（' + brokeCount + ' 种破坏全红，恢复后重新变绿）');
    }

    // 缺省 skillDir 那条分支必须是"降级"而不是"照常"：
    // 否则兜底路径一旦被改动成"自动回落包内技能"，这条断言就白写了。
  }

  // ── 7. 卸载：装完再卸，必须什么都不剩（#11 零垃圾承诺）───────────────
  // 只在真装一次之后跑；selftest 里 installedDir 已被换成副本，卸载验的是"包还在不在"，
  // 与副本无关，照样成立。
  const uninstalled = await uninstallProbe(profileDir, profileHome);
  console.log('卸载后 $DSH_HOME 内路径：' + (uninstalled.homeStrays.join(', ') || '（空）'));

  console.log('\n安装形态验证通过（mode=' + args.mode + '）');
} finally {
  if (process.env.KEEP_PROBE_DIR !== '1') {
    await rm(profileDir, { recursive: true, force: true }).catch(() => {});
  } else {
    console.log('保留探针目录：' + profileDir);
  }
}
