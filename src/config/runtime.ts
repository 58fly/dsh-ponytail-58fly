/**
 * L2 · 配置运行时：优先级链的活状态 + 唯一的写入口。
 *
 * 这个模块把三件事收到一处，因为它们在语义上必须原子：
 *
 * 1. **当前生效档位与诊断链**（`resolvePriority` 的输出）——面板（#05）、命令（#07）
 *    与提示段渲染都读它；
 * 2. **一个写入口**（`ConfigRuntime.setMode`）——`/ponytail <mode>` 命令与设置面板必须
 *    走同一个函数。两条路径各自归一化，就会出现「命令写进去是 lite、面板读出来是
 *    full」这类不可能排查的错位；
 * 3. **订阅**——档位变了要通知渲染层重算。
 *
 * **写入一律走宿主 settings 通道，本模块不自写盘。** 宿主 `dsh-config-editor` 的
 * `edit()` 已经做了文件锁（`withFileLock`）、`writeFileAtomic`、reconcile 失败回滚，
 * 上游那 175 行自写盘代码（`writeDiskConfig` / `safeAtomicWriteFile` / `salvageConfig`）
 * 在这里没有任何存在理由。
 *
 * **settings 是可选的。** 判定方式是用 `ctx.inject(["settings"], cb)` 起一个子 fiber——
 * 依赖缺席时该子 fiber 根本不启动，主插件照常跑，不需要任何 try/catch 探测。
 * （`ctx.inject` 是 `ctx.plugin({inject, apply})` 的简写，不是条件注册钩子。）
 *
 * **非法配置保留上一个好值这件事不用我们写。** 宿主的
 * `cordis-plugin-loader` 在 `_commitVolatile()` 里 catch 掉校验失败，只记一条 warn 然后
 * 原值不动；我们的责任是把这件事**显性化**——把拒绝原因并进诊断链，让面板说得出
 * 「你上次写的值被拒了，现在跑的还是旧的」。
 */
import type { Context, Fiber } from '@deepseek-ai/cordis';
import type { SettingsForms, SettingsPathOp } from '@deepseek-ai/dsh-settings';

import {
  PRIORITY_ENV_NAME,
  resolvePriority,
  type PriorityReport,
  type PrioritySource,
} from './priority.js';
import type { PonytailConfig } from './schema.js';
import { readVolatileField } from './volatile.js';
import { describeError } from '../l0/errors.js';
import { coerceMode, type RuntimeMode } from '../l0/mode.js';
import { PLUGIN_ID } from '../l0/paths.js';

/** 环境变量表的最小形状。测试可注入假对象，不必污染 process.env。 */
export interface EnvLike {
  readonly [key: string]: string | undefined;
}

export { PRIORITY_ENV_NAME };

/** 面板与命令共用的只读快照。字段刻意扁平，方便 Typert 直接序列化。 */
export interface PonytailSnapshot {
  /** 当前生效档位。 */
  readonly effective: RuntimeMode;
  /** 三层诊断明细，恒 3 项。 */
  readonly chain: readonly PrioritySource[];
  /** 宿主 settings 里本插件条目的 revision；无 settings 时为 null。 */
  readonly revision: number | null;
  /** 宿主是否可写。无 settings 服务时为 false。 */
  readonly writable: boolean;
  /** Profile 补丁文件路径，供面板显示「改这里」；无 settings 时为 null。 */
  readonly documentPath: string | null;
}

/**
 * 一次写档位的结果。失败**不抛异常**，由调用方决定怎么呈现。
 *
 * `note` 与 `ok` 正交：值写下去了（`ok: true`）但仍不会生效——典型情形是环境变量
 * 优先级更高。这时候报错是错误的：文件确实改了，用户下次取消环境变量就会生效。
 * 面板该做的是把 note 显示成警告而不是失败。
 */
export type WriteOutcome =
  | { readonly ok: true; readonly mode: RuntimeMode; readonly note: string | null }
  | { readonly ok: false; readonly reason: string };

/** settings 服务的不可变句柄。无 settings 时整个对象为 null。 */
interface SettingsHandle {
  readonly forms: SettingsForms;
  readonly fiber: Fiber;
}

/** 写配置时我们关心的那几项；其余字段（schema、secrets、autoGenerate）不读。 */
interface SettingsDescriptorLike {
  readonly ns?: unknown;
  readonly revision?: unknown;
  readonly user?: unknown;
}

/** ConfigRuntime 的构造参数。 */
export interface ConfigRuntimeOptions {
  /** 插件自己的 ctx。 */
  readonly ctx: Context;
  /**
   * `apply` 收到的配置对象。
   *
   * **必须持有这个对象本身，不能只抄一份值**：volatile 字段是活引用，宿主的
   * `_commitVolatile()` 用 `updateVolatile()` 原地更新它的快照，抄下来的值永远不会变。
   */
  readonly config: PonytailConfig;
  /** 环境变量表，默认 process.env；测试注入假对象。 */
  readonly env?: EnvLike;
}

