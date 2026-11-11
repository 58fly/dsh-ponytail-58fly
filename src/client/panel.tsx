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
import { Button, HoverCard, SegmentedControl, Tag } from '@deepseek-ai/dsh-client-ui-primitives';
import { RUNTIME_MODES, type RuntimeMode } from '../l0/mode.js';
import { DIAGNOSIS_PATCH_FROM_PROFILE, diagnose, type Diagnosis, type DiagnosisLevel } from '../l0/diagnosis.js';
import {
  BASELINE,
  BASELINE_NO_ACTIVE,
  baselineBasis,
  projectSavings,
  type BaselineRow,
  type Estimate,
  type SavingsProjection,
} from '../stats/baseline.js';
import type { StatsView } from '../stats/types.js';
import { attribute, type Attribution, type AttributionLevel, type AttributionState } from './attribution.js';
import { BarList, Ring } from './charts.js';

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
   * 打开 Profile 补丁（票 06）。
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
  patch: '被 Profile 补丁覆盖',
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
        <h3 style={{ margin: 0, fontSize: 14, lineHeight: '22px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)' }}>
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

/** 状态行里的一项：等宽、可换行但不撑破卡片。 */
const STATUS_FACT: CSSProperties = { fontFamily: 'var(--dsw-font-mono)', minWidth: 0, overflowWrap: 'anywhere' };

