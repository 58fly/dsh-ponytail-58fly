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
import { useState, type ReactNode } from 'react';
import { Button, SegmentedControl, Tag } from '@deepseek-ai/dsh-client-ui-primitives';
import { RUNTIME_MODES, type RuntimeMode } from '../l0/mode.js';
import { diagnose, type DiagnosisState } from '../l0/diagnosis.js';

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
}

/** 四个档位在面板上的展示名。 */
const MODE_TEXT: Readonly<Record<RuntimeMode, string>> = {
  off: 'off · 关闭',
  lite: 'lite · 最轻',
  full: 'full · 默认',
  ultra: 'ultra · 最狠',
};

/** 诊断状态对应的 Tag 语气与中文说明。 */
const STATE_TEXT: Readonly<Record<DiagnosisState, { tone: 'success' | 'warning' | 'danger' | 'quiet' | 'info'; text: string }>> = {
  hit: { tone: 'success', text: '生效' },
  shadowed: { tone: 'warning', text: '被覆盖' },
  invalid: { tone: 'danger', text: '值非法' },
  absent: { tone: 'quiet', text: '未设置' },
  unknown: { tone: 'info', text: '不可观测' },
};

/** 面板标题，与设置页左侧导航条目一致。 */
const TITLE = 'Ponytail 58fly';

/**
 * `useSyncExternalStoreWithSelector` 的恒等 selector。
 *
 * 必须是模块级常量：每次渲染新建一个箭头函数会让 hook 每帧都认为选择器变了。
 * 恒等 selector 不改变引用，配合 `Object.is` 的默认相等函数就能只在快照真变时重渲染。
 */
const IDENTITY = (snapshot: PanelSnapshot): PanelSnapshot => snapshot;

/**
 * 渲染设置页里的 Ponytail 面板。
 * @param props - 宿主注入的 hook 与两个写回调。
 * @returns 面板节点。
 */
export function PonytailPanel(props: PonytailPanelProps): ReactNode {
  const snapshot = props.useSnapshot(IDENTITY);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<WriteOutcome | null>(null);

  const diagnosis = diagnose({ value: snapshot.value, base: snapshot.base, user: snapshot.user });
  const effective = diagnosis.effective;
  const ready = snapshot.status === 'ready';

  const run = async (operation: () => Promise<WriteOutcome>): Promise<void> => {
    setBusy(true);
    try {
      setFeedback(await operation());
    } catch (error) {
      setFeedback({ ok: false, message: '写操作抛错：' + String(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="dsh-ponytail-58fly-panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <header style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h2 style={{ margin: 0 }}>{TITLE}</h2>
        <p style={{ margin: 0 }}>最小可用改动模式：四个档位决定「能做多少」，描述链告诉你「为什么改了没用」。</p>
      </header>

      {snapshot.status === 'loading' ? <p style={{ margin: 0 }}>正在读取配置…</p> : null}

      {snapshot.status === 'unavailable' ? (
        <p style={{ margin: 0 }}>
          当前部署没有把 <code>ponytail-58fly</code> 的配置面暴露给这个客户端。档位仍然可以改：用
          <code> /ponytail &lt;档位&gt;</code> 命令，或直接编辑 <code>cordis.patch.yml</code> 里的
          <code> ponytail-58fly.config.defaultMode</code>。
        </p>
      ) : null}

      {ready ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <SegmentedControl
            id="ponytail-58fly-mode"
            label="Ponytail 档位"
            value={effective}
            disabled={busy || !snapshot.writable}
            options={RUNTIME_MODES.map((mode) => ({ value: mode, label: MODE_TEXT[mode] }))}
            onChange={(next) => {
              void run(() => props.writeMode(next));
            }}
          />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Button
              variant="outline"
              size="sm"
              disabled={busy || !snapshot.writable || snapshot.user === undefined}
              onClick={() => {
                void run(() => props.resetMode());
              }}
            >
              清除用户层覆盖
            </Button>
            <span>
              当前生效：<code>{effective}</code>
              {snapshot.revision === undefined ? '' : ' · revision ' + String(snapshot.revision)}
              {snapshot.writable ? '' : ' · 配置只读'}
            </span>
          </div>
          {feedback === null ? null : (
            <p style={{ margin: 0, display: 'flex', gap: 8, alignItems: 'center' }}>
              <Tag tone={feedback.ok ? 'success' : 'danger'}>{feedback.ok ? '已写入' : '未写入'}</Tag>
              <span>{feedback.message}</span>
            </p>
          )}
        </div>
      ) : null}

      <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h3 style={{ margin: 0 }}>优先级诊断链</h3>
        <p style={{ margin: 0 }}>
          档位按 env → Profile 补丁 → 内置兜底 依次取值，先命中的赢。下面每一行都标出它现在是什么状态。
        </p>
        <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {diagnosis.rows.map((row) => {
            const state = STATE_TEXT[row.state];
            return (
              <li key={row.level}>
                <Tag tone={state.tone}>{state.text}</Tag> <strong>{row.label}</strong>{' '}
                <code>{row.location}</code>
                {row.value === null ? null : <> = <code>{row.value}</code></>}
                {row.note === null ? null : <> — {row.note}</>}
              </li>
            );
          })}
        </ul>
        {diagnosis.overriddenBy === null ? null : (
          <p style={{ margin: 0 }}>
            你改的补丁层正被 <strong>{diagnosis.overriddenBy === 'env' ? '环境变量' : '更高优先级的补丁'}</strong>{' '}
            盖住：面板写入的是补丁层，读到的生效值来自别处。
          </p>
        )}
      </section>
    </section>
  );
}
