/**
 * prompt 层对外的两个端口（依赖倒置的那一半接口）。
 *
 * ## 为什么不直接 import ConfigRuntime / SessionStore
 *
 * scripts/verify.mjs 的分层矩阵是 plugin.ts → {prompt, state, config, skills} → l0，
 * 即**四层之间互不可见**。提示渲染确实需要两个上游事实——当前活档位
 * 与会话诞生档位——但它们属于 config 与 state 两层的实现细节。
 *
 * 让 prompt 直接 import 它们有两个后果：分层图变成双向（config 将来想引用
 * prompt 的文案就会被拒），以及 prompt 的单测必须先造出整个 ConfigRuntime。
 * 这里只声明**形状**，由 plugin.ts 把两个真实对象适配进来：依赖方向仍然是
 * plugin.ts → prompt，prompt → l0，一行都不用破例。
 *
 * ## 为什么 mode 是 getter 而不是字段
 *
 * 提示渲染要读的是「这一刻」的档位。若适配器写成 { mode: runtime.mode }，
 * 拿到的是构造时的快照，之后每次切档都不生效——这是最难查的一类 bug
 * （面板显示已切换，提示却还是旧值）。
 */
import type { SessionId } from '@deepseek-ai/dsh-session';

import type { RuntimeMode } from '../l0/mode.js';

/**
 * 会话档案的最小形状。
 *
 * baselineMode 只读：诞生时定下，终身不变，连我们自己也不改。
 * announcedMode 可写：它是「上一次往消息流里宣告过哪个档位」的记账本，
 * 每宣告一次就前进一步。
 */
export interface SessionRecord {
  /** 会话诞生时的档位，决定前缀段正文，终身不变。 */
  readonly baselineMode: RuntimeMode;
  /** 上一次已宣告给模型的档位；与活档位不等时就要发一条 reminder。 */
  announcedMode: RuntimeMode;
}

/**
 * prompt 层需要上层提供的全部能力。
 *
 * 刻意做成「一个对象两个成员」而不是两个对象：调用方（plugin.ts）只需造一份，
 * 而实现方（ConfigRuntime + SessionStore）的对应关系一眼可见。
 */
export interface PromptPorts {
  /** 当前生效档位（活值，每次读都要重新取）。 */
  readonly mode: RuntimeMode;
  /**
   * 取会话档案，没有就按 fallback() 建档。
   *
   * 返回的是**活引用**：调用方可以就地改 announcedMode，改动对下次调用可见。
   * @param sessionId - 会话 id。
   * @param fallback - 首次建档时调用一次，取当时的活档位作为 baseline。
   */
  ensure(sessionId: SessionId, fallback: () => RuntimeMode): SessionRecord;
}
