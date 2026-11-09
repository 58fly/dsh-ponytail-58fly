/**
 * 插件唯一入口：只做装配，不实现任何一层语义。
 *
 * 装配顺序是本文件唯一的知识：
 * 1. L0（`l0/`）是纯函数，不装配；
 * 2. 配置运行时先建——后面的渲染与技能都要读它算出的档位；
 * 3. 提示段与技能 provider 次之；
 * 4. 会话状态容器最后建——它的监听器只关心 `agent/disposed`；
 * 5. settings 通道最后接线，且走 `ctx.inject` 而不是写进 `inject`。
 *
 * 四层之间的依赖是单向的：`plugin.ts → {prompt, state, config, skills} → l0`。
 * 反向 import 会在 verify 脚本里被判失败（见 scripts/verify.mjs 的分层检查）。
 */
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-settings';

import type {} from './config/events.js';
import { ConfigRuntime, describeError, type EnvLike } from './config/runtime.js';
import { Config, type PonytailConfig } from './config/schema.js';
import { readVolatileField } from './config/volatile.js';
import type { RuntimeMode } from './l0/mode.js';
import { fileURLToPath } from 'node:url';

import { PLUGIN_ID, resolveDshHome, resolveSkillDirValue } from './l0/paths.js';
import { installPonytailCommand } from './commands/ponytail.js';
import { installGainCommand } from './commands/gain.js';
import type { PromptPorts } from './prompt/port.js';
import type { StatsView } from './stats/types.js';
import { BASELINE_CAVEAT } from './stats/baseline.js';
import { installPrompt } from './prompt/index.js';
import { installModeReminder } from './prompt/prestep.js';
import { LadderSource } from './prompt/source.js';
import { installSkills } from './skills/provider.js';
import { installSessionStore } from './state/sessions.js';
import { installStats, type StatsHandle } from './stats/index.js';

export { Config };
export { PRIORITY_ENV_NAME } from './config/priority.js';
export type { PonytailSnapshot, WriteOutcome } from './config/runtime.js';
export type { PriorityReport, PrioritySource } from './config/priority.js';

/** Cordis 用来给 fiber 与 logger 命名的插件名。 */
export const name = PLUGIN_ID;

/**
 * 本插件实例的配置运行时登记表。
 *
 * 键是 `apply` 收到的 ctx：Cordis 每次 `ctx.plugin()` 都给一个独立 ctx，同一个
 * 插件被装两次会得到两个互不干扰的运行时，这正是我们要的语义。
 *
 * 用 WeakMap 而不是往 ctx 上挂属性：ctx 是宿主的公共对象，往上面加私有字段既
 * 可能撞名，也会让「谁知道这个字段的约定」变成隐式知识。WeakMap 的键存活期与
 * ctx 一致，fiber 卸载后自动可回收，不需要手动清理。
 *
 * 消费方：#07 的命令 handler 与 #05 的快照出口都要拿到同一份状态——它们与
 * `apply` 同处一个插件 fiber，用 `runtimeOf(ctx)` 取即可。
 */
const runtimes = new WeakMap<Context, ConfigRuntime>();

/**
 * 取本插件在某个上下文里的配置运行时。
 *
 * 找不到有两种正常情形：ctx 不是本插件的上下文（比如宿主根 ctx），或插件尚未
 * 开始 apply。调用方必须处理 undefined，不要断言。
 * @param ctx - 任意上下文。
 * @returns 运行时实例或 undefined。
 */
export function runtimeOf(ctx: Context): ConfigRuntime | undefined {
  return runtimes.get(ctx);
}

/**
 * 硬依赖。
 *
 * `systemPrompt` 与 `skills` 缺任何一个，本插件的两个对外产出就都不成立，所以放硬依赖
 * 让插件「不加载」而不是「加载了但什么都不做」——后者会让用户在设置面板里看到一个没有
 * 任何效果的开关。
 *
 * `commands`（#07）与 `settings`（#04）是可选依赖，走运行时 `ctx.inject([...], cb)`，
 * 不写在这里。两者缺席时插件必须完整工作（至少是能工作的那部分）。
 */
