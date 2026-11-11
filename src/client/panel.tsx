/**
 * 设置页里的 Ponytail 面板（#05）。
 *
 * **这个文件只读快照、只调两个写回调**，不知道宿主是 Cordis、不知道
 * `settings` 服务长什么样：所有宿主知识都压在 `src/client/index.ts` 的
 * `inject` 面里。这样面板本身可以在没有宿主的测试里被渲染，也不会因为
 * 宿主类型变化而整片重写。
 *
 * **档位只从快照读**：不维护本地档位状态、不做乐观更新。写成功后靠
 * `ConfigForm` 的 mirror 折进新 view 触发重渲染——那是宿主 transport 的
 * 唯一真相，本地先改会出现「界面显示切了、实际没写进去」的假象。
 *
 * **诊断链在 `src/l0/diagnosis.ts`**：浏览器读不到 `process.env`，
 * 只能按「谁的值等于生效值」反推命中层。这里只负责把它渲染成三行。
 *
 * **不写死任何颜色**：`--dsw-alias-*` 与官方 primitives 之外不出现 `#hex`，
 * 验收项 ③ 用 grep 钉住。布局只写 gap / padding 这类与主题无关的量。
 *
 * @module
 */
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { Button, HoverCard, Menu, SegmentedControl, Tag } from '@deepseek-ai/dsh-client-ui-primitives';
import { RUNTIME_MODES, type RuntimeMode } from '../l0/mode.js';
import {
  DIAGNOSIS_ENV_NAME,
  DIAGNOSIS_FALLBACK_LOCATION,
  DIAGNOSIS_PATCH_FROM_PROFILE,
  DIAGNOSIS_PATCH_LOCATION,
  diagnose,
  type Diagnosis,
  type DiagnosisLevel,
} from '../l0/diagnosis.js';
import {
  BASELINE,
  BASELINE_CAVEAT,
  baselineBasis,
  projectSavings,
  type BaselineRow,
  type Estimate,
  type SavingsProjection,
} from '../stats/baseline.js';
import type { StatsView } from '../stats/types.js';
import { attribute, type Attribution, type AttributionLevel, type AttributionState } from './attribution.js';
import { Ring } from './charts.js';
import { BAND_MAX, BAND_MIN, axisPercent, bandRow, modeSlices, type BandRow } from './mini.js';

/**
 * 「打开配置文件」的结果（票 06）。
 *
 * 三种结局都是真的，都要给读者一句话：开成了、文件还没生成、
 * 或者当前没有会话（右侧边栏按会话开标签，没会话无处可开）。
 */
export type ConfigOpenResult = 'opened' | 'missing' | 'no-session';

/** 效率区块的读取状态。`unsupported` 与 `error` 对用户是同一句话，分开只为排查。 */
export type StatsStatus = 'loading' | 'ready' | 'error';

/** `src/client/index.ts` 交给面板的效率侧接口。 */
export interface StatsPanelPort {
  /** 最近一次成功读到的快照；从没读到过是 null。 */
  readonly snapshot: StatsView | null;
  /** 上一次读取的状态。 */
  readonly status: StatsStatus;
  /** 手动重读一次（面板挂载时 `index.ts` 已经自动读过一次）。 */
  readonly refresh: () => void;
  /** 清零；成功后会把状态刷成空快照。 */
  readonly reset: () => Promise<WriteOutcome>;
}

/**
 * 效率统计的订阅源：`index.ts` 的 `statsStore` 经宿主 renderer 变成
 * `useStatsStore` prop（`hooks.statsStore` → `use${首字母大写}${其余}`）。
 *
 * 只带一个 `revision`：面板要的是「有新数据了，重渲染一次」这个信号，
 * 数字本身仍从 `props.stats` 读。`index.ts` 缓存了对象，引用只在版本真变时换。
 */
export interface StatsStoreView {
  /** 单调递增的变更序号：变了就说明有新的读取结果。 */
  readonly revision: number;
}

/** 宿主 renderer 注入的 `useStatsStore`：与 `useSnapshot` 同一套 selector 约定。 */
export type UseStatsStore = (selector: (view: StatsStoreView) => StatsStoreView) => StatsStoreView;

/** 模块级恒等 selector：同 `IDENTITY`，每次渲染新建会让 hook 每帧重算。 */
const STATS_IDENTITY = (view: StatsStoreView): StatsStoreView => view;

/** 宿主没注入订阅源时的兜底：revision 恒为 0，即「从不更新」。 */
const STATS_STANDING_STILL: StatsStoreView = { revision: 0 };
const useStatsStandingStill: UseStatsStore = (selector) => selector(STATS_STANDING_STILL);

/** 面板从宿主快照里读到的形状（`ConfigFormSnapshot` 的可用子集）。 */
export interface PanelSnapshot {
  /** `loading` 表示还没读到第一份；`unavailable` 表示这个客户端看不到该命名空间。 */
  readonly status: 'loading' | 'ready' | 'unavailable';
  /** 最终生效值（含 env 插值与代码默认）。 */
  readonly value?: unknown;
  /** 组合层。 */
  readonly base?: unknown;
  /** 用户补丁层；键在这里出现就代表被用户覆盖过。 */
  readonly user?: unknown;
  /** 宿主给的单调 revision；写回时作乐观锁。 */
  readonly revision?: number | undefined;
  /** 这份配置是否可写。 */
  readonly writable: boolean;
}

/**
 * 宿主 renderer 注入的 `useSnapshot`。
 *
 * 形参是 `useSyncExternalStoreWithSelector` 的 selector；我们只选整体，
 * 因为 `getSnapshot()` 返回的引用本身是稳定的（store 只在变更时换对象），
 * 不需要自定义相等函数。
 */
export type UsePanelSnapshot = (selector: (snapshot: PanelSnapshot) => PanelSnapshot) => PanelSnapshot;

/** 一次写操作的结果，直接当提示文案用。 */
export interface WriteOutcome {
  /** 宿主是否接受。 */
  readonly ok: boolean;
  /** 给用户看的一句话。 */
  readonly message: string;
}

