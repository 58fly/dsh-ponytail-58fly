/**
 * 计数本体：纯加法、零 I/O、永不抛。
 *
 * ## 为什么 `bump` 绝不抛
 *
 * 埋点在 `src/prompt/prestep.ts` 的 try 块里：那里任何异常都会被 catch 成
 * 「档位提醒注入失败，本步按原样继续」，于是统计若抛错，用户会看到一条与统计
 * 毫无关系的警告，**且本步的注入逻辑被跳过**。所以 bump 只做数值运算与边界钳制，
 * 不碰 I/O、不碰宿主服务，物理上没有抛出的机会。
 *
 * ## 为什么不落盘
 *
 * `scripts/verify.mjs` 第 11 组「零垃圾承诺」禁止 `src/**` 出现任何写盘 API；
 * 宿主 settings 文档承载统计又会被 volatile 字段的 strip() 抹掉（见票 04）。
 * 于是计数只在本次宿主运行期内累计，重启清零——这是诚实的边界，不是缺陷。
 */
import { RUNTIME_MODES, type RuntimeMode } from '../l0/mode.js';
import type { CounterKey, StatsView } from './types.js';

/** 计数入口的参数。`bytes` 只对注入类键有意义。 */
export interface BumpOptions {
  /** 本步计入哪个档位；不认识的值落到 'full'（丢一轮比记错档更糟）。 */
  readonly mode?: RuntimeMode;
  /** 注入正文的 UTF-8 字节数。 */
  readonly bytes?: number;
}

/** 计数器。不认识「档位从哪来」「命令叫什么」，于是可以零宿主依赖地单测。 */
export class StatsStore {
  #managedTurns = 0;
  #injections = 0;
  #injectedBytes = 0;
  #turnsByMode: Record<RuntimeMode, number> = { off: 0, lite: 0, full: 0, ultra: 0 };
  #modeSwitches = 0;
  #commandCalls = 0;
  #firstAt: number | null = null;
  #lastAt: number | null = null;
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
        this.#turnsByMode[sanitizeMode(options.mode)] += 1;
        break;
      case 'injections':
        this.#injections += 1;
        this.#injectedBytes += sanitizeBytes(options.bytes);
        break;
      case 'injectedBytes':
        this.#injectedBytes += sanitizeBytes(options.bytes);
        break;
      case 'modeSwitches':
        this.#modeSwitches += 1;
        break;
      case 'commandCalls':
        this.#commandCalls += 1;
        break;
    }
    const now = Date.now();
    this.#firstAt ??= now;
    this.#lastAt = now;
    this.#revision += 1;
  }

  /** 当前快照。新对象，调用方可随意序列化。 */
  snapshot(): StatsView {
    return {
      version: 1,
      managedTurns: this.#managedTurns,
      injections: this.#injections,
      injectedBytes: this.#injectedBytes,
      turnsByMode: { ...this.#turnsByMode },
      modeSwitches: this.#modeSwitches,
      commandCalls: this.#commandCalls,
      firstAt: this.#firstAt,
      lastAt: this.#lastAt,
      revision: this.#revision,
    };
  }

  /** 清零。`revision` 也归零——它描述的是这份数据本身。 */
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
 * 把任意档位夹到取值域内。不抛、不返回 null。
 * @param mode - 调用方给的档位。
 * @returns 合法档位；不认识时回落 'full'。
 */
function sanitizeMode(mode: RuntimeMode | undefined): RuntimeMode {
  return mode !== undefined && RUNTIME_MODES.includes(mode) ? mode : 'full';
}

/**
 * 字节数清洗：负数、NaN、Infinity、非整数一律当 0。
 * @param bytes - 调用方给的字节数。
 * @returns 非负整数。
 */
function sanitizeBytes(bytes: number | undefined): number {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes <= 0) return 0;
  return Math.floor(bytes);
}
