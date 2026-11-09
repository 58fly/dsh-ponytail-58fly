// 自检时用 node --experimental-strip-types 跑；.js 说明符按 NodeNext 习惯写，仓库内由 tsc 映射到 .ts。

/**
 * 原型 · 02 统计层接口：StatsStore 的形状与计数点（可直接跑，不是成品）
 *
 * 这份文件**不进仓**，只为把 02 票要回答的形状问题变成能对着改的代码。
 * 拷进 `src/stats/` 时按注释里的 `// → src/stats/xxx.ts` 拆开。
 *
 * ## 一、为什么是「计数器对象 + 快照函数」而不是「事件流」
 *
 * 全部指标都是单调递增的整数：受管轮次、注入次数、注入字节、按档位轮次、
 * 切档次数、命令调用次数。单调整数只需要 `+1`，不需要事件、不需要订阅者、
 * 不需要去重窗口。用事件流表达同一件事会引入「事件丢了怎么办」这个不存在的问题。
 *
 * ## 二、为什么 `bump` 绝不抛（本文件最重要的契约）
 *
 * 埋点在 `src/prompt/prestep.ts` 的 try 块里：那里任何异常都会被 catch 成
 * 「档位提醒注入失败，本步按原样继续」。统计如果抛错，用户会看到一条与统计
 * 毫无关系的警告，而且**下一步的注入逻辑会被跳过**。所以 `bump` 全部走
 * 数值运算 + 边界钳制，不碰 I/O、不碰宿主服务，物理上没有抛出的机会。
 *
 * ## 三、为什么不落盘（对 Q12 的反提案，见票面）
 *
 * `scripts/verify.mjs` 第 11 组「零垃圾承诺」用正则扫 `src/**` 的写盘 API，
 * `writeFile` / `rename` 都在名单里，**任何一处都会让 `pnpm verify` 报红**。
 * 三条出路与代价：
 *
 *   a. 不落盘（本原型）：进程内累计，宿主重启清零。零门禁冲突，零残渣。
 *      代价：跨重启不累计，与地图 Destination 里「跨宿主重启累计」一句冲突。
 *   b. 具名白名单：第 11 组改成「只有 `src/stats/persist.ts` 可以写盘」，
 *      并在 verify 注释里写明理由。代价：改动仓库的硬约束，需要用户点头。
 *   c. 借宿主的 settings 文档：把计数写进配置。已由 04 实测否决
 *      （volatile 字段会被任何配置写入抹掉）。
 *
 * 默认走 a，`StatsPersist` 留成可选接口，b 定案时只需换掉注入进来的实现。
 */

import type { RuntimeMode } from '../../src/l0/mode.js';
import { RUNTIME_MODES } from '../../src/l0/mode.js';

// → src/stats/types.ts

/**
 * 一个计数键。
 *
 * 命名约定：全部是「发生过多少次」的复数，单位写在注释里而不是键名里
 * （`turns` 而不是 `turnCount`：类型已经说了是 number）。
 */
export type CounterKey =
  /** 经过一次 `agent/pre-step` 且决定 `enter`。 */
  | 'managedTurns'
  /** 真正把 reminder 塞进本步消息批次。 */
  | 'injections'
  /** reminder 正文字节数累加（UTF-8）。 */
  | 'injectedBytes'
  /** `/ponytail` 与 `/ponytail-gain` 的调用次数。 */
  | 'commandCalls'
  /** 档位真的变化并写入成功的次数（不含 off→off 这种空写）。 */
  | 'modeSwitches';