/** 注册项注入到面板上的全部 props。 */
export interface PonytailPanelProps {
  /** 读配置快照的 hook。 */
  readonly useSnapshot: UsePanelSnapshot;
  /** 写 `defaultMode`；`mode` 已由 `coerceMode` 校验过。 */
  readonly writeMode: (mode: RuntimeMode) => Promise<WriteOutcome>;
  /** 清掉用户层的 `defaultMode`，回到继承值。 */
  readonly resetMode: () => Promise<WriteOutcome>;
  /** 效率统计的读接口（04 定的 connection.rpc 通道）。 */
  readonly stats: StatsPanelPort;
  /**
   * 效率统计的订阅 hook。
   *
   * 可选：宿主 renderer 只在 `hooks` 里有 `statsStore` 时才注入它，
   * 原型 harness 与老宿主没有，这时面板退回「只读 `props.stats`」的
   * 老样子——数字不会自己动，但点「刷新」仍然有效。
   */
  readonly useStatsStore?: UseStatsStore | undefined;
  /**
   * 打开配置文件（票 06）。
   *
   * 可选：宿主没有右侧边栏、或当前不在会话里时 `index.ts` 不传，
   * 卡头就不出现这个按钮——不留死按钮。
   */
  readonly openConfigFile?: (() => ConfigOpenResult) | undefined;
}

/** 四个档位在面板上的展示名。 */
const MODE_TEXT: Readonly<Record<RuntimeMode, string>> = {
  off: 'off · 关闭',
  lite: 'lite · 最轻',
  full: 'full · 默认',
  ultra: 'ultra · 最狠',
};

/**
 * 四段各自的悬停短说明：一句讲性格，不复述完整对照（完整口径见 `/ponytail-help`）。
 * 四档完整说明见 {@link MODE_HELP}。
 */
const MODE_TITLE: Readonly<Record<RuntimeMode, string>> = {
  off: '待命：不注入，需要时手写 /ponytail 打开',
  lite: '只说更小的那个选项，不动手',
  full: '默认：最小完整改动 + 一条检查 + 风险说明',
  ultra: '还要质疑需求，动手前先反驳',
};

/**
 * 窄栏只留英文档名：四个「off · 关闭」在 320px 会被挤成两行，档名本身够认，
 * 中文释义还在 `title` 与 `?` 的四档对照里。
 */
function modeOptions(compact: boolean): readonly { value: RuntimeMode; label: string; title: string }[] {
  return RUNTIME_MODES.map((mode) => ({ value: mode, label: compact ? mode : MODE_TEXT[mode], title: MODE_TITLE[mode] }));
}

/** `?` 悬浮卡里的四档完整对照：一行一档，文案取自 `/ponytail-help`。 */
const MODE_HELP: Readonly<Record<RuntimeMode, string>> = {
  off: '不在会话开始时自动生效，需要时手写 /ponytail 打开。',
  lite: '按要求做，用一行说明更小的那个选项。',
  full: '最小的完整改动、逻辑需要时的一条检查、以及说明跳过了什么与风险的回复。默认。',
  ultra: '还要质疑需求，动手前先反驳。',
};

/** 状态行里的覆盖关系：面板只认 env / patch，其余另判。 */
const OVERRIDE_TEXT: Readonly<Partial<Record<DiagnosisLevel, string>>> = {
  env: '被环境变量覆盖',
  patch: '被配置文件覆盖',
};

/** 补丁行命中、但注脚说自己来自组合层时，状态行要写的那句话。 */
const OVERRIDE_FROM_PROFILE = '来自 Profile 组合层';

/**
 * 状态行第三段该写什么。
 *
 * `overriddenBy` 只回答「谁盖住了用户层」，`null` 同时涵盖「谁都没写」与
 * 「组合层给了值」两种情况，直接写「无覆盖」会在后一种上撒谎。组合层这件事
 * 只有补丁行自己知道（`state === 'hit'` 且注脚是组合层那句），所以在这里补判。
 * @param diagnosis - `diagnose()` 的结论。
 * @returns 覆盖关系的人话。
 */
function overrideText(diagnosis: Diagnosis): string {
  const claimed = OVERRIDE_TEXT[diagnosis.overriddenBy ?? 'fallback'];
  if (claimed !== undefined) return claimed;
  const patchRow = diagnosis.rows.find((row) => row.level === 'patch');
  if (patchRow !== undefined && patchRow.state === 'hit' && patchRow.note === DIAGNOSIS_PATCH_FROM_PROFILE) {
    return OVERRIDE_FROM_PROFILE;
  }
  return '无覆盖';
}

/** 面板标题：设置页左侧导航条目只留品牌名，版本后缀不上标题。 */
const TITLE = 'Ponytail';

/** 三层各自的出处：卡面不写，只进诊断卡的 `?`——用户排查时要的是「去哪看」。 */
const DIAGNOSIS_LOCATION: Readonly<Record<DiagnosisLevel, string>> = {
  env: DIAGNOSIS_ENV_NAME,
  patch: DIAGNOSIS_PATCH_LOCATION,
  fallback: DIAGNOSIS_FALLBACK_LOCATION,
};

/** 标题下的定位说明：告诉读者这是排查用面板，不写产品介绍。 */
const TAGLINE = '给开发者看的调试面板：改哪个档位、值被谁盖住、省下多少轮次，都摊在同一页里。';

/**
 * 紧凑模式的判定宽度（面板自身宽度，不是视口宽度）。
 * 设置页会被塞进侧栏与分屏，视口宽不代表面板宽，所以量根节点。
 */
const COMPACT_MAX_WIDTH = 480;

/** `ResizeObserver` 的最小形状：只声明用到的一个方法，免得多一个 DOM 类型依赖。 */
interface WidthObserver {
  observe(target: Element): void;
  disconnect(): void;
}

/** 构造 ResizeObserver 的那个全局只声明构造签名。 */
interface WidthObserverCtor {
  new (callback: () => void): WidthObserver;
}

/**
 * 量某个元素自己的宽度，返回是否该进紧凑模式。
 *
 * 拿不到 `ResizeObserver`（老浏览器、测试桩）时恒为 false——降级成宽栏，
 * 宁可宽一点也不要挂。回调用 rAF 合并：ResizeObserver 自己已经批处理过，
 * 再合并一层是防同步 setState 引发的 `ResizeObserver loop` 警告。
 * @returns 根节点的 ref 与紧凑布尔值。
 */
function useCompactWidth(): { readonly ref: RefObject<HTMLDivElement>; readonly compact: boolean } {
  const ref = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const element = ref.current;
    const Ctor = (globalThis as { ResizeObserver?: WidthObserverCtor }).ResizeObserver;
    if (element === null || Ctor === undefined) return;
    let frame = 0;
    const apply = (width: number): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setCompact(width < COMPACT_MAX_WIDTH));
    };
    apply(element.getBoundingClientRect().width);
    const observer = new Ctor(() => apply(element.getBoundingClientRect().width));
    observer.observe(element);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);
  return { ref, compact };
}

