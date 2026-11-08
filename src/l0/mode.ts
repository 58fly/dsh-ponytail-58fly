/**
 * L0 · 档位词汇表与唯一写入口。
 *
 * 本模块是四层依赖图的最底层：纯函数、零 I/O、不 import 任何其他层，
 * 也不 import 任何宿主包。它存在的唯一理由是消灭"写模式却各自归一化"
 * 这类垃圾态：入口有三处（环境变量、profile 补丁、命令层），每处各写一套
 * 归一化必然漂移，于是把「字符串 → 档位」收成唯一写入口 normalizeMode，
 * 其余地方只能调它，不许自己判。
 *
 * 档位取值域只有 off / lite / full / ultra。`review` 是一次性审查模式，
 * 不是档位：它由命令层与提示词渲染层各自处理，永不经 normalizeMode。
 * 因此本模块刻意不包含 review。
 */

/** 未配置、也未命中任何来源时的兜底档位。 */
export const DEFAULT_MODE = 'full';

/**
 * 档位取值域，顺序即强度顺序。
 *
 * 'off' 不是"无档位"，而是"档位关闭"：渲染层在 off 下产出空 section，
 * 宿主 assemble 会把它从结果里扔掉，这是预期行为。
 */
export const RUNTIME_MODES = ['off', 'lite', 'full', 'ultra'] as const;

/** 运行时档位。 */
export type RuntimeMode = (typeof RUNTIME_MODES)[number];

/**
 * 配置优先级的三层，顺序即优先级从高到低。
 *
 * 诊断报告恒为三项、恒按此顺序——缺一层也要出一项 hit:false，否则用户
 * 看不出"这一层没配"和"这一层配了但被盖住"的区别。
 */
export const PRIORITY_LEVELS = ['env', 'patch', 'fallback'] as const;

/** 配置来源层。 */
export type PriorityLevel = (typeof PRIORITY_LEVELS)[number];

/**
 * 类型守卫：判断字符串是否落在档位取值域内。
 * @param value - 待判定字符串。
 * @returns 是否是一个合法档位。
 */
export function isRuntimeMode(value: string): value is RuntimeMode {
  return RUNTIME_MODES.some((mode) => mode === value);
}

/**
 * 归一化任意输入为档位；这是本仓库**唯一**的写模式入口。
 *
 * 接受 unknown 而非 string：上游 normalizeMode 的签名收 string，函数体第一行
 * 却在判 `typeof mode !== 'string'`——类型与实现自相矛盾，调用方为了通过编译
 * 只能先写 `String(...)`（上游 ponytail-priority.ts:103 就是这么干的），
 * 于是 `String(undefined)` 变成字面量 "undefined" 再去比对，把"没有值"
 * 和"值是字符串 undefined"混为一谈。
 *
 * 这里接受 unknown，非字符串直接 null；不做 String() 强转，也不做任何兜底：
 * 拿不到合法值就诚实地返回 null，由调用方决定是回落到上一层还是报诊断。
 *
 * @param raw - 任何来源的原始值（环境变量、补丁文件、schema、用户输入）。
 * @returns 归一化后的档位，或 null（非法/缺失）。
 */
export function coerceMode(raw: unknown): RuntimeMode | null {
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim().toLowerCase();
  return isRuntimeMode(normalized) ? normalized : null;
}
