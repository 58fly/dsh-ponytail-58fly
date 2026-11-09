/**
 * 命令层：`/ponytail [off|lite|full|ultra]`。
 *
 * ## 为什么用官方 commands 而不是自己解析
 *
 * 上游把命令解析写进了 `agent/pre-step`：监听 `session/event` 的 `user/message`，
 * 取出每条用户消息的文本块，逐条比对 `isDeactivationCommand`（
 * src/ponytail-commands.ts）。这条路径有四个可验证的毛病：
 *
 * 1. **谁都能"命令"**：用户粘贴的代码、日志、别人的聊天记录里只要出现一行
 *    `normal mode`，就被当成切档指令；
 * 2. **和斜杠菜单无关**：用户在菜单里看不到 `/ponytail`，因为命令表是宿主管的；
 * 3. **没有生命周期**：宿主的 `command/run` / `command/done` 事件、客户端
 *    `remote.commands.execute` 全都用不上；
 * 4. **解析器要自己维护**：大小写、全角空格、尾部标点，上游一路打补丁
 *    （`text.trim().toLowerCase().replace(/[.!?\s。！？]+$/,'')`）。
 *
 * 0.2.2 自带 `ctx.commands`（`@deepseek-ai/dsh-commands`）：`register` 返回
 * 精确的 effect disposer，重名直接抛错，`dsh-client-ui-commands` 自动把
 * 命令塞进斜杠菜单。我们只提供"参数怎么解释"。
 *
 * ## 只做解释，不做归一化
 *
 * 归一化是 `coerceMode`（L0）的事，写入是 `ConfigRuntime.setMode` 的事。
 * 本文件只负责三件事：把 `rawInput` 交给 setMode、把 `WriteOutcome` 翻成人话、
 * 在没带参数时报告现状。**任何一处再写一份档位白名单都是回归**。
 *
 * ## 降级
 *
 * `commands` 是可选依赖。宿主没装它就 `ctx.inject` 回调不执行，插件其余部分照常
 * 工作——用户仍可通过设置面板的 `defaultMode` 定档（两个入口落到同一个写入口，
 * 见 #07 硬约束）。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { CommandResult } from '@deepseek-ai/dsh-commands';
import type {} from '@deepseek-ai/dsh-commands';

import type { ConfigRuntime } from '../config/runtime.js';
import { describeError } from '../config/runtime.js';
import { coerceMode, RUNTIME_MODES } from '../l0/mode.js';
import type { StatsHandle } from '../stats/index.js';

/** 命令名（不带斜杠）。 */
export const COMMAND_NAME = 'ponytail';

/** 用法提示，输入框里的灰字与报错文案共用一份。 */
const HINT = '[off|lite|full|ultra]';

/** 日志前缀。 */
const LOGGER_SCOPE = 'ponytail-58fly';

/**
 * 把四档拼成一句话，报错与帮助都用它，避免文案漂移。
 * @returns 形如 `off / lite / full / ultra`。
 */
function modeList(): string {
  return RUNTIME_MODES.join(' / ');
}

/**
 * 处理一次调用。
 *
 * 三种输入：空（报现状）、合法档位（写）、其它（报错且**不写**）。
 * 不认识的参数直接报错而不是回落默认档：静默回落会让用户以为切换成功了。
 * @param runtime - 配置运行时。
 * @param rawInput - 命令名之后的原文。
 * @param stats - 效率统计句柄；缺省时只是不计数，命令行为不变。
 * @returns 宿主要的结果对象。
 */
async function run(runtime: ConfigRuntime, rawInput: string, stats?: StatsHandle): Promise<CommandResult> {
  stats?.bumpCommand();
  const argument = rawInput.trim();
  if (argument === '') {
    const snapshot = runtime.getSnapshot();
    return {
      kind: 'success',
      text: 'Ponytail 当前档位：' + snapshot.effective + '\n用法：/ponytail ' + HINT + '\n可选：' + modeList(),
    };
  }

  if (coerceMode(argument) === null) {
    return { kind: 'error', text: '未知档位「' + argument + '」。可选：' + modeList() };
  }

  let outcome;
  try {
    outcome = await runtime.setMode(argument);
  } catch (error) {
    // setMode 约定不抛；真抛了说明是宿主 settings 服务的内部错误，如实报告。
    return { kind: 'error', text: '切换失败：' + describeError(error) };
  }

  if (!outcome.ok) return { kind: 'error', text: '切换失败：' + outcome.reason };
  // 切档次数只记真正写下去的那一次：失败与「值写了但不生效」都不算切档。
  stats?.bumpSwitch();

  const base = 'Ponytail 档位已切换为 ' + outcome.mode + '。';
  return { kind: 'success', text: outcome.note === null ? base : base + '\n注意：' + outcome.note };
}

/**
 * 装上 `/ponytail` 命令。
 *
 * 用 `ctx.inject` 起子 fiber 而不是写进 `inject`：命令是可选能力，
 * 缺 `commands` 服务时不应让整个插件不加载。
 * @param ctx - 插件上下文。
 * @param runtime - 配置运行时。
 * @param stats - 效率统计句柄（可选）。
 * @returns 无；卸载随插件 fiber。
 */
export function installPonytailCommand(ctx: Context, runtime: ConfigRuntime, stats?: StatsHandle): void {
  const fiber = ctx.inject(['commands'], (scope) => {
    scope.commands.register({
      name: COMMAND_NAME,
      description: '查看或切换 Ponytail 档位',
      // 宿主 normalizeDefinition 要求 hint 是非空字符串、attachments 是 boolean。
      input: { hint: HINT, attachments: false },
      handler: (invocation) => run(runtime, invocation.rawInput, stats),
    });
  });
  // 回调抛错时 Fiber 会 reject；不接住会变成未处理的 rejection 直接崩进程。
  void Promise.resolve(fiber).catch((error: unknown) => {
    ctx.logger(LOGGER_SCOPE).warn('命令通道接线失败：' + describeError(error));
  });
}