/**
 * `useSyncExternalStoreWithSelector` 的恒等 selector。
 *
 * 必须是模块级常量：每次渲染新建一个箭头函数会让 hook 每帧都认为选择器变了。
 * 恒等 selector 不改变引用，配合 `Object.is` 的默认相等函数就能只在快照真变时重渲染。
 */
const IDENTITY = (snapshot: PanelSnapshot): PanelSnapshot => snapshot;



/** 卡片壳的视觉参数：三张卡共用这一份，改这里就是三张一起改。 */
const CARD_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  padding: 12,
  minWidth: 0,
  background: 'var(--dsw-alias-bg-layer-2)',
  border: '0.5px solid var(--dsw-alias-border-l3)',
  borderRadius: 'var(--dsw-radius-md)',
};

/** 卡片头的右端：紧凑模式下换行，宽栏下与标题同一行。 */
const CARD_HEAD_ACTION: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' };

/**
 * 一张设置卡片：卡头（左小标题、右动作位）+ 正文。
 *
 * 后续三张票只换 `children` 与 `action`，不碰壳——底色、边框、圆角、内边距
 * 都锁在 `CARD_STYLE` 里，三张卡出现第二种样子就说明有人绕过了这个组件。
 * `compact` 由面板根节点量一次宽度后统一传下来，卡片自己不测宽。
 * @param props - 小标题、正文、卡头右侧的动作位、是否紧凑。
 * @returns 卡片节点。
 */
function Card(props: {
  readonly title: ReactNode;
  readonly action?: ReactNode;
  readonly compact?: boolean;
  readonly children: ReactNode;
}): ReactNode {
  const compact = props.compact === true;
  return (
    <section style={CARD_STYLE}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          flexWrap: compact ? 'wrap' : 'nowrap',
        }}
      >
        <h3
          style={{
            margin: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 14,
            lineHeight: '22px',
            fontWeight: 600,
            color: 'var(--dsw-alias-label-primary)',
          }}
        >
          {props.title}
        </h3>
        {props.action === undefined ? null : <div style={CARD_HEAD_ACTION}>{props.action}</div>}
      </header>
      {props.children}
    </section>
  );
}

/** 标题旁的 `?`：文本节点画的圆钮，宽度跟内容走（不进卡头动作位）。 */
const HELP_TRIGGER: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  boxSizing: 'border-box',
  width: 18,
  height: 18,
  padding: 0,
  fontSize: 11,
  lineHeight: '16px',
  cursor: 'help',
};

/**
 * 卡里任何一个 `?`：18px 圆钮 + 悬浮卡，宽度跟内容走。
 *
 * 卡面上不允许再有说明文字，每一句原话都必须落进某个 `?`——所有入口走这
 * 一个组件，就不会出现「这里挂了悬停、那里挂了 title」的第二套说法。
 * @param props - 读屏标签与悬浮卡正文。
 * @returns 圆钮。
 */
function HelpBubble(props: { readonly label: string; readonly children: ReactNode }): ReactNode {
  return (
    <HoverCard
      inline
      openDelayMs={200}
      anchor={
        <button type="button" aria-label={props.label} style={HELP_TRIGGER}>
          ?
        </button>
      }
      content={<span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{props.children}</span>}
    />
  );
}

/** 悬停卡里的一行：小字、可换行，`?` 内是正文不是装饰。 */
const HELP_LINE: CSSProperties = { fontSize: 11, lineHeight: '17px', color: 'var(--dsw-alias-label-secondary)' };

/** 状态行里的一项：等宽、可换行但不撑破卡片。 */
const STATUS_FACT: CSSProperties = { fontFamily: 'var(--dsw-font-mono)', minWidth: 0, overflowWrap: 'anywhere' };

/**
 * 档位卡（票 02）：分段单选 + 标题旁 `?` 完整对照 + 单行状态行 + 卡头右侧清除按钮。
 *
 * 分段控件保留 id 与写语义；`?` 跟标题同一行，挂在 `Card.title` 里（`title` 收 `ReactNode`），
 * 不占卡头唯一的动作位——那个位置留给清除按钮。
 * @param props - 快照、诊断结论、紧凑模式、忙碌态与两个写回调。
 * @returns 档位卡节点。
 */
function ModeCard(props: {
  readonly snapshot: PanelSnapshot;
  readonly diagnosis: Diagnosis;
  readonly compact: boolean;
  readonly busy: boolean;
  readonly writeMode: (mode: RuntimeMode) => Promise<WriteOutcome>;
  readonly resetMode: () => Promise<WriteOutcome>;
}): ReactNode {
  const { snapshot, diagnosis, compact, busy } = props;
  const [feedback, setFeedback] = useState<WriteOutcome | null>(null);

  /* 写回执的包装，行为与原 `run()` 逐字一致：失败也进 feedback，不抛。 */
  const run = async (operation: () => Promise<WriteOutcome>): Promise<void> => {
    try {
      setFeedback(await operation());
    } catch (error) {
      setFeedback({ ok: false, message: '写操作抛错：' + String(error) });
    }
  };

  const reset = (
    <Button
      variant="outline"
      size="sm"
      disabled={busy || !snapshot.writable || snapshot.user === undefined}
      onClick={() => {
        void run(props.resetMode);
      }}
    >
      清除用户层覆盖
    </Button>
  );

  const title = (
    <>
      档位
      <HelpBubble label="四档完整说明">
        <strong style={{ fontSize: 12, lineHeight: '18px' }}>四档对照</strong>
        {RUNTIME_MODES.map((mode) => (
          <span key={mode} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <strong style={{ fontSize: 11, lineHeight: '17px' }}>{MODE_TEXT[mode]}</strong>
            <span style={HELP_LINE}>{MODE_HELP[mode]}</span>
          </span>
        ))}
      </HelpBubble>
    </>
  );

  return (
    <Card title={title} action={reset} compact={compact}>
      <SegmentedControl
        id="ponytail-58fly-mode"
        label="Ponytail 档位"
        value={diagnosis.effective}
        disabled={busy || !snapshot.writable}
        options={modeOptions(compact)}
        onChange={(next) => {
          void run(() => props.writeMode(next));
        }}
      />

      <div
        style={{
          display: 'flex',
          gap: 6,
          alignItems: 'baseline',
          flexWrap: compact ? 'wrap' : 'nowrap',
          minWidth: 0,
          fontSize: 12,
          lineHeight: '18px',
          color: 'var(--dsw-alias-label-secondary)',
        }}
      >
        <span style={STATUS_FACT}>{diagnosis.effective}</span>
        <span>｜</span>
        <span style={STATUS_FACT}>{snapshot.revision === undefined ? 'revision 未知' : 'revision ' + String(snapshot.revision)}</span>
        <span>｜</span>
        <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{overrideText(diagnosis)}</span>
        {snapshot.writable ? null : <span>｜ 配置只读</span>}
      </div>

      {feedback === null ? null : (
        <p style={{ margin: 0, display: 'flex', gap: 8, alignItems: 'center', minWidth: 0, flexWrap: 'wrap' }}>
          <Tag tone={feedback.ok ? 'success' : 'danger'}>{feedback.ok ? '已写入' : '未写入'}</Tag>
          <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{feedback.message}</span>
        </p>
      )}
    </Card>
  );
}

