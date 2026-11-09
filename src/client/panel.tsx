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
  Fragment,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { Button, HoverCard, PathLabel, SegmentedControl, Tag } from '@deepseek-ai/dsh-client-ui-primitives';
import { RUNTIME_MODES, type RuntimeMode } from '../l0/mode.js';
import { diagnose, type Diagnosis, type DiagnosisLevel, type DiagnosisState } from '../l0/diagnosis.js';
import { BASELINE, BASELINE_CAVEAT, type BaselineRow } from '../stats/baseline.js';
import type { StatsView } from '../stats/types.js';
import { BarList, Ring } from './charts.js';

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

/** 状态行里的覆盖关系：面板只认 env / patch，其余一律按无覆盖写。 */
const OVERRIDE_TEXT: Readonly<Partial<Record<DiagnosisLevel, string>>> = {
  env: '被环境变量覆盖',
  patch: '被 Profile 补丁覆盖',
};

/** 诊断状态对应的 Tag 语气与中文说明。 */
const STATE_TEXT: Readonly<Record<DiagnosisState, { tone: 'success' | 'warning' | 'danger' | 'quiet' | 'info'; text: string }>> = {
  hit: { tone: 'success', text: '生效' },
  shadowed: { tone: 'warning', text: '被覆盖' },
  invalid: { tone: 'danger', text: '值非法' },
  absent: { tone: 'quiet', text: '未设置' },
  unknown: { tone: 'info', text: '不可观测' },
};

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
  readonly title: string;
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

/** 诊断卡的规则句，逐字取自票 03。 */
const DIAGNOSIS_RULE = '取值顺序 环境变量 → Profile 补丁 → 内置兜底，先命中的赢';

/** 图例的顺序：取值链的顺序，不是 `STATE_TEXT` 的声明顺序。 */
const LEGEND_STATES: readonly DiagnosisState[] = ['hit', 'shadowed', 'invalid', 'absent', 'unknown'];

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

/** 取值列：等宽字体；超长值自己换行，不撑表格。 */
const VALUE_CELL: CSSProperties = { ...CELL_STYLE, fontFamily: 'var(--dsw-font-mono)', overflowWrap: 'anywhere' };

/** 紧凑模式的备注行：跨满整行，小一号字，读数排在它上面一行。 */
const NOTE_CELL: CSSProperties = {
  ...CELL_STYLE,
  paddingTop: 0,
  borderTop: 'none',
  fontSize: 11,
  lineHeight: '17px',
  color: 'var(--dsw-alias-label-tertiary)',
};

/** 未设置时取值列的占位，与「未设置」态用同一个词，免得读者要记两套说法。 */
const UNSET_VALUE = '未设置';

/**
 * 档位卡（票 02）：分段单选 + 标题旁 `?` 完整对照 + 单行状态行 + 卡头右侧清除按钮。
 *
 * 分段控件保留 id 与写语义；`?` 自己拉一张卡头行——`Card` 的标题是纯字符串，
 * 而 `?` 必须跟标题同一行且不能占掉卡头唯一的动作位（那是清除按钮的）。
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

  return (
    <section style={CARD_STYLE}>
      <header
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: 14, lineHeight: '22px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)' }}>
            档位
          </h3>
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
        </span>
        {reset}
      </header>

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
        <span>·</span>
        <span style={STATUS_FACT}>{snapshot.revision === undefined ? 'revision 未知' : 'revision ' + String(snapshot.revision)}</span>
        <span>·</span>
        <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
          {OVERRIDE_TEXT[diagnosis.overriddenBy ?? 'fallback'] ?? '无覆盖'}
        </span>
        {snapshot.writable ? null : <span>· 配置只读</span>}
      </div>

      {feedback === null ? null : (
        <p style={{ margin: 0, display: 'flex', gap: 8, alignItems: 'center', minWidth: 0, flexWrap: 'wrap' }}>
          <Tag tone={feedback.ok ? 'success' : 'danger'}>{feedback.ok ? '已写入' : '未写入'}</Tag>
          <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{feedback.message}</span>
        </p>
      )}
    </section>
  );
}

/**
 * 诊断卡（票 03）：规则句 + 五态图例一行，下面是从上到下的三层步骤表格。
 *
 * 表格恒按 `diagnosis.rows` 的顺序画（env → patch → fallback），不筛掉没值的层——
 * 「哪层没设」本身就是要看的信息。宽栏四列带备注；紧凑三列，备注挪到行下方，
 * 两种宽度都不丢 `note`。
 * @param props - 诊断结论与是否紧凑。
 * @returns 诊断卡节点。
 */
