/**
 * state 模块：会话级内存状态。
 *
 * 边界：
 * - **只**内存，不落盘。上游把会话档位写进 `~/.dsh/ponytail/sessions.json`
 *   （src/ponytail-state.ts 的 savePersistedSessions / loadPersistedSessions），
 *   带来三宗罪：每次新建会话都写盘、MAX_SESSIONS 淘汰逻辑、跨进程陈旧态。
 *   宿主 0.2.2 的 `agent/disposed` 事件已经能精确告诉我们"这个 agent 走了"，
 *   没有任何理由自己维护一份磁盘快照。
 * - 容器只存"会话诞生时定下的东西"与"已经对外宣告过什么"，不存"当前档位"——
 *   当前档位每次从补丁/环境/命令推导（`ConfigRuntime.mode`），缓存它会引入过期读。
 *
 * ## 两个字段各解决一个真问题
 *
 * - `baselineMode`：**前缀稳定**。system prompt 的固定段只按它渲染，终身不变，
 *   于是同一个会话里连续对话的前缀字节完全一致，KV cache 不被切档作废。
 *   上游每轮重渲染 section（src/ponytail-instructions.ts:85），切一次档就把整个
 *   前缀作废一次，这是 B-03。
 * - `announcedMode`：**单通知幂等**。它是"上一条尾部 reminder 宣告的是哪一档"。
 *   与当前档位比对即可判定本步要不要发通知，无需在消息批次里做模糊匹配。
 *
 * 两者的关系：baseline 是"这个会话从此按什么档位活着"，announced 是"模型最近
 * 一次被告知的是哪一档"。二者初始相同（会话诞生时宣告一次？不——诞生时 baseline
 * 就在前缀里，不需要额外通知，所以初始 `announcedMode === baselineMode`）。
 *
 * key 的来源：`agent/pre-step` 的 payload 里**没有** sessionId，只有 `agent`，
 * 所以 key 必须从 agent 反推。`Agent` 在 0.2.2 的形状是 `{ readonly id: SessionId }`
 * （dsh-agent/lib/types/types.d.ts:12-15），直接 `agent.id` 即可，不需要任何断言。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { SessionId } from '@deepseek-ai/dsh-session';

import type { RuntimeMode } from '../l0/mode.js';

/** 一条会话状态。 */
export interface SessionEntry {
  /** 会话诞生时定下的档位，终身不变。 */
  baselineMode: RuntimeMode;
  /** 最近一次注入的通知里宣告的档位；与 baseline 相同表示"模型已知的就是 baseline"。 */
  announcedMode: RuntimeMode;
}

/** 会话状态容器。 */
export class SessionStore {
  readonly #entries = new Map<SessionId, SessionEntry>();

  /**
   * 取一条会话状态，不存在时用 `resolve()` 现场建档。
   *
   * 「建档」这一刻就是"会话诞生"：`resolve` 返回当时的生效档位，此后终身不变。
   * 用回调而不是值，是为了让"不需要建档"的路径（已存在）完全不调用它——
   * 每次 pre-step 都去读一遍配置链是白白多一次 `describe()` 的机会。
   * @param id - 会话 id。
   * @param resolve - 首次建档时的档位来源。
   * @returns 该会话的状态（活引用，调用方可就地改 `announcedMode`）。
   */
  ensure(id: SessionId, resolve: () => RuntimeMode): SessionEntry {
    const existing = this.#entries.get(id);
    if (existing !== undefined) return existing;
    const mode = resolve();
    const created: SessionEntry = { baselineMode: mode, announcedMode: mode };
    this.#entries.set(id, created);
    return created;
  }

  /** 读一条会话状态。 */
  get(id: SessionId): SessionEntry | undefined {
    return this.#entries.get(id);
  }

  /**
   * 删除一条会话状态。
   * @param id - 会话 id。
   * @returns 是否真的删掉了一条。
   */
  delete(id: SessionId): boolean {
    return this.#entries.delete(id);
  }

  /** 当前存活的会话数，测试用。 */
  get size(): number {
    return this.#entries.size;
  }
}

/**
 * 把 store 挂到宿主的 agent 生命周期上，agent 走了就删。
 *
 * **必须监听 `agent/disposed`**：这是宿主明确保证的清理点
 * （"An agent left the registry; AgentLoop emits this after driver quiescence
 * and scoped-registration unwind, but before session detachment."）。
 * 不监听就等着内存随会话数单调增长——上游正是如此，只能靠 MAX_SESSIONS 兜。
 * @param ctx - 宿主上下文。
 * @returns 容器实例；监听器随插件 fiber 一起卸载。
 */
export function installSessionStore(ctx: Context): SessionStore {
  const store = new SessionStore();
  // `Agent` 在这里显式标注是刻意的：`agent/disposed` 的事件声明住在
  // `@deepseek-ai/dsh-agent/lib/types/runtime-types.d.ts` 的
  // `declare module '@deepseek-ai/cordis'` 里，只有该包的类型被真正引用时
  // 增强才会生效。只 import 不引用会被 noUnusedLocals 判未用，写进参数
  // 标注既激活增强、又让"这个事件给的是什么"在代码里可见。
  ctx.on('agent/disposed', (payload: { readonly agent: Agent }) => {
    store.delete(payload.agent.id);
  });
  return store;
}