/** 快照里的固定形状。所有字段都是整数，全部可 JSON 序列化。 */
export interface StatsSnapshot {
  /** 格式版本；落盘方案定案后靠它做迁移，内存态也给，避免两套形状。 */
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

// → src/stats/store.ts

/** 计数入口的参数。`bytes` 只对 injections 有意义，其它键忽略。 */
export interface BumpOptions {
  /** 本步计入哪个档位；不给就落到当前快照的默认（full）。 */
  readonly mode?: RuntimeMode;
  /** 注入正文的 UTF-8 字节数。 */
  readonly bytes?: number;
}

/**
 * 计数器本体。
 *
 * 只做加法与时序记录。**不认识**「档位从哪来」「命令叫什么」——那些是调用方的事，
 * 于是这个类可以零宿主依赖地单测。
 */
export class StatsStore {
  #managedTurns = 0;
  #injections = 0;
  #injectedBytes = 0;
  #turnsByMode: Record<RuntimeMode, number> = { off: 0, lite: 0, full: 0, ultra: 0 };
  #modeSwitches = 0;
  #commandCalls = 0;
  #firstAt: number | null = null;
  #lastAt: number | null = null;
  /** 单调递增的变更序号：客户端据此判断「这份快照是不是新的」。 */
  #revision = 0;

  /**
   * 计一次数。永不抛。
   * @param key - 计数键。
   * @param options - 档位与字节数。
   */
  bump(key: CounterKey, options: BumpOptions = {}): void {
    switch (key) {
      case 'managedTurns':
        this.#managedTurns += 1;
        // 档位归一到取值域内；越界值落到 full 而不是丢弃这一轮：
        // 丢一轮会让「受管轮次」与 pre-step 次数对不上，是更糟的谎。
        this.#turnsByMode[normalizeMode(options.mode)] += 1;
        break;
      case 'injections':
        this.#injections += 1;
        this.#injectedBytes += sanitizeBytes(options.bytes);
        break;
      case 'modeSwitches':
        this.#modeSwitches += 1;
        break;
      case 'commandCalls':
        this.#commandCalls += 1;
        break;
      case 'injectedBytes':
        // 单列一个键是为了让「只记字节不记次数」这种调用点也能表达；
        // 现有埋点都走 injections，这条留着不实现加法以外的语义。
        this.#injectedBytes += sanitizeBytes(options.bytes);
        break;
    }
    const now = Date.now();
    this.#firstAt ??= now;
    this.#lastAt = now;
    this.#revision += 1;
  }

