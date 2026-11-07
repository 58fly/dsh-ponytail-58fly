/**
 * L2 · volatile 字段的三态解包。
 *
 * 从 0.2.2 起，插件 Config 里带 `.volatile()` 的字段不再以裸值出现，而是被
 * schemastery 包成 `Volatile<T | undefined>` 引用：
 *
 * ```ts
 * interface Volatile<T> { get(): T }   // @deepseek-ai/cosmokit
 * ```
 *
 * 于是任一字段在运行时有且只有三种可能形状，**三者都必须处理**：
 *
 * 1. **Volatile 引用** —— 正常路径，插件 apply 收到的 effectiveConfig 就是它；
 *    字段缺席时 `.get()` 返回 `undefined`（不是字段消失）。
 * 2. **裸值** —— 单元测试、以及某些宿主内部路径里直接传对象给插件时出现。
 * 3. **`undefined`** —— 整个 config 都没给。
 *
 * 漏掉第 2 种会让纯函数测试全崩；漏掉第 1 种会让运行期把引用对象本身当成
 * 档位字符串——两者都是上游踩过的坑（`ponytail-config.ts` 的 `readVolatile`
 * 存在的唯一理由）。
 *
 * 为什么不直接 `import type { Volatile } from '@deepseek-ai/cosmokit'`：
 * 本包对宿主只有两个 peer（cordis、schemastery），cosmokit 是它们的传递依赖，
 * **不作为我们自己的类型来源**。用结构型最小接口判定，既不增加声明耦合，
 * 也能跨 ESM/CJS 双副本工作（判定只看有没有 `get` 方法）。
 */

/**
 * 结构型最小接口：任何带无参 `get()` 的对象都算 volatile 引用。
 *
 * 刻意不写 `Volatile<T>` 的完整形状（它还有 `[Symbol.toStringTag]` 之类的
 * 细节），因为我们要判定的只是「这是不是一个可以解包的引用」，不是
 * 「它是不是 cosmokit 造出来的那一个实例」。
 */
export interface VolatileLike<T> {
  get(): T;
}

/**
 * 判定一个值是不是 volatile 引用。
 * @param value - 任意值。
 * @returns 是引用则 `true`。
 */
export function isVolatileLike(value: unknown): value is VolatileLike<unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { readonly get?: unknown };
  return typeof candidate.get === 'function';
}

/**
 * 把字段的三态统一读成一个值。
 *
 * `.get()` 的返回值**不再二次解包**：schemastery 只包一层，嵌套 volatile 会
 * 在 schema 构造期就被 `validateVolatileSchema` 拒绝（`volatile fields require
 * a fixed object path without an enclosing volatile field`），所以这里假设
 * 单层是安全的。
 * @param value - 字段原文，可能是引用、裸值或 `undefined`。
 * @returns 解包后的值；引用指向缺席时返回 `undefined`。
 */
export function readVolatileField<T>(value: unknown): T | undefined {
  if (value === undefined || value === null) return undefined;
  if (isVolatileLike(value)) return value.get() as T;
  return value as T;
}
