/**
 * 尾部 reminder：档位切换的唯一可见通道。
 *
 * ## 为什么不改前缀
 *
 * 前缀是 KV cache 的键。上游把档位写进 system prompt 的 section
 * （src/ponytail-instructions.ts:85 renderPromptSection 每轮按当前档位重渲染），
 * 用户切一次档，整个前缀作废、缓存全部重算。本插件把前缀**锁在会话诞生时的
 * 档位**（baseline），切档只在消息流尾部追加一条 `<system-reminder>`。
 *
 * ## 为什么是 pre-step，而不是 session/event
 *
 * 上游在 `session/event` 上监听 `user/message`、扒用户文本、自己解析
 * `/ponytail lite`（src/ponytail-commands.ts 的 dispatchMessages）。三宗罪：
 * 与官方命令层重复解析、看得见用户原话（包括粘贴进来的代码里恰好写着
 * "/ponytail"）、且"用户发消息"与"模型要跑一步"不是同一件事。
 * `agent/pre-step` 是宿主官方为"本步要注什么"准备的 waterfall，
 * 我们的产出就是它的返回值——不需要伪造会话事件。
 *
 * ## 幂等的对象是"本步注入批次"
 *
 * `decision.messages` 是本步要送进模型的消息，不是会话历史。所谓"不累积"
 * 指每步最多一条通知：新通知原位替换同 kind 的旧通知（见 notice.ts），
 * 没有则追加；不需要通知时把本步批次里的旧通知剔掉。
 * 历史里已有的旧通知**不碰**——那是已经发生的事实，改写历史才是真的污染。
 *
 * ## 不断链
 *
 * waterfall 的规约是"每个监听者要么 `await next()` 要么自己定义结果"。
 * 我们只在 `next()` 之后加工它的结果，且任何异常都降级为"原样返回
 * downstream 的决定"。读技能正文失败不该让用户这一轮问不出去。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent';

import { describeError } from '../l0/errors.js';
import { createModeUpdateMessage, applyModeUpdate } from './notice.js';
import type { PromptPorts } from './port.js';
import { renderModeUpdate } from './ladder.js';
import type { LadderSource } from './source.js';
import type { StatsSink } from '../stats/types.js';

/** 装配参数。 */
export interface ReminderOptions {
  /** 档位与会话档案（见 port.ts：prompt 层不认识 config / state 的具体类型）。 */
  readonly ports: PromptPorts;
  /** 阶梯正文来源。 */
  readonly source: LadderSource;
  /**
   * 效率统计的埋点。可选：没有它插件照常工作，只是面板与命令看到的是空数据。
   * 只收两个回调而不是 store 本体，本层于是不必认识 stats 层的类型。
   */
  readonly stats?: StatsSink | undefined;
}

/** 日志前缀，与插件名一致，方便用户在 `~/.dsh/logs` 里筛。 */
const LOGGER_SCOPE = 'ponytail-58fly';

/**
 * 装上 `agent/pre-step` 监听器。
 *
 * 用 `ctx.on` 而不是 `ctx.effect`：`ctx.on` 的返回值本身就是随 fiber 卸载的
 * disposer，再包一层 effect 只会制造两个真相。
 * @param ctx - 插件上下文。
 * @param options - 依赖。
 */
export function installModeReminder(ctx: Context, options: ReminderOptions): void {
  ctx.on(
    'agent/pre-step',
    async (payload: { agent: Agent; signal: AbortSignal }, next: () => Promise<PreStepDecision>): Promise<PreStepDecision> => {
      const decision = await next();
      // 上游决定拒绝这一步时，我们不注入任何东西：一条 reminder 塞进被拒的
      // 步骤里既到不了模型，也会让"已宣告"标记与实际不符。
      if (decision.kind !== 'enter') return decision;

      try {
        // 每步至多一次 stat；内容没变不重读（见 source.ts 的指纹判据）。
        await options.source.refresh();

        // 宿主在本步已被取消时，do not fabricate work：原样返回。
        if (payload.signal.aborted) return decision;

        const entry = options.ports.ensure(payload.agent.id, () => options.ports.mode);
        const current = options.ports.mode;
        // 受管轮次：走到这里说明本步确实由 agent 进入，正是「ponytail 管了一轮」。
        options.stats?.onTurn(current);

        if (current === entry.announcedMode) {
          // 档位没变：把本步批次里的残留通知剔掉（正常情况下本来就没有）。
          return applyModeUpdate(decision, null);
        }

        const previous = entry.announcedMode;
        const text = renderModeUpdate(current, previous, options.source.body);
        // 注入次数与字节数：只在这一步真要把 reminder 送进消息批次时记。
        options.stats?.onInject(text);
        const message = createModeUpdateMessage(current, previous, text);
        // 先标记再返回：`applyModeUpdate` 是纯函数，不会失败；若在它之后再标记，
        // 中途抛错会让下一步重复注入同一条通知。
        entry.announcedMode = current;
        return applyModeUpdate(decision, message);
      } catch (error) {
        // 不断链：读技能正文、建会话档案、造消息任何一步炸了，这一轮照常进行。
        ctx.logger(LOGGER_SCOPE).warn('档位提醒注入失败，本步按原样继续：' + describeError(error));
        return decision;
      }
    },
  );
}
