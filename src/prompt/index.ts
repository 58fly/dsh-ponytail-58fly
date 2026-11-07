/**
 * prompt 模块：向宿主 system prompt 注入 ponytail 固定段。
 *
 * ## 这一段是"前缀"，只认 baseline
 *
 * 段正文只由**会话诞生时的档位**（`baselineMode`）决定，终身不变。切档不碰它，
 * 改由 {@link file://./prestep.ts} 在消息尾部追加 reminder。理由：这一段位于
 * system prompt 的第 3 槽，任何字符变化都会让整条前缀的 KV cache 失效。
 *
 * ## 为什么文本函数能看见 agent
 *
 * 发布出去的 `AssembleContext` 只声明了 `{ scope?, signal? }`
 * （dsh-system-prompt/lib/types/index.d.ts:37-45），但宿主实装在装配时
 * **显式把 agent 塞了进去**：
 *
 * ```js
 * // dsh-agent/lib/index.js:400-413  assembleContextFor()
 * return { agent, scope: agent, ... };
 * ```
 *
 * 源码注释原文："Build the prompt assembly context with agent and scope set together,
 * so agent-scoped prompt and tool contributions cannot be silently omitted."
 *
 * 所以我们在本地收窄一个带 `agent?` 的接口读它，读不到（子代理拿根 ctx 装配、
 * 或宿主将来改了形状）就退回全局档位——降级成"段正文按当前档位渲染"，
 * 比整段消失或抛错都好。
 *
 * ## order = 50 落在哪
 *
 * 0.2.2 的 `SECTION_ORDERS` 是 `harness:identity`(-1000) →
 * `deployment:persona-prefix`(0) → **本段(50)** → `plan:policy`(500) → 工具段。
 * 作者原注释「位于 persona 与工具之间」成立（上游同样取 50），
 * 但上游 ADR-0012 的「约第 200 token」不成立：第 3 槽之前还有身份段。
 *
 * mode=off 时返回空串，宿主 `renderPrompt` 的 `.filter(text => text.length > 0)`
 * 会把它整段剔除（dsh-system-prompt/lib/index.js:119-121）——这是预期行为。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { AssembleContext } from '@deepseek-ai/dsh-system-prompt';

import type { RuntimeMode } from '../l0/mode.js';
import { renderLadderSection } from './ladder.js';
import type { PromptPorts } from './port.js';
import type { LadderSource } from './source.js';

/** 段名。宿主其它段都是 `命名空间:名字` 形态，插件段用包名短形式。 */
export const SECTION_NAME = 'ponytail-58fly';

/** 段顺序，见文件头的槽位说明。 */
export const SECTION_ORDER = 50;

/**
 * 宿主实装的装配上下文：`AssembleContext` 之外还有 agent。
 *
 * 这是**运行时事实、类型未声明**的字段，单独命名为一个接口而不是就地断言，
 * 是为了让"哪一处依赖了未声明的宿主行为"在代码里可被找到（grep 这个接口名）。
 */
interface AgentAssembleContext extends AssembleContext {
  readonly agent?: Agent;
}

/** 装配参数。 */
export interface PromptOptions {
  /** 档位与会话档案（见 port.ts：prompt 层不认识 config / state 的具体类型）。 */
  readonly ports: PromptPorts;
  /** 阶梯正文（同步缓存）。 */
  readonly source: LadderSource;
}

/**
 * 从一次装配里取出该用的档位。
 *
 * 有 agent：取它的 baseline（首次见到的档位即诞生档位，此后终身不变）。
 * 没 agent：退回全局活档位——这是"装配不属于任何会话"时的合理猜测，
 * 且不会写入任何会话档案。
 * @param options - 装配参数。
 * @param context - 宿主传入的装配上下文。
 * @returns 该段应使用的档位。
 */
function modeFor(options: PromptOptions, context: AssembleContext): RuntimeMode {
  const agent = (context as AgentAssembleContext).agent;
  if (agent === undefined) return options.ports.mode;
  return options.ports.ensure(agent.id, () => options.ports.mode).baselineMode;
}

/**
 * 注册 ponytail 段。
 *
 * `section()` 内部已经包了 `ctx.effect`（dsh-system-prompt/lib/index.js:255-258），
 * 调用方不需要再套一层——套两层不会报错，但会让 dispose 顺序难以推理。
 * @param ctx - 宿主上下文，必须已提供 systemPrompt 服务。
 * @param options - 依赖。
 * @returns 卸载函数（宿主返回的 disposer，也是幂等的）。
 */
export function installPrompt(ctx: Context, options: PromptOptions): () => void {
  return ctx.systemPrompt.section({
    name: SECTION_NAME,
    order: SECTION_ORDER,
    text: (context: AssembleContext) => renderLadderSection(modeFor(options, context), options.source.body),
  });
}
