/**
 * 上游基准系数表：**唯一**允许出现百分比数字的文件。
 *
 * UI、命令、文档都不许重写这些数字，只能引用本表——改基准只改一处，
 * 且可以被单测钉住。
 *
 * ## 限定语（必须与数字一起出现，见 docs/design/ponytail-efficiency-ui.md 第 4 节）
 *
 * 这是**别人的测量**：Claude Code + Opus 5.5、39 任务 × 5 次 × 三臂，
 * 每任务取中位数后对任务取几何平均，区间为 95% bootstrap。它说的是
 * 「上游基准环境下同类任务的相对变化」，不能迁移到本机、更不能说成
 * 「你省了 X」。出处与方法学见 `docs/research/upstream-efficiency-metrics.md`。
 */
import type { RuntimeMode } from '../l0/mode.js';

/** 一条基准系数：中心值 + 可选区间 + 出处。 */
export interface BaselineRow {
  /** 相对基线（不用 ponytail）的变化比例，负数表示减少。 */
  readonly center: number;
  /** 95% 区间；单点估计时省略。 */
  readonly range?: readonly [number, number];
  /** 出处；UI 必须能点开。 */
  readonly source: string;
}

/** 上游方法学文件，所有行共用同一出处。 */
const SOURCE = 'https://github.com/DietrichGebert/ponytail/blob/main/benchmarks/results/2026-10-07-agentic.md';

/** 基准表。7 个字段与 01 票的复核结论一一对应。 */
export const BASELINE = {
  loc: { center: -0.53, range: [-0.63, -0.41], source: SOURCE },
  codeInformationGzip: { center: -0.41, range: [-0.51, -0.3], source: SOURCE },
  outputTokens: { center: -0.45, range: [-0.54, -0.35], source: SOURCE },
  cost: { center: -0.26, range: [-0.36, -0.16], source: SOURCE },
  time: { center: -0.41, range: [-0.49, -0.32], source: SOURCE },
  turns: { center: -0.22, source: SOURCE },
  /** 38 个可比任务里 30 个更便宜；不是比例，是计数。 */
  cheaperOnTasks: { center: 30 / 38, source: SOURCE },
} as const satisfies Record<string, BaselineRow>;

/** UI 与命令都必须带上的限定语，只此一份。 */
export const BASELINE_CAVEAT = '这是上游基准，不是本机测量。';

/** 单轮输出 token 的假设值：推算时的分母倍数，UI 必须显式写出来。 */
export const ASSUMED_TOKENS_PER_TURN = 800;

/** 一行预估：中心值与区间，跟随 BASELINE 的形状。 */
export interface Estimate {
  /** 中心估计。 */
  readonly center: number;
  /** 区间下界（变化更小的一侧）；无区间时为 null。 */
  readonly from: number | null;
  /** 区间上界（变化更大的一侧）；无区间时为 null。 */
  readonly to: number | null;
  /** 出处链接。 */
  readonly source: string;
}

/** 推算结果。字段名即 UI 措辞，UI 不需要自己猜该怎么讲。 */
export interface SavingsProjection {
  /** 参与推算的轮次（分母）。为 0 时其余字段全 0，UI 显示空态。 */
  readonly activeTurns: number;
  /** 假设的单轮输出 token 数。 */
  readonly tokensPerTurn: number;
  /** 预估减少的输出 token 数（负数表示减少）。 */
  readonly outputTokens: Estimate;
  /** 预估减少的成本比例折算。 */
  readonly cost: Estimate;
  /** 预估减少的时间比例折算。 */
  readonly time: Estimate;
}

/** 按档位拆分的最小输入形状（避免 projection 依赖整个快照类型）。 */
interface ModeTurns {
  readonly managedTurns: number;
  readonly turnsByMode: Readonly<Record<RuntimeMode, number>>;
}

/**
 * 把「我们量到的次数」乘上「上游基准」得到预估。
 *
 * 只统计档位非 off 的受管轮次：off 档下不注入任何东西，把这些轮次算进
 * 省下的量就是凭空造数。
 * @param stats - 计数快照或任何同形状对象。
 * @param tokensPerTurn - 假设的单轮输出 token 数。
 * @returns 三行预估 + 分母。
 */
export function projectSavings(stats: ModeTurns, tokensPerTurn = ASSUMED_TOKENS_PER_TURN): SavingsProjection {
  const activeTurns = Math.max(0, stats.managedTurns - stats.turnsByMode.off);
  const base = activeTurns * tokensPerTurn;
  const scale = (row: BaselineRow): Estimate => ({
    center: base * row.center,
    from: row.range === undefined ? null : base * row.range[0],
    to: row.range === undefined ? null : base * row.range[1],
    source: row.source,
  });
  return {
    activeTurns,
    tokensPerTurn,
    outputTokens: scale(BASELINE.outputTokens),
    cost: scale(BASELINE.cost),
    time: scale(BASELINE.time),
  };
}
