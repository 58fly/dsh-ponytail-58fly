/**
 * 效率卡用到的三处几何与数轴换算（票 02）。纯函数，无 DOM、无依赖。
 *
 * 单独成文件是为了能被 `node --test` 直接测：`panel.tsx` 依赖宿主 primitives，
 * 在 Node 里 import 不到（见 `scripts/build-client.mjs` 的 `PURE_MODULES`）。
 *
 * @module
 */
import { RUNTIME_MODES, type RuntimeMode } from '../l0/mode.js';

/** 堆叠条的一段。 */
export interface ModeSlice {
  /** 哪一档。 */
  readonly mode: RuntimeMode;
  /** 本档占的百分比，0–100。 */
  readonly share: number;
}

/**
 * 把四档轮次折成堆叠条的分段。
 *
 * 顺序固定按 `RUNTIME_MODES`（off 在最前），不按大小排——段的位置必须跨快照稳定，
 * 否则每次刷新颜色都换位置。
 *
 * 总和为 0 时返回空数组：调用方据此画一条空槽，而不是四段零宽（零宽段既看不见
 * 又会留下无意义的 border-radius 接缝）。
 * @param turns - 每档的受管轮次。
 * @returns 百分比分段；总和为 0 时为空。
 */
export function modeSlices(turns: Readonly<Record<RuntimeMode, number>>): readonly ModeSlice[] {
  const total = RUNTIME_MODES.reduce((sum, mode) => sum + Math.max(0, turns[mode]), 0);
  if (total <= 0) return [];
  return RUNTIME_MODES.map((mode) => ({ mode, share: (Math.max(0, turns[mode]) / total) * 100 }));
}

/** 区间条上的一行。 */
export interface BandRow {
  /** 行名（极短，卡面上只留这几个字）。 */
  readonly label: string;
  /** 中心值占轴的百分比；缺区间时用它画一个点。 */
  readonly center: number;
  /** 区间起止占轴的百分比；`null` 表示这一行没有区间。 */
  readonly band: readonly [number, number] | null;
}

/** 区间条横轴的定点：`−60% … 0`。 */
export const BAND_MIN = -60;
export const BAND_MAX = 0;

/**
 * 把比例值投到 `−60% … 0` 这条轴上。
 *
 * 轴的两端写死（规格 §渲染契约）：三行必须共用一条轴才可比，轴若跟着数据缩放，
 * 「成本 −26%」和「耗时 −41%」会画成一样长。超出轴范围的值的夹到端点，
 * 不然条会画到格子外面。
 * @param ratio - 比例，`-0.45` 表示 −45%。
 * @returns 0–100 的轴坐标。
 */
export function axisPercent(ratio: number): number {
  const clamped = Math.min(BAND_MAX, Math.max(BAND_MIN, ratio * 100));
  return ((clamped - BAND_MIN) / (BAND_MAX - BAND_MIN)) * 100;
}

/**
 * 把一行估算折成区间条。
 *
 * 区间两端可能大小颠倒（`from` 是变化更小的一侧、`to` 是更大的一侧，两者都是负数），
 * 这里统一成 `[小, 大]`，否则宽度会算出负数。
 * @param label - 行名。
 * @param center - 中心比例。
 * @param range - 两端比例；缺省时这一行只画中点。
 * @returns 可直接画的一行。
 */
export function bandRow(label: string, center: number, range: readonly [number, number] | null): BandRow {
  const mid = axisPercent(center);
  if (range === null) return { label, center: mid, band: null };
  const left = axisPercent(Math.min(range[0], range[1]));
  const right = axisPercent(Math.max(range[0], range[1]));
  return { label, center: mid, band: [left, right] };
}
