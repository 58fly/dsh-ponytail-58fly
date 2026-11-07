/**
 * L1 · 配置优先级链与诊断报告。
 *
 * 用户问「为什么我改了没用」时，插件必须能指出**是哪一层盖住了它**。
 * 本模块把这个问题的答案固化成一个恒定形状的数据结构：无论配置长什么样，
 * 报告恒为三项、恒按 `PRIORITY_LEVELS` 顺序（env → patch → fallback）。
 * 缺一层也要出一项 `hit: false` —— 否则用户看不出「这一层没配」和
 * 「这一层配了但被上面盖住」的区别，而那正是他们最需要分清的两种情形。
 *
 * **纯函数、零 I/O、零宿主依赖**：环境变量由调用方读好传进来，补丁值由
 * 调用方从活引用里解包好传进来。这样 04 的四条验收里有三条可以在单元测试
 * 里直接构造，不需要起 Cordis 上下文。
 *
 * 与上游 `ponytail-priority.ts` 的三处分歧（都是缺陷修正，不是风格偏好）：
 *
 * 1. **不做 `String()` 强转**。上游末尾写
 *    `normalizeMode(String(chain[...].value)) ?? DEFAULT_MODE`，于是
 *    `String(undefined)` 变成字面量 `"undefined"` 再拿去比对——把
 *    「没有值」和「值是字符串 undefined」混为一谈。本模块只认
 *    {@link coerceMode} 的 `unknown` 入口，非字符串直接 null。
 * 2. **shadowed 只在真有值且合法时才置真**。上游是
 *    `shadowed = winner !== -1 && winner < i`，于是 fallback 生效时
 *    env 与 patch 两层即使根本没配也会被标成「被盖住」，诊断面板会对
 *    用户撒谎。本模块要求 `mode !== null` 才算「有值可被盖」。
 * 3. **problem 与 shadowed 互斥**。值非法时它是「被忽略」而不是
 *    「被盖住」——两种状态的修复动作完全不同（改值 vs 删上层）。
 */
import {
  DEFAULT_MODE,
  PRIORITY_LEVELS,
  coerceMode,
  type PriorityLevel,
  type RuntimeMode,
} from '../l0/mode.js';

/**
 * 档位环境变量名。
 *
 * 与上游 `PONYTAIL_DEFAULT_MODE` 同名：这是唯一一个「用户已经在用」的
 * 对外契约，改名会让既有部署静默失效。新的包名体现在插件 id 与设置页
 * 命名空间上，不体现在环境变量上。
 */
export const PRIORITY_ENV_NAME = 'PONYTAIL_DEFAULT_MODE';

/** 补丁层在磁盘上的位置，用于诊断面板的 location 列。 */
export const PATCH_LOCATION = 'cordis.patch.yml → ponytail-58fly.config.defaultMode';

/** 兜底层在源码里的位置，用于诊断面板的 location 列。 */
export const FALLBACK_LOCATION = 'src/l0/mode.ts → DEFAULT_MODE';

/**
 * 值非法时的固定说明。措辞要能让用户知道「不是没读到，是读到了但不认」。
 *
 * 导出是为了让 `test/client-diagnosis.test.mjs` 能用它钉住客户端那条链的
 * 同名字面量（`DIAGNOSIS_INVALID_PROBLEM`）：两条链口径必须逐字一致。
 */
export const INVALID_PROBLEM = '值无效，已忽略';

/** 每一层的展示名与出处。 */
interface LevelDescriptor {
  readonly label: string;
  readonly location: string;
}

const LEVELS: Readonly<Record<PriorityLevel, LevelDescriptor>> = {
  env: { label: '环境变量', location: PRIORITY_ENV_NAME },
  patch: { label: 'Profile 补丁', location: PATCH_LOCATION },
  fallback: { label: '内置兜底', location: FALLBACK_LOCATION },
};

/**
 * 诊断报告里的一层。
 *
 * 六个字段是**面板需要的全部**，不多不少：
 * - `label` / `location`：告诉用户「去哪改」；
 * - `value`：告诉用户「那一层现在写的是什么」（原样，不归一）；
 * - `hit`：告诉用户「生效的是不是它」；
 * - `shadowed`：告诉用户「它有值但被上面盖住了」；
 * - `problem`：告诉用户「它为什么没参与竞争」。
 */
