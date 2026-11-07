/**
 * prompt · 档位变更通知（尾部 reminder）的构造与单通知幂等。
 *
 * 上游同一件事写了 60 行还带着一条自造的 `session/event` 扒取路径
 * （src/ponytail-commands.ts 的 dispatcher）。这里只做两件必要的事：
 * 造一条消息、把它放进本步的注入批次。**不碰会话历史，不监听消息事件。**
 *
 * ## 为什么"单通知"要以 `decision.messages` 为作用域
 *
 * `agent/pre-step` 的 `decision.messages` 是**本步要注入的消息批次**，不是会话历史
 * （见 dsh-agent 的 `PreStepDecision`：`{ kind: 'enter'; messages: UserMessage[] }`）。
 * 历史已经在日志里，改写它既没有 API 也没有必要。所以：
 *
 * - 每步开始时该批次是空的（或只有别的插件加的东西）；
 * - 我们最多往里放一条 `ponytail-mode-update`；
 * - 若本步不该有（档位没变），就把批次里那条**移除**——这不是"删除历史"，
 *   只是"这一步不再重复说一遍"。
 *
 * 这正是宿主 `dsh-tool-skill` 的做法（`lib/index.js:931-990`：digest 相等就
 * `decision.messages.filter(m => m.id !== existing.message.id)`），也是
 * `dsh-plan-mode` 的做法（`lib/index.js:168-190`：pending 不存在就原样返回）。
 *
 * ## 为什么消息来源要自己声明一个 kind
 *
 * `MessageSourceMap` 是 merge-extensible 的 sum type，官方注释写得很明确：
 * "each producer declares its own kind in its own module; there is no shared
 * catch-all plugin kind"，消费者对未知 kind 走 fall-through。所以往这个 registry 里
 * 加一条 `ponytail-mode-update` 是**设计规定的姿势**，不是绕过类型系统。
 *
 * 不声明 form 也是规定内的：「Omitting `form` stays valid — an undeclared context
 * is the documented default」。这条消息既不是 catalog（不随内容重发）也不是 notice
 * （notice 要求一行摘要且受 120 字符上限），它就是一段替换式指令，无 form 最诚实。
 */
import { randomUUID } from 'node:crypto';

import type { PreStepDecision } from '@deepseek-ai/dsh-agent';
import type { MessageId, UserMessage } from '@deepseek-ai/dsh-llm';

import type { RuntimeMode } from '../l0/mode.js';

/** 本插件自己声明的消息来源。 */
export interface PonytailModeUpdateSource {
  /** 判别式。 */
  readonly kind: 'ponytail-mode-update';
  /** 这条消息宣告的档位。 */
  readonly mode: RuntimeMode;
  /** 切换前档位；无法确定时 null。 */
  readonly previousMode: RuntimeMode | null;
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'ponytail-mode-update': PonytailModeUpdateSource;
  }
}

/** 本插件注入的消息来源判别式。 */
export const MODE_UPDATE_KIND = 'ponytail-mode-update';

/**
 * 给裸字符串打上 `MessageId` 品牌。
 *
 * 全仓**只此一处**做这个断言。宿主厂商自己的做法是调 `MessageId(id)`，而那个函数
 * 的实现就是 `brandString(id)`——运行时原样返回入参，品牌只存在于类型层
 * （`dsh-llm/lib/types/brand.js` → `@deepseek-ai/dsh-brand`）。
 * 我们不能值导入它：`@deepseek-ai/dsh-llm` 在用户 profile 里不可解析，
 * 值导入会让产物带一条必炸的 `import`（同 `skills/provider.ts` 文件头的教训）。
 * @param raw - 原始 id 字符串。
 * @returns 品牌化的 id。
 */
function brandMessageId(raw: string): MessageId {
  return raw as MessageId;
}

/**
 * 造一条档位变更消息。
 *
 * `deepFreeze` 不做——宿主自己那条路径（`createMessage`）会 clone + freeze，
 * 但它 clone 的是自己收到的入参；我们交出去的这条只在本次 pre-step 里存活，
 * 冻结一个马上要被消费的对象没有收益。**冻结内容的语义边界留给宿主**。
 * @param mode - 新档位。
 * @param previousMode - 上一档位。
 * @param text - 已渲染的消息正文。
 * @returns 可直接放进 `decision.messages` 的消息。
 */
export function createModeUpdateMessage(
  mode: RuntimeMode,
  previousMode: RuntimeMode | null,
  text: string,
): UserMessage {
  return {
    id: brandMessageId(randomUUID()),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: MODE_UPDATE_KIND, mode, previousMode },
  };
}

/**
 * 在注入批次里定位本插件的那条消息。
 * @param messages - 本步注入批次。
 * @returns 下标，没有则 -1。
 */
function indexOfModeUpdate(messages: readonly UserMessage[]): number {
  return messages.findIndex((message) => message.source?.kind === MODE_UPDATE_KIND);
}

/**
 * 把"本步要不要说这条"落到 `decision` 上。
 *
 * 三种情形，全部只动本步批次：
 *
 * | 入参 | 批次里已有 | 结果 |
 * |---|---|---|
 * | `update` 非 null | 有 | 原位替换（保持位置，不堆积） |
 * | `update` 非 null | 无 | 追加一条 |
 * | `update` 为 null | 有 | 移除（本步不重复说） |
 * | `update` 为 null | 无 | 原样返回（不产生新对象） |
 *
 * `decision.kind === 'reject'` 时无条件原样返回：那一步根本不会跑模型，
 * 往里塞消息没有任何意义，而丢掉 reject 会破坏 agent-loop 的短路语义。
 * @param decision - `next()` 的结果。
 * @param update - 本步要注入的消息；null 表示本步不该有。
 * @returns 新的 decision 或原对象。
 */
export function applyModeUpdate(
  decision: PreStepDecision,
  update: UserMessage | null,
): PreStepDecision {
  if (decision.kind !== 'enter') return decision;
  const messages = decision.messages;
  const index = indexOfModeUpdate(messages);
  if (update === null) {
    if (index === -1) return decision;
    return { ...decision, messages: messages.filter((_message, at) => at !== index) };
  }
  if (index === -1) return { ...decision, messages: [...messages, update] };
  return {
    ...decision,
    messages: messages.map((message, at) => (at === index ? update : message)),
  };
}