/**
 * 从 describe() 的返回里挑出本插件那一条。
 *
 * 不假设返回顺序：describe() 遍历 `configEditor.configuration()`，条目顺序跟着 loader
 * 的装配顺序走，跨版本不稳定。
 * @param descriptors - describe() 的返回值。
 * @returns 本插件的描述符，或 null。
 */
function pickDescriptor(descriptors: readonly unknown[]): SettingsDescriptorLike | null {
  for (const raw of descriptors) {
    if (typeof raw !== 'object' || raw === null) continue;
    const candidate = raw as SettingsDescriptorLike;
    if (candidate.ns === PLUGIN_ID) return candidate;
  }
  return null;
}

/**
 * 从描述符里读 revision。
 * @param descriptor - 描述符。
 * @returns revision；形状不对时 null（当作「不知道」，写入时不带乐观锁）。
 */
function readRevision(descriptor: SettingsDescriptorLike | null): number | null {
  const value = descriptor?.revision;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * 从描述符的 `user` 投影里读补丁层原文。
 *
 * `user` 是「profile 补丁里最后一条带 config 的同 id 节点」的投影，这正是诊断链里
 * patch 层该报的东西——它**不是** `value`（effectiveConfig），后者已经混进了 env 与
 * 兜底，拿来当 patch 层会让面板把「兜底的 full」说成「用户配的 full」。
 * @param descriptor - 描述符。
 * @returns defaultMode 的原文，或 undefined。
 */
function readPatchRaw(descriptor: SettingsDescriptorLike | null): unknown {
  const user = descriptor?.user;
  if (typeof user !== 'object' || user === null) return undefined;
  return (user as Record<string, unknown>).defaultMode;
}

/**
 * 判定一个错误是不是版本冲突。
 *
 * **不 import SettingsConflictError 而认 code**：`@deepseek-ai/dsh-settings` 对本包是纯
 * 类型依赖（运行时裸 import 在宿主 profile 里解析不到，会 ERR_MODULE_NOT_FOUND），
 * 拿不到类做 instanceof。`code` 是宿主写死的字面量 `"SETTINGS_CONFLICT"`，跨版本稳定。
 * @param error - 捕获到的异常。
 * @returns 是冲突则 true。
 */
function isConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  return (error as { readonly code?: unknown }).code === 'SETTINGS_CONFLICT';
}

/**
 * 异常文本化转由 l0 提供并在此转发。
 *
 * 保留这行 re-export 是为了不动既有调用点（plugin / commands 都在用）；
 * 但它**不能定义在 config 层**——prompt 层要用同一行文案，而 prompt 只可引用 l0
 * （`scripts/verify.mjs` 的分层矩阵），定义在这里会逼它反向依赖。
 */
export { describeError };

/**
 * 读 `documentPath`，失败时返回 null。
 *
 * 这是只读的诊断展示（面板上显示「改这里」），读不到不该让整次刷新失败。
 * @param forms - settings 服务。
 * @returns 路径或 null。
 */
function safeDocumentPath(forms: SettingsForms): string | null {
  try {
    const path = forms.documentPath;
    return typeof path === 'string' ? path : null;
  } catch {
    return null;
  }
}

/**
 * 配置运行时。
 *
 * 生命周期：`plugin.apply` 里构造一次，随插件 fiber 卸载而失效。
 * 所有公开方法都对「没有 settings 服务」这件事免疫。
 */
export class ConfigRuntime {
  readonly #ctx: Context;
  readonly #env: EnvLike;
  readonly #config: PonytailConfig;
  readonly #listeners = new Set<() => void>();

  #settings: SettingsHandle | null = null;
  #revision: number | null = null;
  #documentPath: string | null = null;
  /**
   * 最近一次**成功读到**的补丁层原文。
   *
   * 单独存一份，是因为「读失败」与「写失败」都不该让补丁层降级成「没配」：
   * 前者会让面板谎称用户的配置消失了，后者会把用户刚写的值说成没写。
   * 只有真正读到新的真相时才更新它。
   */
  #patchValue: unknown = undefined;
  /** 最近一次写入被拒的原因；并进 patch 层的 problem。 */
  #rejected: string | null = null;
  #report: PriorityReport;
  #lastEmitted: string | null = null;
  #disposed = false;

  constructor(options: ConfigRuntimeOptions) {
    this.#ctx = options.ctx;
    this.#env = options.env ?? (process.env as EnvLike);
    this.#config = options.config;
    // 先按「无 settings」算一次：apply 里要立刻拿到可用的档位，不能等子 fiber 起来。
    // settings 到位后 refresh() 会重算并通知。
    this.#patchValue = this.#patchRaw();
    this.#report = this.#compute();
  }