export const inject = ['systemPrompt', 'skills'];

/**
 * 插件主体。
 *
 * 关于 `config` 的类型缝隙（必须知道，否则改代码时会被坑）：
 * schemastery 的 `z.object` 在**类型层**产出必填字段（`ObjectT`），但运行时
 * `validate(undefined)` 返回的是空对象。也就是说类型说 `config.defaultMode` 一定存在，
 * 实际可能是 `undefined`。
 *
 * 我们的对策不是加断言，而是让所有读取路径都经过 `coerceMode(unknown)` /
 * `readVolatileField(unknown)`——它们的入参都是 `unknown`，undefined 会诚实地变成 null，
 * 再由优先级链兜底。
 *
 * 另一层缝隙：加了 `.volatile()` 之后，字段的**静态类型**变成 `Volatile<T | undefined>`
 * 而不再是 `T`。这不是麻烦而是提醒——它确实是引用，必须每次读都解包。
 * @param ctx - 宿主上下文。
 * @param config - 已校验的配置（字段可能缺，且是活引用）。
 */
export function apply(ctx: Context, config: PonytailConfig): void {
  // 1) 配置运行时最早建：档位是后面每一步的输入。
  const runtime = new ConfigRuntime({ ctx, config, env: process.env as EnvLike });
  runtimes.set(ctx, runtime);
  ctx.effect(
    () => () => {
      runtime.dispose();
      runtimes.delete(ctx);
    },
    'ponytail-58fly: 配置运行时',
  );

  // 2) 阶梯正文来源。skillDir 是 volatile 字段，读一次解包一次。
  //    包根从本模块自己的位置推：lib/plugin.js 的上一级就是包装好的那层目录，
  //    无论被 link 还是被解到 node_modules 都成立。${package}/skills 这个值
  //    由此解析成"这份安装自己的 skills/"。
  const dshHome = resolveDshHome();
  const skillDir = resolveSkillDirValue(
    readVolatileField<string>(config?.skillDir),
    dshHome,
    fileURLToPath(new URL('..', import.meta.url)),
  );
  const source = new LadderSource(skillDir);
  // 同步预备一次：第一次 assemble 可能早于第一次 pre-step，段正文不能是空的。
  source.primeSync();
  ctx.effect(
    () => () => {
      source.dispose();
    },
    'ponytail-58fly: 阶梯正文缓存',
  );

  // 3) 会话状态。必须在提示段之前建好：段正文要读 baseline。
  const sessions = installSessionStore(ctx);

  // 3a) 效率统计。纯内存计数器，不落盘（见票 02 的 Q12′）：
  //     它的埋点是 pre-step 与命令层的两个回调，失败也绝不影响那两条路径。
  const stats = installStats(ctx);

  // 3b) 端口适配：prompt 层只认这两个形状（prompt/port.ts），不认识 config / state。
  //     为什么这个方法在这里造：只有装配入口同时看得见两层，而分层矩阵要求
  //     prompt 与 config / state 互不可见（scripts/verify.mjs 第 3 组）。
  //     mode 必须是 getter：写成字段会冻结成构造时的快照，之后切档不生效。
  const ports: PromptPorts = {
    get mode(): RuntimeMode {
      return runtime.mode;
    },
    ensure: (sessionId, fallback) => sessions.ensure(sessionId, fallback),
  };

  // 4) 提示段（前缀，只认 baseline）。
  installPrompt(ctx, { ports, source });

  // 5) 尾部 reminder（切档的唯一可见通道）+ 命令层。
  installModeReminder(ctx, { ports, source, stats: stats.sink });
  installPonytailCommand(ctx, runtime, stats);
  installGainCommand(ctx, stats);

  // 6) 技能 provider。
  installSkills(ctx, { skillDir });

  // 7) settings 通道：可选接线。缺服务时子 fiber 根本不启动，主插件照常跑。
  attachSettingsChannel(ctx, runtime, stats);
}