/**
 * 诊断卡卡头唯一动作（票 06）：把配置文件开成右侧文档预览。
 *
 * **为什么只给「打开」、不给「复制路径」**：`cordis.patch.yml` 的绝对位置由
 * 宿主决定（`DSH_HOME` 或 profile 目录下），客户端拿不到，服务端也没读过它——
 * 复制一段猜出来的路径比没有按钮更糟。
 *
 * 补丁文件可能还不存在、当前也可能没有会话，所以 `open` 返回结果，按钮把
 * 结果翻成一句话贴在下面：点了没反应是最糟的反馈。
 * @param props - 打开回调。
 * @returns 按钮与回执。
 */
function ConfigFileAction(props: { readonly open: () => ConfigOpenResult }): ReactNode {
  const [note, setNote] = useState<string | null>(null);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, minWidth: 0 }}>
      <Button variant="outline" size="sm" onClick={() => setNote(openNote(props.open()))}>
        打开配置文件
      </Button>
      {note === null ? null : (
        <span style={{ fontSize: 11, lineHeight: '17px', color: 'var(--dsw-alias-label-tertiary)' }}>{note}</span>
      )}
    </div>
  );
}

/** 打开结果的人话：三种结局各说各的原因，别让读者自己猜。 */
function openNote(result: ConfigOpenResult): string {
  if (result === 'opened') return '已在右侧边栏打开。';
  if (result === 'missing') return '补丁文件还没生成：先在面板里存一次档位。';
  return '当前没有打开的会话，右侧边栏无处可放。';
}

/** 横向几何来自原型（规格 §渲染契约）：常规 32px 槽、行高 40；紧凑 12px 槽、行高 46。 */
const PIPE_LANE = 32;
const PIPE_LANE_COMPACT = 12;
const PIPE_ROW = 40;
const PIPE_ROW_COMPACT = 46;

/** 一层一行：宽栏 40px 高，管道 SVG 与行同高，点正好落在行中线。 */
const LEVEL_ROW: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: `${String(PIPE_LANE)}px minmax(0, 1fr)`,
  alignItems: 'center',
  columnGap: 10,
  minHeight: PIPE_ROW,
  minWidth: 0,
};

/** 层名：小一号的说明字，不抢值的注意力。 */
const LEVEL_NAME: CSSProperties = {
  fontSize: 12,
  lineHeight: '16px',
  color: 'var(--dsw-alias-label-secondary)',
};

/** 命中层的值：600 22px 等宽，这一页最大的字，答案永远看得见。 */
const HIT_VALUE: CSSProperties = {
  fontFamily: 'var(--dsw-font-mono)',
  fontWeight: 600,
  fontSize: 22,
  lineHeight: '26px',
  color: 'var(--dsw-alias-label-primary)',
  overflowWrap: 'anywhere',
};

/** 紧凑宽度下命中值降到 19px，否则 32px 的层名一格放不下。 */
const HIT_VALUE_COMPACT: CSSProperties = { ...HIT_VALUE, fontSize: 19, lineHeight: '24px' };

/** 没赢的层的值：与小一号说明字同高，读者扫一眼就知道不是答案。 */
const DIM_VALUE: CSSProperties = {
  fontFamily: 'var(--dsw-font-mono)',
  fontSize: 12,
  lineHeight: '16px',
  color: 'var(--dsw-alias-label-tertiary)',
  overflowWrap: 'anywhere',
};

/** 非法值：说清楚「写了但不认」——危险色加粗，不划掉（值本身是用户写的，不该判死）。 */
const INVALID_VALUE: CSSProperties = {
  ...DIM_VALUE,
  color: 'var(--dsw-alias-state-danger-primary)',
  fontWeight: 600,
};

/**
 * 一层的值怎么画。
 *
 * 只按归因状态分支，不看层名——三层用同一套规矩，读者学一次就够。
 * `past` 与 `unknown` 也走 `DIM_VALUE`：前者整行淡出，后者本身就是个 `?`。
 */
function levelValue(level: AttributionLevel, compact: boolean): ReactNode {
  // 不可观测写 `?`：浏览器读不到宿主的环境变量，这一层根本没有值可言。
  const text = level.state === 'unknown' ? '?' : level.value ?? '—';
  if (level.state === 'hit') return <span style={compact ? HIT_VALUE_COMPACT : HIT_VALUE}>{text}</span>;
  if (level.state === 'invalid') return <span style={INVALID_VALUE}>{text}</span>;
  return <span style={DIM_VALUE}>{text}</span>;
}

/** 一层的整行透明度：没轮到的层整段淡出，不再区分有值没值。 */
function levelOpacity(state: AttributionState): number {
  if (state === 'hit') return 1;
  if (state === 'past') return 0.32;
  return 1;
}

/**
 * 管道的一段竖线。
 *
 * 五种状态对应五种画法，全部由这一个函数决定——这是「图例」被删掉之后
 * 唯一还带着含义的地方，改这里等于改全部。
 * @param props - 这一段属于哪一层、该层状态、是否紧凑。
 * @returns 一段 32×40（紧凑 12×46）的 SVG。
 */
