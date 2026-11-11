/**
 * 把诊断报告翻成「三根管道各自什么状态」，供渲染直接消费。
 *
 * **为什么还要这一层**：`diagnose()` 的 `state` 描述的是「这一行在报告里
 * 怎么解释」（被覆盖 / 不可观测 / 没写），渲染要的是「这截管道通不通」。
 * 两者大部分时候同形，但有一处必须分开判——补丁层的合法性。
 * 诊断链按值归属反推，用户写了非法值、组合层又有合法值时，补丁层会被报成
 * `hit`（判据缺陷，见票 05）；照抄它，管道就会把一个不存在的档位显示成
 * 「正在生效」。归因不信那个 `hit`，自己按取值域判。
 *
 * 规则见规格 `.scratch/ponytail-visual/spec.md`：
 * 1. env 命中即命中；不可观测即不可观测。
 * 2. patch 的值不在 `RUNTIME_MODES` 里即非法，不看报告说它命没命中。
 * 3. 前两层都没命中，兜底命中。
 * 4. 非法不阻断扫描——`不可观测 + 非法 + 命中` 是合法组合。
 * 5. 没写值的层是 `past`，由渲染整段淡出；写了没赢的保持 `miss` / `invalid`。
 *
 * @module
 */
import { isRuntimeMode, type RuntimeMode } from '../l0/mode.js';
import type { Diagnosis, DiagnosisLevel } from '../l0/diagnosis.js';

/** 一层在管道里的状态。 */
export type AttributionState =
  /** 答案落在这一层。 */
  | 'hit'
  /** 这一层写了值，但没赢。 */
  | 'miss'
  /** 没轮到这一层：上面已经命中。 */
  | 'past'
  /** 这一层写了值，但不是合法档位。 */
  | 'invalid'
  /** 这一层在浏览器侧不可观测（只有 env）。 */
  | 'unknown';

/** 管道里的一层。 */
export interface AttributionLevel {
  /** 层名，恒为 env → patch → fallback。 */
  readonly level: DiagnosisLevel;
  /** 卡面显示的三字层名。 */
  readonly label: string;
  /** 这一层的值；`unknown` 与 `past` 也可以带值，由渲染决定怎么用。 */
  readonly value: string | null;
  /** 这一层此刻的状态。 */
  readonly state: AttributionState;
}

/** 归因结论。 */
export interface Attribution {
  /** 三层，顺序与诊断报告一致。 */
  readonly levels: readonly AttributionLevel[];
  /** 最终生效档位。 */
  readonly effective: RuntimeMode;
  /** 答案落在哪一层。 */
  readonly from: DiagnosisLevel;
}

/**
 * 层名。与诊断报告里的 `label` 不同：这里是卡面用的短名，报告里的名字
 * 带着实现细节（「Profile 补丁」），上卡面读者不认识。
 */
const LABELS: Readonly<Record<DiagnosisLevel, string>> = {
  env: '环境变量',
  patch: '配置文件',
  fallback: '内置默认值',
};

/**
 * 按诊断报告算归因。
 * @param diagnosis - `diagnose()` 的结论。
 * @returns 三层状态、生效档位与答案所在层。
 */
export function attribute(diagnosis: Diagnosis): Attribution {
  const row = (level: DiagnosisLevel): (typeof diagnosis.rows)[number] | undefined =>
    diagnosis.rows.find((item) => item.level === level);

  // 一层没落在报告里（不该发生，但报告是外部数组）就当没这一层，管道少画一格。
  const env = row('env');
  const patch = row('patch');
  const fallback = row('fallback');

  // env 只有两种面貌：报告说命中了就命中，否则一定是不可观测——浏览器永远
  // 读不到宿主的环境变量。
  const envState: AttributionState = env?.state === 'hit' ? 'hit' : 'unknown';

  // 补丁层按取值域判合法性，不看报告怎么说：报告那一步按值归属，跨层拼接时
  // 会把非法值报成命中。没写与写了没赢必须分开——前者整段淡出，后者画空心圆。
  const patchValue = patch?.value ?? null;
  const patchState: AttributionState =
    patchValue === null ? 'past' : isRuntimeMode(patchValue) ? 'miss' : 'invalid';

  const from: DiagnosisLevel = envState === 'hit' ? 'env' : patchState === 'miss' ? 'patch' : 'fallback';

  /**
   * 写了却没赢的 `miss` / `invalid` 一律保留原貌，只有没写值的那层才是 `past`。
   *
   * 否则管道会抹掉「用户写了 ultra，但环境变量更横」这条最有用的信息——
   * 而那是这张卡唯一能说、别处看不到的东西。
   */
  const draft: readonly AttributionLevel[] = [
    { level: 'env', label: LABELS.env, value: envState === 'hit' ? diagnosis.effective : null, state: envState },
    { level: 'patch', label: LABELS.patch, value: patchValue, state: patchState },
    { level: 'fallback', label: LABELS.fallback, value: fallback?.value ?? diagnosis.effective, state: 'past' },
  ];
  const levels: readonly AttributionLevel[] = draft.map((item) => (item.level === from ? { ...item, state: 'hit' } : item));

  return { levels, effective: diagnosis.effective, from };
}