function DiagnosisCard(props: { readonly diagnosis: Diagnosis; readonly compact: boolean }): ReactNode {
  const { diagnosis, compact } = props;
  return (
    <Card title="优先级诊断链" compact={compact}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
          minWidth: 0,
          fontSize: 12,
          lineHeight: '18px',
          color: 'var(--dsw-alias-label-secondary)',
        }}
      >
        <span style={{ minWidth: 0 }}>{DIAGNOSIS_RULE}</span>
        {LEGEND_STATES.map((state) => (
          <Tag key={state} tone={STATE_TEXT[state].tone}>
            {STATE_TEXT[state].text}
          </Tag>
        ))}
      </div>

      <table style={TABLE_STYLE}>
        <thead>
          <tr>
            <th style={{ ...CELL_STYLE, width: '5em', borderTop: 'none' }}>状态</th>
            <th style={{ ...CELL_STYLE, width: '40%', borderTop: 'none' }}>来源</th>
            <th style={{ ...CELL_STYLE, width: '5em', borderTop: 'none' }}>取值</th>
            {compact ? null : <th style={{ ...CELL_STYLE, borderTop: 'none' }}>备注</th>}
          </tr>
        </thead>
        <tbody>
          {diagnosis.rows.map((row) => {
            const state = STATE_TEXT[row.state];
            return (
              <Fragment key={row.level}>
                <tr>
                  <td style={CELL_STYLE}>
                    <Tag tone={state.tone}>{state.text}</Tag>
                  </td>
                  <td style={{ ...CELL_STYLE, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ color: 'var(--dsw-alias-label-primary)' }}>{row.label}</span>
                    <PathLabel path={row.location} />
                  </td>
                  <td style={VALUE_CELL}>{row.value ?? UNSET_VALUE}</td>
                  {compact ? null : <td style={CELL_STYLE}>{row.note ?? ''}</td>}
                </tr>
                {compact && row.note !== null ? (
                  <tr>
                    <td colSpan={3} style={NOTE_CELL}>
                      {row.note}
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>

      {diagnosis.overriddenBy === null ? null : (
        <p style={{ margin: 0, fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)' }}>
          你改的补丁层正被 <strong>{diagnosis.overriddenBy === 'env' ? '环境变量' : '更高优先级的补丁'}</strong>{' '}
          盖住：面板写入的是补丁层，读到的生效值来自别处。
        </p>
      )}
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

      <DiagnosisCard diagnosis={diagnosis} compact={compact} />

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

/** 主行里的一组「数字 + 单位 + 说明」。 */
function Metric(props: { readonly value: string; readonly unit: string; readonly hint: string }): ReactNode {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4 }}>
      <span
        style={{
          fontSize: 20,
          lineHeight: '28px',
          fontWeight: 600,
          color: 'var(--dsw-alias-label-primary)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {props.value}
      </span>
      <span style={{ fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)' }}>{props.unit}</span>
      <span style={{ fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)' }}>{props.hint}</span>
    </span>
  );
}

/**
 * 基准推算三行 + 出处 + 限定语。
 *
 * 只出 outputTokens / cost / time（§6）：行数、gzip 面积归因不到本机这些轮次，
 * 轮次与「多少任务更便宜」是基准自己的统计量。系数从 `baseline.ts` 读，
 * 这里只做乘与格式化——把裸系数写进 JSX 就等于在 UI 里立了第二份真相。
 * @returns 三行定值表 + 页脚。
 */
function BaselineRows(): ReactNode {
  const rows: readonly { readonly label: string; readonly line: BaselineRow }[] = [
    { label: '输出 token', line: BASELINE.outputTokens },
    { label: '成本', line: BASELINE.cost },
    { label: '耗时', line: BASELINE.time },
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

/**
 * 「效率统计」区块（票 06；卡片壳与紧凑宽度见票 01）。
 *
 * 三种状态各有各的说法：空态是正常的（还没开始计数），读不到是异常的（通道没了），
 * 两者都用一句完整的话，不用感叹号也不用警告三角（§7）。
 * 主体本次只套壳：簇内排布没动，`compact` 只作用于卡头。
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
    <Card title="效率统计" action={action} compact={props.compact}>
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
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 16 }}>
            {empty ? (
              <span style={{ fontSize: 14, lineHeight: '22px', fontWeight: 500, color: 'var(--dsw-alias-label-primary)' }}>
                {STATS_TEXT.emptyTitle}
              </span>
            ) : (
              <>
                <Metric value={group(snapshot.managedTurns)} unit="轮" hint="受管" />
                <Metric value={group(snapshot.injections)} unit="次" hint="注入" />
                <Metric value={group(snapshot.modeSwitches)} unit="次" hint="切档" />
                <Metric value={group(snapshot.commandCalls)} unit="次" hint="命令调用" />
                <Metric value={formatBytes(snapshot.injectedBytes)} unit="" hint="注入字节" />
              </>
            )}
          </div>

          {empty ? (
            <p style={{ margin: 0, fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)' }}>
              {STATS_TEXT.emptyBody}
            </p>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <Ring
                  value={snapshot.injections}
                  total={snapshot.managedTurns}
                  label="注入率"
                />
                <span style={{ fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)' }}>
                  {'注入率 · ' + group(snapshot.injections) + ' / ' + group(snapshot.managedTurns)}
                </span>
              </div>
              <BarList
                label="按档位分布（受管轮次）"
                rows={RUNTIME_MODES.map((mode) => ({ key: mode, label: BAR_LABEL[mode], value: snapshot.turnsByMode[mode] }))}
              />
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <h4 style={{ margin: 0, fontSize: 12, lineHeight: '18px', fontWeight: 500, color: 'var(--dsw-alias-label-secondary)' }}>
                {STATS_TEXT.baselineTitle}
              </h4>
              <Tag tone="quiet">基准推算</Tag>
            </div>
            <BaselineRows />
            <p style={{ margin: 0, fontSize: 11, lineHeight: '17px', color: 'var(--dsw-alias-label-tertiary)' }}>
              {STATS_TEXT.baselineNote}
              {' · '}
              <a
                href={BASELINE.outputTokens.source}
                target="_blank"
                rel="noreferrer"
                style={{ color: 'var(--dsw-alias-link)' }}
              >
                方法论
              </a>
              {' · '}
              {BASELINE_CAVEAT}
            </p>
          </div>
        </>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
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