/**
 * 把 settings 服务接到配置运行时上。
 *
 * 三件事必须一起做，否则会出现「读得到但写不进去」的半接线状态：
 * 1. 把服务句柄交给运行时（此后 `setMode` 才可用）；
 * 2. 监听宿主的两条变更事件，重新 describe——宿主改配置不会回调我们，只能听广播；
 * 3. 监听 `loader/volatile-update`：volatile 字段是宿主原地更新的，这条事件是唯一
 *    的变更信号，且它的参数只是受影响的键路径，不含值。
 *
 * **不用 try/catch 探测服务是否存在**：`ctx.inject` 起的是子插件 fiber，依赖缺席时
 * 它不启动，回调根本不会执行。这正是票面要求的降级方式，比三重断言干净。
 * 统计面板的读通道也挂在这条可选 fiber 上：宿主没有 webServer / connection 时
 * 面板本来就打不开，此时开一条没人调的 RPC 只是噪音。
 * @param ctx - 插件上下文。
 * @param runtime - 配置运行时。
 * @param stats - 效率统计句柄。
 * @returns 无。
 */
function attachSettingsChannel(ctx: Context, runtime: ConfigRuntime, stats: StatsHandle): void {
  const fiber = ctx.inject(['settings'], (scope) => {
    runtime.attachSettings(scope.settings, scope.fiber);
    scope.effect(
      () => {
        const offUpdated = scope.on('settings/updated', () => { void runtime.refresh(); });
        const offVolatile = scope.on('loader/volatile-update', () => { void runtime.refresh(); });
        return () => {
          offUpdated();
          offVolatile();
        };
      },
      'ponytail-58fly: 配置变更监听',
    );
  });
  // 回调抛错时 Fiber 会 reject；不接住会变成未处理的 rejection 直接崩进程。
  void Promise.resolve(fiber).catch((error: unknown) => {
    ctx.logger('ponytail-58fly').warn('settings 通道接线失败：' + describeError(error));
  });
  // 8) 效率统计通道：同样可选接线。服务在就直接挂上，缺服务就子 fiber 不启动，
  //    面板显示「统计暂时读不到」——不影响档位、提示段与命令。
  attachStatsChannel(ctx, stats);
}

/**
 * 给客户端面板开一条只读 RPC：`connection.rpc.call('/ponytail-stats', 'snapshot', …)`。
 *
 * 为什么不是配置文档：面板读的是 `configForms` 的 form 快照，而统计写进
 * schema 会被 volatile 字段的 strip() 在任何一次配置写入时抹掉（票 04 实测）。
 * 为什么不做推送：宿主的事件转发白名单是硬编码的、每进程只允许一个源，
 * 第三方插件没有合法的实时通道。于是面板挂载时拉一次、用户点「刷新」再拉一次。
 *
 * 为什么自己不注册 `connection.rpc.handle`：宿主同一张路由表里
 * `/api`（typert gateway）与静态 SPA fallback 已经占位，自定义通道注册后
 * 请求会被 fallback 的静态处理器接走（POST 得 405，GET 得 404 —— 桌面宿主实测）。
 * 改成在 `/api` 上挂一个 Fetch 精确路由：它先于 gateway 的 endpoint 分派被查，
 * 只认 `POST` + 精确路径，别的路径原样交还给 gateway。
 *
 * 路径写死在服务端与客户端各一份——它们是同一个契约的两半，
 * 放进常量文件反而会让人以为可以改。
 * @param ctx - 插件上下文。
 * @param stats - 效率统计句柄。
 */
