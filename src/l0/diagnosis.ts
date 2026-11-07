/**
 * 优先级诊断链的**纯函数**推导。
 *
 * 为什么要放在 `l0` 而不是 `client`：
 * 浏览器 bundle 里读不到宿主进程的 `process.env`（`platform: 'browser'`），
 * 所以面板不能自己重算 env 层，只能拿宿主已经 resolve 过的三段原始值
 * （`settings.describe` 的 `value` / `base` / `user`，由
 * `ctx.configForms.get(PLUGIN_ID).getSnapshot()` 透出）**按值归属**反推：
 * 谁的值等于最终生效值，谁就是命中的那一层。这个推导是纯函数、零 IO，
 * 客户端与服务端可以共用同一份实现，也能被 node --test 直接测。
 *
 * 与 `src/config/priority.ts` 的关系：那边是**服务端**的链（`resolvePriority`
 * 拿 env 原文与补丁原文算），这边是**客户端**的链（只能拿 resolved 结果反推）。
 * 两边的三层语义必须一致，位置文案因此逐字对齐；`test/client-diagnosis.test.mjs`
 * 有一条哨兵测试钉住这组字面量，改一边不改另一边会红。
 *
 * @module
 */
import { DEFAULT_MODE, coerceMode, type RuntimeMode } from './mode.js';

/** 环境变量名，与服务端 `priority.ts` 的 `PRIORITY_ENV_NAME` 同值。 */
export const DIAGNOSIS_ENV_NAME = 'PONYTAIL_DEFAULT_MODE';

/** 补丁层位置，与服务端 `priority.ts` 的 `PATCH_LOCATION` 同值。 */
export const DIAGNOSIS_PATCH_LOCATION = 'cordis.patch.yml → ponytail-58fly.config.defaultMode';

/** 兜底层位置，与服务端 `priority.ts` 的 `FALLBACK_LOCATION` 同值。 */
export const DIAGNOSIS_FALLBACK_LOCATION = 'src/l0/mode.ts → DEFAULT_MODE';

/** 值非法时的统一说明，与服务端 `INVALID_PROBLEM` 同值。 */
export const DIAGNOSIS_INVALID_PROBLEM = '值无效，已忽略';

/** 诊断链的层名，与服务端 `PriorityLevel` 取值域相同。 */
export type DiagnosisLevel = 'env' | 'patch' | 'fallback';

/**
 * 一层在诊断链里的状态。
 *
 * - `hit`：最终生效值来自这一层；
 * - `shadowed`：这一层有合法值，但被更高优先级的层盖住了；
 * - `invalid`：这一层写了值，但不是合法档位，已被忽略；
 * - `absent`：这一层没有写值；
 * - `unknown`：这一层在浏览器侧不可观测（只有 env 会用）。
 */
export type DiagnosisState = 'hit' | 'shadowed' | 'invalid' | 'absent' | 'unknown';

/** 诊断链里的一行。 */
export interface DiagnosisRow {
  /** 层名。 */
  readonly level: DiagnosisLevel;
  /** 展示名（中文）。 */
  readonly label: string;
  /** 这一层写在哪（环境变量名 / 配置文件路径 / 源码常量）。 */
  readonly location: string;
  /** 这一层的原始值（`null` 表示没写或不可见）。 */
  readonly value: string | null;
  /** 这一层当前的状态。 */
  readonly state: DiagnosisState;
  /** 给用户看的补充说明；没有就是 `null`。 */
  readonly note: string | null;
}

/** 诊断结论。 */
export interface Diagnosis {
  /** 三层，顺序恒为 env → patch → fallback。 */
  readonly rows: readonly DiagnosisRow[];
  /** 最终生效档位。 */
  readonly effective: RuntimeMode;
  /** 谁盖住了用户层；没有就是 `null`。 */
  readonly overriddenBy: DiagnosisLevel | null;
}

/**
 * `settings.describe` 的三段投影。三段都可能缺席（表单还在 loading，
 * 或者这个命名空间没被宿主服务）。
 */
export interface DiagnosisInput {
  /** 最终生效值，来自 `ConfigFormSnapshot.value`。 */
  readonly value?: unknown;
  /** 组合层，来自 `ConfigFormSnapshot.base`。 */
  readonly base?: unknown;
  /** 用户补丁层，来自 `ConfigFormSnapshot.user`。 */
  readonly user?: unknown;
}

/** 一个字段读出来的三件事。 */
interface FieldReading {
  /** 这一段里到底有没有这个键。 */
  readonly present: boolean;
  /** 原始文本形式；没写就是 `null`。 */
  readonly raw: string | null;
  /** 归一后的档位；写了但不合法就是 `null`。 */
  readonly mode: RuntimeMode | null;
}

