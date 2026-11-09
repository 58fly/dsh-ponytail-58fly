/**
 * 效率统计的词汇表：计数键与快照形状。
 *
 * 这里只有类型与常量，没有任何状态，也没有任何宿主依赖——于是 UI、命令层、
 * 计数本体能引用同一份字段名，不会出现「面板叫 managedTurns、命令叫 turns」
 * 这种同一事实两种叫法的漂移。
 */
import type { RuntimeMode } from '../l0/mode.js';

/**
 * 一个计数键。
 *
 * 全部是「发生过多少次」，单位写在注释里而不是键名里。
 */
export type CounterKey =
  /** 经过一次 `agent/pre-step` 且决定 `enter`（= 一次受管轮次）。 */
  | 'managedTurns'
  /** 真正把 reminder 塞进本步消息批次。 */
  | 'injections'
  /** reminder 正文字节数累加（UTF-8）。 */
  | 'injectedBytes'
  /** `/ponytail` 与 `/ponytail-gain` 的调用次数。 */
  | 'commandCalls'
  /** 档位真的写入成功的次数。 */
  | 'modeSwitches';

/** 快照里的固定形状。所有字段都是整数，全部可 JSON 序列化。 */
export interface StatsSnapshot {
  /** 格式版本；将来换形状时靠它做迁移。 */
  readonly version: 1;
  /** 受管轮次：pre-step 决定 enter 的步数。 */
  readonly managedTurns: number;
  /** 注入次数：真正注入了 reminder 的步数（≤ managedTurns）。 */
  readonly injections: number;
  /** 注入字节：所有 reminder 正文的 UTF-8 字节和。 */
  readonly injectedBytes: number;
  /** 按档位拆分的受管轮次。四档恒在，缺省 0，方便 UI 直接遍历。 */
  readonly turnsByMode: Readonly<Record<RuntimeMode, number>>;
  /** 切档次数。 */
  readonly modeSwitches: number;
  /** `/ponytail*` 命令调用次数。 */
  readonly commandCalls: number;
  /** 第一次计数的时间戳（ms）；还没有任何计数时为 null。 */
  readonly firstAt: number | null;
  /** 最后一次计数的时间戳（ms）；还没有任何计数时为 null。 */
  readonly lastAt: number | null;
}

/** 带变更序号的快照：客户端据此判断「这份快照是不是新的」。 */
export interface StatsView extends StatsSnapshot {
  /** 单调递增的变更序号，清零时归零。 */
  readonly revision: number;
}

/**
 * 埋点回调。`prestep` 只认这两个函数，不认识 StatsStore 本体——
 * 于是 prompt 层不必 import stats 层，分层矩阵零改动。
 */
export interface StatsSink {
  /** 记一次受管轮次（带上本步生效的档位）。 */
  readonly onTurn: (mode: RuntimeMode) => void;
  /** 记一次注入（带上 reminder 正文字符串，字节数由实现自己算）。 */
  readonly onInject: (text: string) => void;
}
