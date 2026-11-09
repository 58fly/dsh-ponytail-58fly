/**
 * 统计层的装配面：把计数器接上宿主的事件与命令，并给出只读快照出口。
 *
 * ## 为什么是回调注入而不是让 prompt 层 import 本层
 *
 * `src/prompt/prestep.ts` 只需要「记一笔」这个动作，不需要知道计数器长什么样。
 * 于是它的 options 里只收 `StatsSink`（两个函数），由 `plugin.ts` 把本模块的
 * store 接上去——四层之间的依赖方向不变，`scripts/verify.mjs` 第 3 组只需把
 * `stats` 登记为只依赖 l0 的叶子层。
 */
import type { Context } from '@deepseek-ai/cordis';

import type { RuntimeMode } from '../l0/mode.js';
import { StatsStore } from './store.js';
import type { StatsSink, StatsView } from './types.js';

/** 本插件在宿主里的稳定标识，用作 logger scope。 */
const LOGGER_SCOPE = 'ponytail-58fly';

/** 统计层对外的全部能力。 */
export interface StatsHandle {
  /** 埋点回调：交给 prestep 用。 */
  readonly sink: StatsSink;
  /** 只读快照；命令层、面板通道、`/ponytail-gain` 都读它。 */
  readonly snapshot: () => StatsView;
  /** 清零：面板的「清零统计」走这里。 */
  readonly reset: () => void;
  /** 记一次命令调用（`/ponytail` 与 `/ponytail-gain` 共用）。 */
  readonly bumpCommand: () => void;
  /** 记一次成功切档。 */
  readonly bumpSwitch: () => void;
}

/**
 * 把字符串折成 UTF-8 字节数。
 *
 * 放进 try 里由 `bump` 兜：`text` 的 `toString` 若抛（协议上不该发生），
 * 统计只丢这一笔，绝不让 pre-step 的注入路径失败。
 * @param text - reminder 正文。
 * @returns 字节数。
 */
function utf8Bytes(text: string): number {
  return typeof TextEncoder === 'function' ? new TextEncoder().encode(text).length : text.length;
}

/**
 * 造一个统计句柄。
 *
 * 刻意不注册任何宿主事件：埋点全部由调用方在既有的成功/进入路径上显式调用，
 * 于是「统计到底算在哪一步」在源码里一眼可见，不靠事件时序猜。
 * @param ctx - 插件上下文，仅用于降级日志。
 * @returns 句柄。
 */
export function installStats(ctx: Context): StatsHandle {
  const store = new StatsStore();

  const bump = (fn: () => void): void => {
    try {
      fn();
    } catch (error) {
      // 计数器自述永不抛；这里兜住的是将来的改动，绝不让统计拖垮调用方。
      ctx.logger(LOGGER_SCOPE).warn('效率统计记数失败（不影响本轮）：' + String(error));
    }
  };

  return {
    sink: {
      onTurn: (mode: RuntimeMode) => {
        bump(() => store.bump('managedTurns', { mode }));
      },
      onInject: (text: string) => {
        bump(() => store.bump('injections', { bytes: utf8Bytes(text) }));
      },
    },
    snapshot: () => store.snapshot(),
    reset: () => {
      bump(() => store.reset());
    },
    bumpCommand: () => {
      bump(() => store.bump('commandCalls'));
    },
    bumpSwitch: () => {
      bump(() => store.bump('modeSwitches'));
    },
  };
}
