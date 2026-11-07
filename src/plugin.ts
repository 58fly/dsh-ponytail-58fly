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
import type { PromptPorts } from './prompt/port.js';
import { installPrompt } from './prompt/index.js';
import { installModeReminder } from './prompt/prestep.js';
import { LadderSource } from './prompt/source.js';
import { installSkills } from './skills/provider.js';
import { installSessionStore } from './state/sessions.js';

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
  installModeReminder(ctx, { ports, source });
  installPonytailCommand(ctx, runtime);

  // 6) 技能 provider。
  installSkills(ctx, { skillDir });

  // 7) settings 通道：可选接线。缺服务时子 fiber 根本不启动，主插件照常跑。
  attachSettingsChannel(ctx, runtime);
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
 * @param ctx - 插件上下文。
 * @param runtime - 配置运行时。
 * @returns 无。
 */
function attachSettingsChannel(ctx: Context, runtime: ConfigRuntime): void {
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
}