function attachStatsChannel(ctx: Context, stats: StatsHandle): void {
  // 类型从本仓自己声明的最小契约来（不 import 宿主包：那些包只在宿主 profile 里能解析到）。
  const fiber = ctx.inject(['webServer', 'connection'], (scope) => {
    const fetchRoutes = readFetchRoutes(scope);
    const route: StatsFetchRoute = {
      path: STATS_PATH,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request: Request): Promise<Response> => {
        let payload: unknown;
        try {
          payload = await request.json();
        } catch {
          return new Response('body is not JSON', { status: 400 });
        }
        if (isResetRequest(payload)) stats.reset();
        const reply: StatsReply = { snapshot: stats.snapshot(), assumption: BASELINE_CAVEAT };
        return Response.json(reply);
      },
    };
    scope.effect(() => {
      const off = fetchRoutes.register(route);
      return () => {
        off();
      };
    }, 'ponytail-58fly: 效率统计路由');
  });
  void Promise.resolve(fiber).catch((error: unknown) => {
    ctx.logger('ponytail-58fly').warn('效率统计通道接线失败（面板将显示读不到）：' + describeError(error));
  });
}

/**
 * 请求体是否要求清零。
 *
 * 客户端只能传字符串，所以这里只认字面量 `reset`——比给清零单开一条路径省事，
 * 也让「读」与「清」共用一个端点。
 * @param payload - 请求体。
 * @returns 是否清零。
 */
function isResetRequest(payload: unknown): boolean {
  return payload === 'reset';
}

/**
 * 从注入作用域里取 `connection.fetch` 注册表。
 *
 * 直写 `scope.connection` 依赖宿主包的模块增强（`declare module`），而那个包只在宿主
 * profile 里解析得到；本仓又没有可用的 `as` 断言（verify 第 6 组禁 `as unknown as`）。
 * 于是用一次运行时校验把 unknown 收窄成最小契约——它同时也是一道防线：
 * 宿主换了形状时这里立刻降级，而不是在面板里抛一个没人看得懂的错。
 * @param scope - `ctx.inject` 回调收到的作用域。
 * @returns 最小契约；形状不对时抛出（由外层 catch 记 warn 并跳过接线）。
 */
function readFetchRoutes(scope: unknown): StatsHostScope['connection']['fetch'] {
  const candidate = (scope as { connection?: Partial<StatsHostScope['connection']> }).connection;
  if (candidate === undefined || typeof candidate.fetch?.register !== 'function') {
    throw new Error('宿主 connection 服务缺少 fetch.register');
  }
  const register = candidate.fetch.register.bind(candidate.fetch);
  return { register: (route) => register(route) };
}

/** 统计端点的完整路径。客户端 `src/client/index.ts` 里有同名常量，改一处必须改两处。 */
const STATS_PATH = '/api/ponytail-stats/snapshot';

/** 通道返回体。 */
interface StatsReply {
  readonly snapshot: StatsView;
  /** 限定语：客户端必须原样展示，不许自己编措辞。 */
  readonly assumption: string;
}

/** 一条 Fetch 精确路由：宿主只按精确 pathname 匹配，命中后整条响应生命周期归本插件。 */
interface StatsFetchRoute {
  readonly path: string;
  readonly methods: readonly string[];
  readonly requestBody: 'buffered' | 'streaming';
  fetch(request: Request): Promise<Response>;
}

/**
 * 宿主 `connection` 服务的最小形状。
 *
 * 只声明用到的那一件（`fetch.register`），不 import `@deepseek-ai/dsh-client-connection`
 * 的类型：那个包只存在于宿主 profile，作为 devDependency 引入会把「本仓能装」绑到
 * 宿主的内部安装布局上。真实契约见票 04 的 Answer 与票 06 的复核记录。
 */
interface StatsHostScope {
  readonly connection: {
    readonly fetch: {
      /** 返回退订函数。 */
      register(route: StatsFetchRoute): () => void;
    };
  };
}