function PipeSegment(props: { readonly state: AttributionState; readonly compact: boolean }): ReactNode {
  const { state, compact } = props;
  const lane = compact ? PIPE_LANE_COMPACT : PIPE_LANE;
  const row = compact ? PIPE_ROW_COMPACT : PIPE_ROW;
  const cx = lane / 2;
  const mid = row / 2;
  const r = compact ? 5 : 7;
  const accent = 'var(--dsw-alias-label-secondary)';
  const faint = 'var(--dsw-alias-border-l3)';
  const danger = 'var(--dsw-alias-state-danger-primary)';

  // 线上半段与下半段分开画：非法层要在中间留一个缺口，缺口就是「断开」。
  const line = (y1: number, y2: number, stroke: string, dash?: string): ReactNode => (
    <line x1={cx} y1={y1} x2={cx} y2={y2} stroke={stroke} strokeWidth={1.5} strokeDasharray={dash} />
  );

  return (
    <svg width={lane} height={row} viewBox={`0 0 ${String(lane)} ${String(row)}`} aria-hidden="true" focusable="false">
      {state === 'invalid' ? (
        <>
          {line(0, mid - r - 2, danger)}
          {line(mid + r + 2, row, danger)}
        </>
      ) : (
        line(0, row, state === 'past' ? faint : accent, state === 'unknown' ? '2 3' : undefined)
      )}
      {state === 'hit' ? <circle cx={cx} cy={mid} r={r} fill={accent} /> : null}
      {state === 'miss' ? <circle cx={cx} cy={mid} r={r - 1.5} fill="none" stroke={accent} strokeWidth={1.5} strokeDasharray="2 2" /> : null}
      {state === 'unknown' ? (
        <text x={cx} y={mid + 4} textAnchor="middle" fontSize={11} fill={accent}>
          ?
        </text>
      ) : null}
      {state === 'past' ? <circle cx={cx} cy={mid} r={2.5} fill={faint} /> : null}
    </svg>
  );
}

/**
 * 无障碍描述：取值顺序 + 每次层的结局 + 答案落在哪，卡面上一个字都不写。
 *
 * 三层各自的状态必须念出来：`role="group"` 里的文字能被读屏读到，但「写了
 * 却没赢」这件事只有图形在表达，不给它一句话，看不见图的人就少了这张卡唯一
 * 独有的信息。
 */
function pipeLabel(attribution: Attribution): string {
  const order = attribution.levels.map((level) => level.label).join(' → ');
  const story = attribution.levels
    .map((level) => {
      if (level.state === 'hit') return `${level.label}写 ${String(level.value)}，生效`;
      if (level.state === 'miss') return `${level.label}写 ${String(level.value)}，没赢`;
      if (level.state === 'invalid') return `${level.label}写 ${String(level.value)}，不是有效档位`;
      if (level.state === 'unknown') return `${level.label}不可观测`;
      // 门到 `past` 只剩「兜底层的值没被采用」，它明明有值，说「没写」是错的。
      return `${level.label}没轮到`;
    })
    .join('；');
  return `取值顺序${order}。${story}。当前生效 ${attribution.effective}。`;
}

/**
 * 诊断卡（票 01）：三层竖下来的管道，命中处就是答案。
 *
 * 卡面上只有层名与值，没有规则句、没有图例、没有列标题——三层自上而下
 * 本身就是取值顺序，实心点本身就说明「停在这里了」。规则与五态的完整说法
 * 由 `aria-label` 承载，需要读文字的人向读屏要，需要看图的人看管道。
 * @param props - 诊断结论与是否紧凑。
 * @returns 诊断卡节点。
 */