/** 表格的公共骨架：`fixed` 布局 + 不给 `minWidth`，长路径才不会把卡撑出横向滚动条。 */
const TABLE_STYLE: CSSProperties = { width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' };

/** 表头/单元格共用的排版：`minWidth: 0` 让固定布局真的压住内容。 */
const CELL_STYLE: CSSProperties = {
  padding: '4px 8px 4px 0',
  textAlign: 'left',
  verticalAlign: 'top',
  fontSize: 12,
  lineHeight: '18px',
  minWidth: 0,
  borderTop: '0.5px solid var(--dsw-alias-border-l3)',
  color: 'var(--dsw-alias-label-secondary)',
};

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
      <HoverCard
        inline
        openDelayMs={200}
        anchor={
          <button type="button" aria-label="四档完整说明" style={HELP_TRIGGER}>
            ?
          </button>
        }
        content={
          <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <strong style={{ fontSize: 12, lineHeight: '18px' }}>四档对照</strong>
            {RUNTIME_MODES.map((mode) => (
              <span
                key={mode}
                style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11, lineHeight: '17px' }}
              >
                <span style={{ fontWeight: 600 }}>{MODE_TEXT[mode]}</span>
                <span style={{ color: 'var(--dsw-alias-label-secondary)' }}>{MODE_HELP[mode]}</span>
              </span>
            ))}
          </span>
        }
      />
    </>
  );

  return (
    <Card title={title} action={reset} compact={compact}>
      <SegmentedControl
        id="ponytail-58fly-mode"
        label="Ponytail 档位"
        value={diagnosis.effective}
        disabled={busy || !snapshot.writable}
        options={RUNTIME_MODES.map((mode) => ({ value: mode, label: MODE_TEXT[mode], title: MODE_TITLE[mode] }))}
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
 * 诊断卡卡头唯一动作（票 06）：把 Profile 补丁开成右侧文档预览。
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
  return (
    <Card title="优先级诊断链" action={openConfigFile === undefined ? null : <ConfigFileAction open={openConfigFile} />} compact={compact}>
      {/*
        用 `role="group"` 而不是 `role="img"`：`img` 会把子树整体从无障碍树里
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

/** 效率区块的文案：全部来自 `docs/design/ponytail-efficiency-ui.md` §7，逐字照抄。 */
const STATS_TEXT = {
  loading: '正在读取统计…',
  emptyTitle: '本机运行期累计：还没开始计数',
  emptyBody: '发一条消息就会开始记：每个经过 Ponytail pre-step 的轮次都算一次。',
  unreadable: '统计暂时读不到（宿主没提供这个通道，或插件刚重启）。',
  resetting: '正在清零…',
  resetDone: '已清零，从 0 重新计数。',
  baselineTitle: '比没用 ponytail 的情况（基准推算）',
  baselineNote: '基线：上游 39 任务 × 5 次 × 三臂，Claude Code + Opus 5.5',
};

/** 四个档位在按档位分布里的标签（与命令同一套名字，不加中文后缀：宽度只有 36px）。 */
const BAR_LABEL: Readonly<Record<RuntimeMode, string>> = { off: 'off', lite: 'lite', full: 'full', ultra: 'ultra' };

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

/** 效率表格的数值列：等宽、右对齐，数字才能按位对上。 */
const EFF_VALUE_CELL: CSSProperties = {
  ...CELL_STYLE,
  width: '7em',
  fontFamily: 'var(--dsw-font-mono)',
  textAlign: 'right',
  whiteSpace: 'nowrap',
  color: 'var(--dsw-alias-label-primary)',
  fontVariantNumeric: 'tabular-nums',
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
 * 基准推算三行 + 出处 + 限定语。
 *
 * 只出 outputTokens / cost / time（§6）：行数、gzip 面积归因不到本机这些轮次，
 * 轮次与「多少任务更便宜」是基准自己的统计量。系数从 `baseline.ts` 读，
 * 这里只做乘与格式化——把裸系数写进 JSX 就等于在 UI 里立了第二份真相。
 * @returns 三行定值表 + 页脚。
 */
function BaselineRows(props: { readonly projection: SavingsProjection; readonly base: number }): ReactNode {
  const rows: readonly { readonly label: string; readonly line: BaselineRow }[] = [
    { label: '输出 token', line: ratioOf(props.projection.outputTokens, props.base) },
    { label: '成本', line: ratioOf(props.projection.cost, props.base) },
    { label: '耗时', line: ratioOf(props.projection.time, props.base) },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {rows.map((row) => {
        const span = row.line.range;
        const range =
          span === undefined ? '（无区间）' : '[' + String(Math.round(span[0] * 100)) + '%, ' + String(Math.round(span[1] * 100)) + '%]';
        return (
          <div key={row.label} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)', minWidth: 72 }}>
              {row.label}
            </span>
            <span
              style={{
                fontSize: 14,
                lineHeight: '22px',
                fontWeight: 500,
                color: 'var(--dsw-alias-label-primary)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {'约 ' + String(Math.round(row.line.center * 100)) + '%'}
            </span>
            <span
              style={{
                fontSize: 11,
                lineHeight: '17px',
                color: 'var(--dsw-alias-label-tertiary)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {range}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** 效率卡五个指标的说明文案：取自旧 `Metric` 的 hint，一字未改口径。 */
const EFFICIENCY_ROWS: readonly { readonly key: string; readonly label: string; readonly hint: string }[] = [
  { key: 'turns', label: '受管轮次', hint: '每个经过 Ponytail pre-step 的轮次都算一次' },
  { key: 'injections', label: '注入次数', hint: '每轮拼进上下文的注入，次数不是字节' },
  { key: 'bytes', label: '注入字节', hint: '注入文本的累计大小，与注入次数不是一回事' },
  { key: 'switches', label: '切档次数', hint: '本机运行期里档位被切换的次数' },
  { key: 'calls', label: '命令调用次数', hint: '本机运行期里 slash 命令被调用的次数' },
];

/** 基线提示块：二级底 + 左侧 2px 警告竖条 + 12px 内边距。 */
const CALLOUT_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: 12,
  minWidth: 0,
  background: 'var(--dsw-alias-bg-layer-2)',
  borderLeft: '2px solid var(--dsw-alias-state-warn-primary)',
  borderRadius: 'var(--dsw-radius-sm)',
};

/**
 * 「效率统计」区块（票 04；卡片壳与紧凑宽度见票 01）。
 *
 * 三种状态各有各的说法：空态是正常的（还没开始计数），读不到是异常的（通道没了），
 * 两者都用一句完整的话，不用感叹号也不用警告三角（§7）。
 *
 * 主体是「指标｜数值｜说明/图形」表格，只有五行指标；注入率与按档位分布的图
 * 是表格下方的「标签 + 图形」块（Ring 是 SVG、BarList 是 div，塞不进 tr/td）。
 * `compact` 只折叠说明列——说明文字改挂到整行的 `title` 上，悬停任意位置都能看到。
 * @param props - 读接口与是否紧凑。
 * @returns 区块节点。
 */
function EfficiencySection(props: { readonly port: StatsPanelPort; readonly compact: boolean }): ReactNode {
  const [resetting, setResetting] = useState(false);
  const [confirming, setConfirming] = useState(false);
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
  const empty = snapshot === null || snapshot.managedTurns === 0;
  const compact = props.compact;

  /* 指标行的数值：与旧 Metric 的数值同源，只换了排布。 */
  const values: Readonly<Record<string, string>> = {
    turns: group(snapshot?.managedTurns ?? 0),
    injections: group(snapshot?.injections ?? 0),
    bytes: formatBytes(snapshot?.injectedBytes ?? 0),
    switches: group(snapshot?.modeSwitches ?? 0),
    calls: group(snapshot?.commandCalls ?? 0),
  };

  /* 基线推算与命令层同源：同一份 `projectSavings`，同一个分母（票 04 缺口 A/B）。 */
  const projection = projectSavings(
    snapshot ?? { managedTurns: 0, turnsByMode: { off: 0, lite: 0, full: 0, ultra: 0 } },
  );
  const base = projection.activeTurns * projection.tokensPerTurn;

  /* 卡头右端：数据截至早于刷新按钮（顺序由票 03 定），紧凑时按同一组换行。 */
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
    </>
  );

  return (
    <Card title="效率统计" action={action} compact={compact}>
      {props.port.status === 'loading' && snapshot === null ? (
        <p style={{ margin: 0, fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)' }}>
          {STATS_TEXT.loading}
        </p>
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

      {snapshot === null ? null : (
        <>
          <table style={TABLE_STYLE}>
            <thead>
              <tr>
                <th style={{ ...CELL_STYLE, borderTop: 'none' }}>指标</th>
                <th style={{ ...EFF_VALUE_CELL, borderTop: 'none' }}>数值</th>
                <th style={{ ...CELL_STYLE, borderTop: 'none' }}>说明/图形</th>
              </tr>
            </thead>
            <tbody>
              {EFFICIENCY_ROWS.map((row) => (
                <tr key={row.key} title={compact ? row.hint : undefined}>
                  <td style={CELL_STYLE}>{row.label}</td>
                  <td style={EFF_VALUE_CELL}>{values[row.key]}</td>
                  {compact ? null : <td style={CELL_STYLE}>{row.hint}</td>}
                </tr>
              ))}
            </tbody>
          </table>

          {empty ? (
            <>
              <p style={{ margin: 0, fontSize: 14, lineHeight: '22px', fontWeight: 500, color: 'var(--dsw-alias-label-primary)' }}>
                {STATS_TEXT.emptyTitle}
              </p>
              <p style={{ margin: 0, fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)' }}>
                {STATS_TEXT.emptyBody}
              </p>
            </>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <Ring value={snapshot.injections} total={snapshot.managedTurns} label="注入率" />
                <span
                  title={compact ? '注入次数 / 受管轮次' : undefined}
                  style={{ display: 'inline-flex', flexDirection: 'column', gap: 2, minWidth: 0 }}
                >
                  <span style={{ fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)' }}>注入率</span>
                  <span style={{ fontFamily: 'var(--dsw-font-mono)', fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-primary)', fontVariantNumeric: 'tabular-nums' }}>
                    {group(snapshot.injections) + ' / ' + group(snapshot.managedTurns)}
                  </span>
                  {compact ? null : (
                    <span style={{ fontSize: 11, lineHeight: '17px', color: 'var(--dsw-alias-label-tertiary)' }}>
                      注入次数 / 受管轮次
                    </span>
                  )}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', minWidth: 0 }}>
                <span
                  title={compact ? '按档位分布（受管轮次）' : undefined}
                  style={{ flex: '0 0 72px', fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)' }}
                >
                  按档位分布
                </span>
                <BarList
                  label="按档位分布（受管轮次）"
                  rows={RUNTIME_MODES.map((mode) => ({ key: mode, label: BAR_LABEL[mode], value: snapshot.turnsByMode[mode] }))}
                />
              </div>
            </div>
          )}

          <div style={CALLOUT_STYLE}>
            <strong style={{ fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-primary)' }}>
              这是上游基准，不是本机测量
            </strong>
            <span style={{ fontSize: 11, lineHeight: '17px', color: 'var(--dsw-alias-label-tertiary)' }}>
              {STATS_TEXT.baselineNote}
              {' · '}
              <a href={BASELINE.outputTokens.source} target="_blank" rel="noreferrer" style={{ color: 'var(--dsw-alias-link)' }}>
                方法论
              </a>
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <h4 style={{ margin: 0, fontSize: 12, lineHeight: '18px', fontWeight: 500, color: 'var(--dsw-alias-label-secondary)' }}>
                {STATS_TEXT.baselineTitle}
              </h4>
              <Tag tone="quiet">基准推算</Tag>
            </div>
            {projection.activeTurns === 0 ? (
              <span style={{ fontSize: 11, lineHeight: '17px', color: 'var(--dsw-alias-label-tertiary)' }}>
                {BASELINE_NO_ACTIVE}
              </span>
            ) : (
              <>
                <BaselineRows projection={projection} base={base} />
                <span style={{ fontSize: 11, lineHeight: '17px', color: 'var(--dsw-alias-label-tertiary)' }}>
                  {baselineBasis(projection.activeTurns, projection.tokensPerTurn)}
                </span>
              </>
            )}
          </div>
        </>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
        <Button variant="outline" size="sm" disabled={resetting || confirming} onClick={() => setConfirming(true)}>
          {resetting ? STATS_TEXT.resetting : '清零统计'}
        </Button>
        {confirming ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
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
          </span>
        ) : null}
        {resetFeedback === null ? null : (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Tag tone={resetFeedback === STATS_TEXT.resetDone ? 'success' : 'danger'}>
              {resetFeedback === STATS_TEXT.resetDone ? '已清零' : '未清零'}
            </Tag>
            <span style={{ fontSize: 12, lineHeight: '18px' }}>{resetFeedback}</span>
          </span>
        )}
      </div>
    </Card>
  );
}