  /** 当前生效档位。 */
  get mode(): RuntimeMode {
    return this.#report.effective;
  }

  /** 当前诊断报告。 */
  get report(): PriorityReport {
    return this.#report;
  }

  /** 是否存在可写的 settings 服务。 */
  get hasSettings(): boolean {
    return this.#settings !== null;
  }

  /**
   * 供 Typert 只读通道 / 面板 / 命令读取的快照。
   * @returns 新对象，可安全序列化。
   */
  getSnapshot(): PonytailSnapshot {
    return {
      effective: this.#report.effective,
      chain: this.#report.chain,
      revision: this.#revision,
      writable: this.#settings !== null,
      documentPath: this.#documentPath,
    };
  }

  /**
   * 订阅变化。返回退订函数。
   *
   * 只在**档位或诊断真的变了**时通知——宿主每次 `settings/updated` 都会广播，
   * 其中绝大多数与档位无关（别的插件改配置也广播到整棵树）。
   * @param listener - 回调。
   * @returns 退订函数。
   */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /**
   * 唯一的写入口。
   *
   * 语义按票面 #04 / #07 的要求：
   * - 非法值**不改任何东西**，也不回落默认档，只返回失败原因；
   * - 成功与否以「写完之后重新 describe」为准，**绝不本地先改后写**（上游 B-02 的根因
   *   就是先改本地状态再发请求，失败后 UI 与磁盘长期不一致）；
   * - 版本冲突**自动重试一次**：重新 describe 拿新 revision 再写。只重试一次是因为
   *   第二次冲突说明有别的写入者在持续竞争，无限重试会把一次点击变成写盘风暴。
   * @param raw - 用户输入的原始值（命令参数或面板值），任何形状都接受。
   * @returns 写入结果；不抛异常。
   */
  async setMode(raw: unknown): Promise<WriteOutcome> {
    const mode = coerceMode(raw);
    if (mode === null) {
      return { ok: false, reason: '档位无效（可选 off / lite / full / ultra）：' + String(raw) };
    }
    const handle = this.#settings;
    if (handle === null) {
      return { ok: false, reason: '宿主没有 settings 服务，档位只能由环境变量与内置兜底决定' };
    }

    const first = await this.#write(handle, mode, this.#revision);
    if (first.ok) {
      await this.refresh();
      return { ok: true, mode, note: this.#envNote() };
    }
    if (!first.conflict) {
      this.#recordRejection(first.reason);
      return { ok: false, reason: first.reason };
    }

    // 冲突：重新读一次真相，再写一次。
    await this.refresh();
    const second = await this.#write(handle, mode, this.#revision);
    await this.refresh();
    if (second.ok) return { ok: true, mode, note: this.#envNote() };
    this.#recordRejection(second.reason);
    return { ok: false, reason: second.reason };
  }

  /**
   * 环境变量正在压制补丁层时给一句提示；否则 null。
   *
   * 独立成方法是因为它在「写入成功」与「写入后重读」两条路径上都要用，
   * 而它的判据必须与 `resolvePriority` 完全一致（同一个 `coerceMode`）。
   * @returns 提示文本或 null。
   */
  #envNote(): string | null {
    const envMode = coerceMode(this.#env[PRIORITY_ENV_NAME]);
    if (envMode === null) return null;
    return '已写入，但环境变量 ' + PRIORITY_ENV_NAME + ' 的优先级更高，实际仍在跑 ' + envMode;
  }

  /**
   * 重新读宿主状态并重算诊断。
   *
   * 有 settings 时以 `describe()` 为准（`user` 投影 = 补丁层原文，`revision` = 写入时的
   * 乐观锁）；无 settings 时退回读 `apply` 收到的 config——这时它是唯一可见来源，
   * 把它当作补丁层报出来是诚实的。
   * @returns 无。
   */
  async refresh(): Promise<void> {
    if (this.#disposed) return;
    const handle = this.#settings;
    if (handle === null) {
      this.#revision = null;
      this.#documentPath = null;
      this.#patchValue = this.#patchRaw();
      this.#report = this.#compute();
      this.#emit();
      return;
    }
    let descriptor: SettingsDescriptorLike | null = null;
    try {
      descriptor = pickDescriptor(handle.forms.describe());
    } catch (error) {
      // 读失败：保留上一份报告与上一份补丁层原文，只把原因显性化。
      // 重算会把 patch 层打回 apply 收到的旧 config，等于对用户谎称配置没了。
      this.#recordRejection('读设置失败：' + describeError(error));
      return;
    }
    this.#revision = readRevision(descriptor);
    this.#documentPath = safeDocumentPath(handle.forms);
    // 描述符存在说明条目在，patch 层读 user；描述符不存在时退回 config（可能是
    // 本插件刚被别处改过、条目暂时消失，读 config 至少不会把状态丢成「没配」）。
    this.#patchValue = descriptor === null ? this.#patchRaw() : readPatchRaw(descriptor);
    this.#report = this.#compute();
    this.#emit();
  }

  /**
   * 接入 settings 服务（由 `ctx.inject(["settings"], …)` 的回调调用）。
   *
   * 刻意**不**调 `settings.configure({auto:false})`：那会关掉宿主自动生成设置表单，
   * 而自定义面板属于 #05。在 #05 落地之前关掉自动表单，用户会面对一个空白设置页——
   * 每轮交付都该是完整的，所以这一步留到面板就绪时再做。
   * @param forms - settings 服务实例。
   * @param fiber - 子 fiber，用于绑定生命周期。
   * @returns 无。
   */
  attachSettings(forms: SettingsForms, fiber: Fiber): void {
    if (this.#disposed) return;
    this.#settings = { forms, fiber };
    void this.refresh();
  }

  /** 标记失效，之后所有回调都变成 no-op（防止 fiber 卸载后的迟到回调）。 */
  dispose(): void {
    this.#disposed = true;
    this.#listeners.clear();
    this.#settings = null;
  }

  /**
   * 补丁层原文：优先取 `apply` 收到的活引用（volatile 引用会被宿主原地更新）。
   * @returns 解包后的原文。
   */
  #patchRaw(): unknown {
    return readVolatileField(this.#config?.defaultMode);
  }

  /**
   * 一次写入。把「冲突」与「其它失败」分开返回，调用方据此决定是否重试。
   * @param handle - settings 句柄。
   * @param mode - 目标档位。
   * @param revision - 期望的 revision，null 表示不校验。
   * @returns 结果。
   */
  async #write(
    handle: SettingsHandle,
    mode: RuntimeMode,
    revision: number | null,
  ): Promise<
    | { readonly ok: true }
    | { readonly ok: false; readonly conflict: boolean; readonly reason: string }
  > {
    const ops: readonly SettingsPathOp[] = [{ op: 'set', path: ['defaultMode'], value: mode }];
    try {
      await handle.forms.mutate(PLUGIN_ID, ops, revision ?? undefined);
      this.#rejected = null;
      return { ok: true };
    } catch (error) {
      if (isConflict(error)) return { ok: false, conflict: true, reason: describeError(error) };
      return { ok: false, conflict: false, reason: describeError(error) };
    }
  }

  /**
   * 记下拒绝原因并立即重算（诊断面板要能一次看到「改了为什么没用」）。
   * @param reason - 拒绝原因。
   * @returns 无。
   */
  #recordRejection(reason: string): void {
    this.#rejected = reason;
    // 用**上一份**补丁层原文重算：失败意味着真相没变，只是多了一条要显示的拒绝原因。
    this.#report = this.#compute();
    this.#emit();
  }

  /**
   * 纯函数式地算一份报告（补丁层取最近一次成功读到的原文）。
   * @returns 诊断报告。
   */
  #compute(): PriorityReport {
    return resolvePriority({
      env: this.#env[PRIORITY_ENV_NAME],
      patch: readVolatileField(this.#patchValue),
      rejected: this.#rejected,
    });
  }

  /**
   * 通知订阅者（带「真的变了吗」的前置判断）。
   *
   * 比对用 `JSON.stringify`：快照里只有字符串、布尔、null 与扁平对象，键序由对象
   * 字面量固定，序列化结果稳定。比手写深比较省 40 行且不会漏字段。
   * @returns 无。
   */
  #emit(): void {
    if (this.#disposed) return;
    // 指纹必须**无条件**更新，不能因为当前没有订阅者就跳过：
    // 否则后来订阅的人会被第一帧当成「变了」，收到一次毫无变化的通知。
    const fingerprint = JSON.stringify({
      effective: this.#report.effective,
      chain: this.#report.chain,
    });
    if (fingerprint === this.#lastEmitted) return;
    this.#lastEmitted = fingerprint;
    if (this.#listeners.size === 0) return;
    const logger = this.#ctx.logger('ponytail-58fly');
    for (const listener of [...this.#listeners]) {
      try {
        listener();
      } catch (error) {
        logger.warn('配置变更通知的订阅者抛错：' + describeError(error));
      }
    }
  }
}

/**
 * 计算当前档位的纯函数快捷方式（供插件在拿到 runtime 之前先渲染一次提示段）。
 * @param config - apply 收到的配置。
 * @param env - 环境变量表。
 * @returns 生效档位。
 */
export function effectiveModeOf(config: PonytailConfig | undefined, env: EnvLike): RuntimeMode {
  return resolvePriority({
    env: env[PRIORITY_ENV_NAME],
    patch: readVolatileField(config?.defaultMode),
    rejected: null,
  }).effective;
}