function DiagnosisCard(props: {
  readonly diagnosis: Diagnosis;
  readonly compact: boolean;
  readonly openConfigFile?: (() => ConfigOpenResult) | undefined;
}): ReactNode {
  const { diagnosis, compact, openConfigFile } = props;
  const attribution = attribute(diagnosis);
  const title = (
    <>
      优先级诊断链
      <HelpBubble label="诊断链怎么读">
        <strong style={{ fontSize: 12, lineHeight: '18px' }}>怎么读这条链</strong>
        <span style={HELP_LINE}>自上而下就是取值顺序，先命中的赢：环境变量 → 配置文件 → 内置默认值。</span>
        {attribution.levels.map((level) => (
          <span key={level.level} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <strong style={{ fontSize: 11, lineHeight: '17px' }}>{level.label}去哪看</strong>
            <span style={{ ...HELP_LINE, fontFamily: 'var(--dsw-font-mono)', overflowWrap: 'anywhere' }}>
              {DIAGNOSIS_LOCATION[level.level]}
            </span>
          </span>
        ))}
        <strong style={{ fontSize: 12, lineHeight: '18px', marginTop: 4 }}>图形</strong>
        <span style={HELP_LINE}>实心圆：写在这里，就是它生效。</span>
        <span style={HELP_LINE}>虚线空心圆：写了，但被上面那层盖住。</span>
        <span style={HELP_LINE}>淡出小点：上一层的值已经定了，没轮到它。</span>
        <span style={HELP_LINE}>红色断口：写的不是有效档位，已忽略。</span>
        <span style={HELP_LINE}>虚线加 ?：读不到，无法判断。</span>
        <span style={HELP_LINE}>
          浏览器里看不到宿主的环境变量，所以这一层永远是 ?。它没写值不代表它没生效：生效值既不等于配置值也不等于默认值时，只能是它在横。
        </span>
      </HelpBubble>
    </>
  );
  return (
    <Card title={title} action={openConfigFile === undefined ? null : <ConfigFileAction open={openConfigFile} />} compact={compact}>
      {/*
        用 group 而不是 img 这个角色：它会把子树整体从无障碍树里
        换掉，层名与值就读不到了，而「配置文件写了 lite 没赢」正是这张卡最想
        说的那句话。每层自己带一句 aria-label，读屏逐层念出来。
      */}
      <div role="group" aria-label={pipeLabel(attribution)} style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {attribution.levels.map((level) => (
          <div
            key={level.level}
            style={{
              ...LEVEL_ROW,
              gridTemplateColumns: `${String(compact ? PIPE_LANE_COMPACT : PIPE_LANE)}px minmax(0, 1fr)`,
              opacity: levelOpacity(level.state),
            }}
          >
            <PipeSegment state={level.state} compact={compact} />
            {compact ? (
              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span style={LEVEL_NAME}>{level.label}</span>
                {levelValue(level, compact)}
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, minWidth: 0 }}>
                <span style={LEVEL_NAME}>{level.label}</span>
                {levelValue(level, compact)}
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

/**
 * 渲染设置页里的 Ponytail 面板。
 * @param props - 宿主注入的 hook 与两个写回调。
 * @returns 面板节点。
 */
export function PonytailPanel(props: PonytailPanelProps): ReactNode {
  const snapshot = props.useSnapshot(IDENTITY);
  /**
   * 订阅效率统计：这里不取返回值，只要它一变，本组件就重渲染一次，
   * 下面的 `EfficiencySection` 便会重读 `props.stats.snapshot` 拿到新数字。
   * 数字本身仍以 `props.stats` 为唯一真相，定时拉取在 `index.ts` 里。
   */
  (props.useStatsStore ?? useStatsStandingStill)(STATS_IDENTITY);
  const [busy, setBusy] = useState(false);

  const diagnosis = diagnose({ value: snapshot.value, base: snapshot.base, user: snapshot.user });
  const ready = snapshot.status === 'ready';

  /* busy 只在这里收口：两个写回调都走这一层，卡片只负责显示回执。 */
  const write = async (operation: () => Promise<WriteOutcome>): Promise<WriteOutcome> => {
    setBusy(true);
    try {
      return await operation();
    } finally {
      setBusy(false);
    }
  };

  const { ref, compact } = useCompactWidth();

  return (
    <div
      ref={ref}
      className="dsh-ponytail-panel"
      style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}
    >
      <header style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h2 style={{ margin: 0 }}>{TITLE}</h2>
        <p style={{ margin: 0, fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)' }}>{TAGLINE}</p>
      </header>

      {snapshot.status === 'loading' ? <p style={{ margin: 0 }}>正在读取配置…</p> : null}

      {snapshot.status === 'unavailable' ? (
        <p style={{ margin: 0 }}>
          当前部署没有把该插件的配置面暴露给这个客户端。档位仍然可以改：用
          <code> /ponytail &lt;档位&gt;</code> 命令，或直接编辑 <code>cordis.patch.yml</code> 里的
          <code> ponytail-58fly.config.defaultMode</code>。
        </p>
      ) : null}

      {ready ? (
        <ModeCard
          snapshot={snapshot}
          diagnosis={diagnosis}
          compact={compact}
          busy={busy}
          writeMode={(mode) => write(() => props.writeMode(mode))}
          resetMode={() => write(props.resetMode)}
        />
      ) : null}

      <DiagnosisCard
        diagnosis={diagnosis}
        compact={compact}
        openConfigFile={props.openConfigFile}
      />

      <EfficiencySection port={props.stats} compact={compact} />
    </div>
  );
}

/** 效率区块仅剩的三句话：三态两句话 + 清零回执。其余口径文案全部收进 `?`（票 03）。 */
const STATS_TEXT = {
  loading: '正在读取统计…',
  unreadable: '统计暂时读不到（宿主没提供这个通道，或插件刚重启）。',
  resetting: '正在清零…',
  resetDone: '已清零，从 0 重新计数。',
  empty: '还没有非 off 档位的轮次，所以没有可推算的量。',
  /** 卡底唯一保留的一行：基准的限定语，不许省。 */
  baselineCaveat: '上游基准，非本机测量',
};

/** 千分位。 */
function group(value: number): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 字节数的人类可读近似值，与命令层同一口径。 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return String(Math.round(bytes)) + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

/** `HH:MM`，只用于「数据截至」。 */
function clockOf(epochMs: number): string {
  const date = new Date(epochMs);
  return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
}

/** 卡头 `⋯` 菜单锚点：比 `?` 宽一档，两个点加省略号才不挤。 */
const MENU_TRIGGER: CSSProperties = {
  ...HELP_TRIGGER,
  width: 22,
  cursor: 'pointer',
  color: 'var(--dsw-alias-label-secondary)',
};

/** 主数字：这一页最大的字，受管轮次就是这张卡的主语。 */
const PRIMARY_NUMBER: CSSProperties = {
  fontFamily: 'var(--dsw-font-mono)',
  fontWeight: 600,
  fontSize: 30,
  lineHeight: '34px',
  color: 'var(--dsw-alias-label-primary)',
  fontVariantNumeric: 'tabular-nums',
};

/** 主数字在紧凑宽度下只缩一点点：它是这张卡的锚，缩狠了就失去「主」的意思。 */
const PRIMARY_NUMBER_COMPACT: CSSProperties = { ...PRIMARY_NUMBER, fontSize: 26, lineHeight: '30px' };

/** 图形下的 mono 小字：图例、杂项、行名共用同一套。 */
const MONO_LINE: CSSProperties = {
  fontFamily: 'var(--dsw-font-mono)',
  fontSize: 11,
  lineHeight: '17px',
  color: 'var(--dsw-alias-label-tertiary)',
  fontVariantNumeric: 'tabular-nums',
};

/** 四档堆叠条：细长一条，段与段之间不留缝（无缝才读得出「一整份轮次被切开」）。 */
const STACK_TRACK: CSSProperties = {
  display: 'flex',
  width: '100%',
  height: 10,
  minWidth: 0,
  borderRadius: 'var(--dsw-radius-sm)',
  overflow: 'hidden',
  // 轨道底用更浅的一层，`off` 段才分得出来——两者都是灰，同色就等于没画。
  background: 'var(--dsw-alias-bg-layer-3)',
};

/** 区间条的每一行：行名固定 40px，三条共轴的关键。 */
const BAND_ROW: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
};

/** 区间条的横槽：条居中放在里面，比例位置由 inline 的 left/width 决定。 */
const BAND_TRACK: CSSProperties = {
  position: 'relative',
  flex: 1,
  minWidth: 0,
  height: 14,
};

/** 轴刻度：`−60%` 与 `0` 两端各一个，字号压到最小，不当正文读。 */
const AXIS_TICK: CSSProperties = {
  ...MONO_LINE,
  fontSize: 10,
  lineHeight: '14px',
};

/**
 * 把 `projectSavings` 的绝对值还原成比例。
 *
 * `projectSavings` 乘过基数（`activeTurns × tokensPerTurn`），这里除回去，
 * 才能说「约 -45%」；base 为 0 时三行根本不该画（见 `BASELINE_NO_ACTIVE`）。
 * @param estimate - 投影的一行。
 * @param base - 推算基数。
 * @returns 比例形式的中心值与区间。
 */
function ratioOf(estimate: Estimate, base: number): BaselineRow {
  const scale = (value: number | null): number | undefined =>
    value === null || base === 0 ? undefined : value / base;
  const from = scale(estimate.from);
  const to = scale(estimate.to);
  return {
    center: base === 0 ? 0 : estimate.center / base,
    range: from === undefined || to === undefined ? undefined : [from, to],
    source: estimate.source,
  };
}

/**
 * 四档堆叠条。
 *
 * 段的顺序、颜色深浅都固定：`off` 用边框灰（它不是 ponytail 管的），其余三档
 * 同一个业务色、透明度依次加深。图例那行 mono 小字就是这张图唯一的说明。
 * @param props - 每档轮次。
 * @returns 堆叠条 + 图例。
 */
function ModeStack(props: { readonly turns: Readonly<Record<RuntimeMode, number>> }): ReactNode {
  const slices = modeSlices(props.turns);
  const opacity: Readonly<Record<RuntimeMode, number>> = { off: 1, lite: 0.32, full: 0.62, ultra: 1 };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <div style={STACK_TRACK} role="img" aria-label={'档位分布：' + modeLegend(props.turns)}>
        {slices.length === 0 ? null : (
          slices
            .filter((slice) => slice.share > 0)
            .map((slice) => (
              <span
                key={slice.mode}
                style={{
                  // flex-basis 而不是 width：段是 flex 子项，`width` 在行内元素上不生效。
                  flex: '0 0 ' + String(slice.share) + '%',
                  height: '100%',
                  background:
                    slice.mode === 'off' ? 'var(--dsw-alias-border-l3)' : 'var(--dsw-alias-state-business-primary)',
                  opacity: slice.mode === 'off' ? 1 : opacity[slice.mode],
                }}
              />
            ))
        )}
      </div>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <span style={MONO_LINE}>{modeLegend(props.turns)}</span>
        <HelpBubble label="off 那段灰条是什么">
          <span style={HELP_LINE}>off 段是待命档位的轮次：不注入，需要时手写 /ponytail 打开。</span>
          <span style={HELP_LINE}>它不算进基准推算的基数，所以灰段越宽，下面三行覆盖的轮次占比越小。</span>
        </HelpBubble>
      </span>
    </div>
  );
}

/** 图例一行：`off 12 · lite 38 · full 71 · ultra 7`，同时充当堆叠条的读屏文字。 */
function modeLegend(turns: Readonly<Record<RuntimeMode, number>>): string {
  return RUNTIME_MODES.map((mode) => mode + ' ' + group(turns[mode])).join(' · ');
}

/**
 * 三行共轴区间条。
 *
 * 三行共用一条 `−60% … 0` 的轴，条形落在区间上、中心用小竖标线钉住。
 * 轴两端写死（`mini.ts` 的 `BAND_MIN/BAND_MAX`）：轴若跟着数据缩放，
 * 三行之间就没法比长短。
 * @param props - 投影、基数与是否紧凑。
 * @returns 三行条 + 一条轴刻度。
 */
function SavingsBands(props: { readonly projection: SavingsProjection; readonly base: number }): ReactNode {
  const rows: readonly BandRow[] = [
    bandRow('输出', ratioOf(props.projection.outputTokens, props.base).center, rangeOf(props.projection.outputTokens, props.base)),
    bandRow('成本', ratioOf(props.projection.cost, props.base).center, rangeOf(props.projection.cost, props.base)),
    bandRow('耗时', ratioOf(props.projection.time, props.base).center, rangeOf(props.projection.time, props.base)),
  ];
  const zero = axisPercent(0);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <div role="img" aria-label={'基准推算：' + rows.map(bandLabel).join('；')}>
        {rows.map((row) => (
          <div key={row.label} style={BAND_ROW}>
            <span style={{ ...MONO_LINE, width: 32, flex: '0 0 32px' }}>{row.label}</span>
            <div style={BAND_TRACK}>
              {row.band === null ? null : (
                <span
                  style={{
                    position: 'absolute',
                    top: 5,
                    height: 4,
                    left: String(row.band[0]) + '%',
                    width: String(row.band[1] - row.band[0]) + '%',
                    background: 'var(--dsw-alias-state-business-primary)',
                    opacity: 0.45,
                    borderRadius: 2,
                  }}
                />
              )}
              <span
                style={{
                  position: 'absolute',
                  top: 0,
                  height: 14,
                  left: String(row.center) + '%',
                  width: 2,
                  marginLeft: -1,
                  background: 'var(--dsw-alias-label-secondary)',
                }}
              />
            </div>
          </div>
        ))}
      </div>
      {/* 轴刻度压在条下面同一列：左端 −60%、右端 0，中间不画刻度线（三条共用一条轴，画线是噪音）。 */}
      <div style={{ ...BAND_ROW, alignItems: 'baseline' }}>
        <span style={{ width: 32, flex: '0 0 32px' }} />
        <div style={{ position: 'relative', flex: 1, minWidth: 0, height: 14 }}>
          <span style={{ ...AXIS_TICK, position: 'absolute', left: 0 }}>{String(BAND_MIN) + '%'}</span>
          <span style={{ ...AXIS_TICK, position: 'absolute', left: String(zero) + '%', marginLeft: -6 }}>
            {String(BAND_MAX) + '%'}
          </span>
        </div>
      </div>
    </div>
  );
}

/** 一行的区间，还原到比例域；缺区间时给 `null`。 */
function rangeOf(estimate: Estimate, base: number): readonly [number, number] | null {
  const line = ratioOf(estimate, base);
  return line.range === undefined ? null : [line.range[0], line.range[1]];
}

/** 区间条一行的读屏文字：`成本 -36% 到 -16%`。 */
function bandLabel(row: BandRow): string {
  if (row.band === null) return row.label + ' ' + axisText(row.center);
  return row.label + ' ' + axisText(row.band[0]) + ' 到 ' + axisText(row.band[1]);
}

/** 轴坐标还原成百分比文字，只给 aria 用。 */
function axisText(percent: number): string {
  return String(Math.round(BAND_MIN + (percent / 100) * (BAND_MAX - BAND_MIN))) + '%';
}

/**
 * 「效率统计」区块（票 04 建卡，票 02 改四块图形）。
 *
 * 四块自上而下：主数字 + 注入率环 → 四档堆叠条 + mono 图例 → 杂项一行 →
 * 三行共轴区间条。卡面只留图形与数字，口径文案由票 03 收进 `?`；卡底只剩
 * 基准的限定语一行。
 *
 * `清零统计` 挪进卡头 `⋯` 菜单，菜单内仍是二次确认（单击绝不生效）。
 * @param props - 读接口与是否紧凑。
 * @returns 区块节点。
 */
function EfficiencySection(props: { readonly port: StatsPanelPort; readonly compact: boolean }): ReactNode {
  const [resetting, setResetting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [resetFeedback, setResetFeedback] = useState<string | null>(null);

  const doReset = async (): Promise<void> => {
    setConfirming(false);
    setResetting(true);
    try {
      const outcome = await props.port.reset();
      setResetFeedback(outcome.ok ? STATS_TEXT.resetDone : outcome.message);
    } catch (error) {
      setResetFeedback('清零抛错：' + String(error));
    } finally {
      setResetting(false);
    }
  };

  const snapshot = props.port.snapshot;
  const compact = props.compact;

  /* 基线推算与命令层同源：同一份 `projectSavings`，同一个分母（票 04 缺口 A/B）。 */
  const projection = projectSavings(
    snapshot ?? { managedTurns: 0, turnsByMode: { off: 0, lite: 0, full: 0, ultra: 0 } },
  );
  const base = projection.activeTurns * projection.tokensPerTurn;

  /* 杂项一行：三个量、一句 mono 小字，各自不再占一行。 */
  const misc = [
    formatBytes(snapshot?.injectedBytes ?? 0),
    group(snapshot?.modeSwitches ?? 0) + ' 切档',
    group(snapshot?.commandCalls ?? 0) + ' 命令',
  ].join(' · ');

  /* 卡头右端：清零进 ⋯ 菜单（票 02），数据截至与刷新留在明面上。 */
  const action = (
    <>
      {snapshot === null || snapshot.lastAt === null ? null : (
        <span style={{ fontSize: 11, lineHeight: '17px', color: 'var(--dsw-alias-label-tertiary)' }}>
          {'数据截至 ' + clockOf(snapshot.lastAt)}
        </span>
      )}
      <Button variant="outline" size="sm" disabled={props.port.status === 'loading'} onClick={props.port.refresh}>
        刷新
      </Button>
      {/* 菜单锚点写在 Menu 的 anchor 里，菜单项只有一个「清零统计」——它必须再点一次「清零」才生效。 */}
      <Menu
        open={menuOpen}
        align="end"
        side="bottom"
        anchor={(
          <button
            type="button"
            aria-label="更多操作"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            style={MENU_TRIGGER}
            onClick={() => setMenuOpen((open) => !open)}
          >
            ⋯
          </button>
        )}
        items={[{ id: 'clear', label: resetting ? STATS_TEXT.resetting : '清零统计', disabled: resetting || confirming }]}
        onSelect={() => {
          setMenuOpen(false);
          setConfirming(true);
        }}
        onClose={() => setMenuOpen(false)}
      />
    </>
  );

  return (
    <Card title="效率统计" action={action} compact={compact}>
      {props.port.status === 'loading' && snapshot === null ? (
        <p style={{ margin: 0, ...MONO_LINE }}>{STATS_TEXT.loading}</p>
      ) : null}

      {props.port.status === 'error' ? (
        <p
          style={{
            margin: 0,
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            flexWrap: 'wrap',
            fontSize: 12,
            lineHeight: '18px',
            color: 'var(--dsw-alias-state-error-primary)',
          }}
        >
          <span>{STATS_TEXT.unreadable}</span>
          <Button variant="outline" size="sm" onClick={props.port.refresh}>
            重试
          </Button>
        </p>
      ) : null}

      {/* 二次确认：菜单项点过之后才出现，写在卡头下方一行，不弹模态。 */}
      {confirming ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 12, lineHeight: '18px' }}>清零本机统计？</strong>
          <span style={{ fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)' }}>
            受管轮次、注入次数、注入字节、切档次数和命令调用次数都会归零，无法撤销。配置和档位不受影响。
          </span>
          <Button variant="outline" size="sm" onClick={() => setConfirming(false)}>
            取消
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void doReset();
            }}
          >
            清零
          </Button>
        </div>
      ) : null}

      {resetFeedback === null ? null : (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Tag tone={resetFeedback === STATS_TEXT.resetDone ? 'success' : 'danger'}>
            {resetFeedback === STATS_TEXT.resetDone ? '已清零' : '未清零'}
          </Tag>
          <span style={{ fontSize: 12, lineHeight: '18px' }}>{resetFeedback}</span>
        </span>
      )}

      {snapshot === null ? null : (
        <>
          {/* ① 主数字 + 注入率环。空态时主数字仍是 0，不换成一句话——0 也是真的。 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', minWidth: 0 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={compact ? PRIMARY_NUMBER_COMPACT : PRIMARY_NUMBER}>{group(snapshot.managedTurns)}</span>
              <HelpBubble label="受管轮次怎么算">
                <span style={HELP_LINE}>每个经过 Ponytail pre-step 的轮次都算一次。</span>
              </HelpBubble>
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {/* 环里写比例，旁边写原始分母：比例好读，分母才是能复核的那个数。 */}
              <Ring value={snapshot.injections} total={snapshot.managedTurns} label="注入率" />
              <span style={MONO_LINE}>
                {group(snapshot.injections)} / {group(snapshot.managedTurns)}
              </span>
              <HelpBubble label="注入率怎么算">
                <span style={HELP_LINE}>注入次数 / 受管轮次。每轮拼进上下文的注入记一次，次数不是字节。</span>
                <span style={HELP_LINE}>环空着表示还没有注入：没有受管轮次，或一轮都没注入。</span>
              </HelpBubble>
            </span>
          </div>

          {/* ② 四档堆叠条 + 一行 mono 图例。 */}
          <ModeStack turns={snapshot.turnsByMode} />

          {/* ③ 杂项压成一行，口径挂在这行末尾的 `?` 上。 */}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={MONO_LINE}>{misc}</span>
            <HelpBubble label="这一行的三个量怎么算">
              <span style={HELP_LINE}>注入字节：注入文本的累计大小，与注入次数不是一回事。</span>
              <span style={HELP_LINE}>切档：本机运行期里档位被切换的次数。</span>
              <span style={HELP_LINE}>命令：本机运行期里 slash 命令被调用的次数。</span>
              <span style={HELP_LINE}>三个数都只算本机这一次运行，重启归零。</span>
            </HelpBubble>
          </span>

          {/* ④ 三行共轴区间条。 */}
          {projection.activeTurns === 0 ? (
            <span style={{ ...MONO_LINE, color: 'var(--dsw-alias-label-tertiary)' }}>{STATS_TEXT.empty}</span>
          ) : (
            <SavingsBands projection={projection} base={base} />
          )}
        </>
      )}

      {/* 卡底唯一一行：基准的限定语，出处与推算基数挂在它后面的 `?` 上。 */}
      {snapshot === null ? null : (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={MONO_LINE}>{STATS_TEXT.baselineCaveat}</span>
          <HelpBubble label="基准推算的依据">
            <span style={HELP_LINE}>{BASELINE_CAVEAT}</span>
            <span style={HELP_LINE}>{baselineBasis(projection.activeTurns, projection.tokensPerTurn)}</span>
            <a
              href={BASELINE.outputTokens.source}
              target="_blank"
              rel="noreferrer"
              style={{ ...HELP_LINE, color: 'var(--dsw-alias-link)' }}
            >
              上游方法论
            </a>
            <span style={HELP_LINE}>三行区间取自上游 39 个任务、每个 5 次、三臂对照的结论，不是这台机器上发生的事。</span>
          </HelpBubble>
        </span>
      )}
    </Card>
  );
}