/** 从一段投影里读一个字段。 */
function readField(section: unknown, key: string): FieldReading {
  if (section === null || typeof section !== 'object') return { present: false, raw: null, mode: null };
  const raw: unknown = Reflect.get(section, key);
  if (raw === undefined || raw === null) return { present: false, raw: null, mode: null };
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return { present: false, raw: null, mode: null };
    return { present: true, raw: trimmed, mode: coerceMode(trimmed) };
  }
  return { present: true, raw: String(raw), mode: null };
}

/** 三层各自的展示名。 */
const LABELS: Readonly<Record<DiagnosisLevel, string>> = {
  env: '环境变量',
  patch: 'Profile 补丁',
  fallback: '内置兜底',
};

/** 三层各自的位置文案。 */
const LOCATIONS: Readonly<Record<DiagnosisLevel, string>> = {
  env: DIAGNOSIS_ENV_NAME,
  patch: DIAGNOSIS_PATCH_LOCATION,
  fallback: DIAGNOSIS_FALLBACK_LOCATION,
};

/**
 * 按值归属推导诊断链。
 *
 * 规则只有一条：**谁的值等于最终生效值，谁就是命中的那一层**。
 * 浏览器侧看不到 env，所以当生效值既不等于补丁层、也不等于兜底值时，
 * 唯一能解释它的就是 env——这时 env 判 `hit`，并注明这是反推。
 * @param input - `settings.describe` 的三段投影。
 * @returns 三层诊断行、生效档位与被覆盖的层。
 */
export function diagnose(input: DiagnosisInput): Diagnosis {
  const user = readField(input.user, 'defaultMode');
  const base = readField(input.base, 'defaultMode');
  const value = readField(input.value, 'defaultMode');
  const effective: RuntimeMode = value.mode ?? DEFAULT_MODE;

  // 补丁层的有效值：用户层优先，用户层没写时看组合层。
  const patchMode = user.mode ?? base.mode;
  const patchRaw = user.raw ?? base.raw;
  const patchOrigin = user.mode !== null ? '用户层' : base.mode !== null ? '组合层' : null;

  // 生效值既不来自补丁层、也不来自兜底值——那只能是 env。
  const envInferred = effective !== (patchMode ?? DEFAULT_MODE);

  const rows: DiagnosisRow[] = [];

  // 第一层：env。浏览器永远看不到它的原文，只能反推。
  if (envInferred) {
    rows.push({
      level: 'env',
      label: LABELS.env,
      location: LOCATIONS.env,
      value: effective,
      state: 'hit',
      note: '宿主进程的环境变量在浏览器侧读不到；这一行是按「最终值与补丁层不一致」反推出来的。',
    });
  } else {
    rows.push({
      level: 'env',
      label: LABELS.env,
      location: LOCATIONS.env,
      value: null,
      state: 'unknown',
      note: '环境变量只在宿主进程里读取，浏览器侧无法判断它是否设置了与最终值相同的档位。',
    });
  }

  // 第二层：Profile 补丁（用户层优先，回落组合层）。
  if (patchRaw === null) {
    rows.push({
      level: 'patch',
      label: LABELS.patch,
      location: LOCATIONS.patch,
      value: null,
      state: 'absent',
      note: '没有写过补丁，档位由更低一层决定。',
    });
  } else if (patchMode === null) {
    rows.push({
      level: 'patch',
      label: LABELS.patch,
      location: LOCATIONS.patch,
      value: patchRaw,
      state: 'invalid',
      note: DIAGNOSIS_INVALID_PROBLEM,
    });
  } else if (patchMode === effective && !envInferred) {
    rows.push({
      level: 'patch',
      label: LABELS.patch,
      location: LOCATIONS.patch,
      value: patchRaw,
      state: 'hit',
      note: patchOrigin === '组合层' ? '这一值来自 profile 组合层，不是用户手写的。' : null,
    });
  } else {
    rows.push({
      level: 'patch',
      label: LABELS.patch,
      location: LOCATIONS.patch,
      value: patchRaw,
      state: 'shadowed',
      note: '这一层写了值，但被更高优先级的层盖住了。',
    });
  }

  // 第三层：内置兜底。
  //
  // 判据必须是「补丁层没给出这个值」而不是「生效值等于兜底值」：用户层写了
  // `full`（恰好等于 DEFAULT_MODE）时，兜底值也等于生效值，但命中的是补丁层。
  // 一行只能有一层 hit，否则面板会同时点亮两行，用户根本不知道该信哪个。
  if (!envInferred && patchMode !== effective) {
    rows.push({
      level: 'fallback',
      label: LABELS.fallback,
      location: LOCATIONS.fallback,
      value: DEFAULT_MODE,
      state: 'hit',
      note: null,
    });
  } else {
    rows.push({
      level: 'fallback',
      label: LABELS.fallback,
      location: LOCATIONS.fallback,
      value: DEFAULT_MODE,
      state: 'shadowed',
      note: '有更高优先级的层给了值，兜底没有生效。',
    });
  }

  return {
    rows,
    effective,
    overriddenBy: envInferred ? 'env' : patchRaw !== null && patchMode !== effective ? 'patch' : null,
  };
}