  /** 当前快照。新对象，调用方可随意序列化。 */
  snapshot(): StatsSnapshot & { readonly revision: number } {
    return {
      version: 1,
      managedTurns: this.#managedTurns,
      injections: this.#injections,
      injectedBytes: this.#injectedBytes,
      // 复制一份：`RUNTIME_MODES` 顺序是 UI 的渲染顺序，键集恒为四档。
      turnsByMode: { ...this.#turnsByMode },
      modeSwitches: this.#modeSwitches,
      commandCalls: this.#commandCalls,
      firstAt: this.#firstAt,
      lastAt: this.#lastAt,
      revision: this.#revision,
    };
  }

  /** 清零。用户点「清零」走这里；`revision` 也归零，因为它描述的是这份数据本身。 */
  reset(): void {
    this.#managedTurns = 0;
    this.#injections = 0;
    this.#injectedBytes = 0;
    this.#turnsByMode = { off: 0, lite: 0, full: 0, ultra: 0 };
    this.#modeSwitches = 0;
    this.#commandCalls = 0;
    this.#firstAt = null;
    this.#lastAt = null;
    this.#revision = 0;
  }
}

/**
 * 把任意档位输入夹到取值域内。**不抛、不返回 null**：
 * 计数器宁可少一格语义，也不能因为一个脏值让 pre-step 挂掉。
 * @param mode - 调用方给的档位。
 * @returns 合法档位；不认识时回落 'full'。
 */
function normalizeMode(mode: RuntimeMode | undefined): RuntimeMode {
  return mode !== undefined && RUNTIME_MODES.includes(mode) ? mode : 'full';
}

/**
 * 字节数清洗：负数、NaN、Infinity、非整数一律当 0。
 * @param bytes - 调用方给的字节数。
 * @returns 非负安全整数。
 */
function sanitizeBytes(bytes: number | undefined): number {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes <= 0) return 0;
  return Math.floor(bytes);
}

// → src/stats/baseline.ts（系数表；数值来自 01 票，此处只做接口）

/** 一条基准系数：中心值 + 可选区间 + 出处。 */
export interface BaselineRow {
  /** 相对基线（不用 ponytail）的变化比例，负数表示减少。 */
  readonly center: number;
  /** 95% 区间；单点估计时省略。 */
  readonly range?: readonly [number, number];
  /** 出处；UI 必须能点开。 */
  readonly source: string;
}

/**
 * 上游基准表。**数值一个字都不许在 UI 里重写**：UI 只做乘法与格式化。
 *
 * 来源与限定语见 `docs/research/upstream-efficiency-metrics.md`：
 * Claude Code + Opus 5.5、39 任务 × 5 次 × 三臂，几何平均 + bootstrap 区间。
 * 这是**别人的测量**，不是本仓的测量。
 */
export const BASELINE = {
  loc: { center: -0.53, range: [-0.63, -0.41], source: 'https://github.com/DietrichGebert/ponytail/blob/main/benchmarks/results/2026-10-07-agentic.md' },
  codeInformationGzip: { center: -0.41, range: [-0.51, -0.3], source: 'https://github.com/DietrichGebert/ponytail/blob/main/benchmarks/results/2026-10-07-agentic.md' },
  outputTokens: { center: -0.45, range: [-0.54, -0.35], source: 'https://github.com/DietrichGebert/ponytail/blob/main/benchmarks/results/2026-10-07-agentic.md' },
  cost: { center: -0.26, range: [-0.36, -0.16], source: 'https://github.com/DietrichGebert/ponytail/blob/main/benchmarks/results/2026-10-07-agentic.md' },
  time: { center: -0.41, range: [-0.49, -0.32], source: 'https://github.com/DietrichGebert/ponytail/blob/main/benchmarks/results/2026-10-07-agentic.md' },
  turns: { center: -0.22, source: 'https://github.com/DietrichGebert/ponytail/blob/main/benchmarks/results/2026-10-07-agentic.md' },
} as const satisfies Record<string, BaselineRow>;

// → src/stats/projection.ts

/**
 * 把「我们自己量到的次数」乘上「别人的基准」得到预估。
 *
 * 这一步是整个面板唯一会产出百分比的代码，也是唯一允许撒谎的地方——
 * 所以它把假设全写在返回值的字段名里，UI 照抄即可，不需要自己猜措辞。
 * @param snapshot - 当前计数快照。
 * @param tokensPerTurn - 假设的单轮输出 token 数（默认 800，可在 UI 里说明）。
 * @returns 三个预估行，每行都带「这是推算」的限定。
 */
export function projectSavings(snapshot: StatsSnapshot, tokensPerTurn = 800) {
  // 只统计「档位非 off 的受管轮次」：off 档下 ponytail 不注入任何东西，
  // 把这些轮次算进省下的量就是凭空造数。
  const activeTurns = snapshot.managedTurns - snapshot.turnsByMode.off;
  const estimatedOutputTokens = activeTurns * tokensPerTurn;
  const scale = (row: BaselineRow) => ({
    center: estimatedOutputTokens * row.center,
    from: row.range === undefined ? null : estimatedOutputTokens * row.range[0],
    to: row.range === undefined ? null : estimatedOutputTokens * row.range[1],
    source: row.source,
  });
  return {
    /** 参与推算的轮次（分母；UI 必须显示它，否则百分比没有分母）。 */
    activeTurns,
    /** 假设值；UI 显示「按每轮 N token 估算」。 */
    tokensPerTurn,
    outputTokens: scale(BASELINE.outputTokens),
    cost: scale(BASELINE.cost),
    time: scale(BASELINE.time),
  };
}