export interface PrioritySource {
  readonly level: PriorityLevel;
  readonly label: string;
  readonly location: string;
  readonly value: string | null;
  readonly hit: boolean;
  readonly shadowed: boolean;
  readonly problem: string | null;
}

/** 一份完整诊断：三层明细 + 最终生效档位。 */
export interface PriorityReport {
  readonly chain: readonly PrioritySource[];
  readonly effective: RuntimeMode;
}

/** {@link resolvePriority} 的入参。三层里只有前两层需要外部提供。 */
export interface PriorityInput {
  /** 环境变量原文，未设置时传 undefined。 */
  readonly env?: unknown;
  /** Profile 补丁里的原文（已从 volatile 引用解包），未配置时传 undefined。 */
  readonly patch?: unknown;
  /**
   * 最近一次写配置被宿主拒绝的原因，可选。
   * 有值时并进 patch 层的 problem —— 这是「用户改了没生效」的最常见成因：
   * 值写下去了，但宿主校验拒绝了它，文件里还是旧值。
   */
  readonly rejected?: string | null;
}

/**
 * 一层的读取结果。
 *
 * `present` 与 `mode` 必须分开：`present && mode === null` 才是「配了但非法」，
 * 合并成一个 `null` 就丢掉了这个最关键的区别。
 */
interface LevelReading {
  readonly present: boolean;
  readonly value: string | null;
  readonly mode: RuntimeMode | null;
}

/**
 * 把一个任意来源的原始值读成一层。
 *
 * 空白字符串按「未设置」处理，与 L0 `resolveDshHome` 的 env 语义一致：
 * `PONYTAIL_DEFAULT_MODE=` 是「清空」，不是「配了个空档位」。
 * @param raw - 原始值。
 * @returns 该层的读取结果。
 */
function readLevel(raw: unknown): LevelReading {
  if (raw === undefined || raw === null) return { present: false, value: null, mode: null };
  const mode = coerceMode(raw);
  if (typeof raw === 'string') {
    const folded = raw.replaceAll(/\s+/g, ' ').trim();
    if (folded === '') return { present: false, value: null, mode: null };
    return { present: true, value: mode ?? folded, mode };
  }
  const text = typeof raw === 'number' || typeof raw === 'boolean' ? String(raw) : JSON.stringify(raw);
  return { present: true, value: mode ?? text ?? null, mode };
}

/**
 * 算出一份诊断报告。
 *
 * 竞争规则与用户直觉一致：从上往下，第一个**取值合法**的层获胜。
 * 非法值不淘汰这一层之后的竞争资格吗？—— 淘汰。理由：用户把环境变量
 * 写成垃圾时，他希望的是「这行配置当没写」，而不是「插件偷偷回落到
 * 更弱的来源」。所以非法值被记为 `problem`，然后继续往下找。
 * @param input - 三层原文。
 * @returns 诊断报告；`effective` 恒为合法档位。
 */
export function resolvePriority(input: PriorityInput): PriorityReport {
  const readings: readonly LevelReading[] = [readLevel(input.env), readLevel(input.patch)];
  const fallback: LevelReading = { present: true, value: DEFAULT_MODE, mode: DEFAULT_MODE };
  const all: readonly LevelReading[] = [...readings, fallback];

  let winner = -1;
  for (let index = 0; index < all.length; index += 1) {
    if (all[index]?.mode !== null) {
      winner = index;
      break;
    }
  }

  const rejected = input.rejected ?? null;
  const chain: PrioritySource[] = all.map((reading, index) => {
    const level = PRIORITY_LEVELS[index] ?? 'fallback';
    const descriptor = LEVELS[level];
    const hit = index === winner;
    let problem: string | null = reading.present && reading.mode === null ? INVALID_PROBLEM : null;
    if (level === 'patch' && rejected !== null) {
      problem = problem === null ? rejected : `${problem}；${rejected}`;
    }
    return {
      level,
      label: descriptor.label,
      location: descriptor.location,
      value: reading.value,
      hit,
      shadowed: !hit && reading.mode !== null,
      problem,
    };
  });

  const effective = all[winner]?.mode ?? DEFAULT_MODE;
  return { chain, effective };
}
