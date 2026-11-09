/**
 * 效率区块的两张图（票 06）。纯 SVG，零依赖。
 *
 * **为什么手写 SVG 而不引图表库**：一共两个图形（一个双分量环、四根条），
 * 任何一个图表库都会让 `lib/client.js` 涨几十 KB，而这里只需要把两个数字
 * 换成一个 `stroke-dasharray` 和一个百分比宽度。规范见
 * `docs/design/ponytail-efficiency-ui.md` §2 与 §5。
 *
 * **颜色一律走主题变量**：`--dsw-alias-state-business-primary` / `--dsw-alias-border-l3`
 * 等，不写任何 `#hex`——宿主有明暗两套主题，写死颜色会在其中一套里失明。
 *
 * **viewBox 固定、尺寸自适应**：环用固定 64×64（缩放会让 8px 笔画失真），
 * 条用 div（没有曲线，div 比 SVG 短也很好测）。
 *
 * @module
 */
import type { ReactNode } from 'react';
import type { RuntimeMode } from '../l0/mode.js';

/** 环半径与笔画：周长 `2πr` 是 dasharray 的分母，改 r 必须改这里。 */
const RING_RADIUS = 28;
const RING_STROKE = 8;
/** `2π × 28 = 175.929…`，留三位小数够用。 */
const RING_CIRCUMFERENCE = 175.93;

/** 注入率环。
 *
 * 只画「已注入」这一条有长度的弧，底环永远是完整的一圈——于是「进度」在视觉上
 * 只由一个量决定，不会出现两条弧互相盖住的歧义。
 */
export interface RingProps {
  /** 已注入次数。 */
  readonly value: number;
  /** 分母（受管轮次）。为 0 时只画底环，不画任何进度。 */
  readonly total: number;
  /** 无障碍标签。 */
  readonly label: string;
}

/**
 * 渲染注入率环。
 *
 * `total === 0` 时不画进度弧：画一个 0% 的环等于宣称「注入率 0%」，而真相是
 * 「还没有轮次」（§2 的空数据约定）。
 * @param props - 分子、分母与无障碍标签。
 * @returns 64×64 的 SVG。
 */
export function Ring(props: RingProps): ReactNode {
  const ratio = props.total > 0 ? Math.min(1, Math.max(0, props.value / props.total)) : 0;
  const percent = Math.round(ratio * 100);
  return (
    <svg width={64} height={64} viewBox="0 0 64 64" role="img" aria-label={props.label + '：' + String(percent) + '%'}>
      <title>{props.label + '：' + String(percent) + '%'}</title>
      <circle
        cx={32}
        cy={32}
        r={RING_RADIUS}
        fill="none"
        stroke="var(--dsw-alias-border-l3)"
        strokeWidth={RING_STROKE}
      />
      {ratio > 0 ? (
        <circle
          cx={32}
          cy={32}
          r={RING_RADIUS}
          fill="none"
          stroke="var(--dsw-alias-state-business-primary)"
          strokeWidth={RING_STROKE}
          strokeLinecap="round"
          strokeDasharray={String(ratio * RING_CIRCUMFERENCE) + ' ' + String(RING_CIRCUMFERENCE)}
          transform="rotate(-90 32 32)"
        />
      ) : null}
      <text
        x={32}
        y={36}
        textAnchor="middle"
        fontSize={16}
        fontWeight={600}
        fill="var(--dsw-alias-label-primary)"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {String(percent) + '%'}
      </text>
    </svg>
  );
}

/** 横向条的一行。 */
export interface BarRow {
  /** 行 key，同时是左侧标签。 */
  readonly key: RuntimeMode;
  /** 左侧标签文案。 */
  readonly label: string;
  /** 本行数值。 */
  readonly value: number;
}

/** 横向条的入参。 */
export interface BarListProps {
  /** 四档固定四条，零值也出。 */
  readonly rows: readonly BarRow[];
  /** 无障碍标签。 */
  readonly label: string;
}

/**
 * 渲染按档位分布的横向条。
 *
 * 宽度按「本行 / 最大值」归一：这是相对量，四个档位共用一条轴，涂同一颜色
 * （涂成四色会被误读成四个类别，§4）。
 * @param props - 四行数据。
 * @returns 一列 div。
 */
export function BarList(props: BarListProps): ReactNode {
  const max = props.rows.reduce((peak, row) => Math.max(peak, row.value), 0);
  return (
    <div
      role="img"
      aria-label={props.label}
      style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 160, flex: 1 }}
    >
      {props.rows.map((row) => {
        const width = max > 0 ? (row.value / max) * 100 : 0;
        return (
          <div key={row.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                width: 36,
                flex: '0 0 36px',
                fontSize: 12,
                lineHeight: '18px',
                color: 'var(--dsw-alias-label-secondary)',
              }}
            >
              {row.label}
            </span>
            <span
              style={{
                flex: 1,
                height: 8,
                borderRadius: 'var(--dsw-radius-sm)',
                background: 'var(--dsw-alias-border-l3)',
                overflow: 'hidden',
                display: 'block',
              }}
            >
              <span
                style={{
                  display: 'block',
                  height: '100%',
                  width: String(width) + '%',
                  borderRadius: 'var(--dsw-radius-sm)',
                  background: 'var(--dsw-alias-state-business-primary)',
                }}
              />
            </span>
            <span
              style={{
                width: 28,
                flex: '0 0 28px',
                textAlign: 'right',
                fontSize: 12,
                lineHeight: '18px',
                color: 'var(--dsw-alias-label-secondary)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {String(row.value)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
