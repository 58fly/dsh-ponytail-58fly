/**
 * 配置 schema：只声明"哪些键存在、每个键允许什么值"，不声明默认值。
 *
 * **为什么不写 .default()**（这是本仓库与上游最重要的一条分野）：
 * Cordis 在插件装载时用 `Config['~standard'].validate(raw)` 得到 effectiveConfig，
 * 声明了 .default() 的字段会在校验时被填成显式值。于是"用户没配"和"用户配了
 * 就是这个值"在校验之后完全不可区分——诊断面板会把兜底值报成"来自 Profile
 * 补丁"，这正是上游 B-02 类问题的同源病灶。默认值必须由 #04 的优先级链在
 * 运行时算出来，且三层来源各自留痕。
 *
 * 附带的好处：schemastery 的 `.default()` 与 `.volatile()` 实测互斥
 * （`z.string().default('x').volatile()` 校验 `undefined` 后 `.get()` 仍是
 * `undefined`），所以"不给默认值"这条定案在机制上也强制成立。
 *
 * **为什么每个 schema 常量都写了显式类型标注**（一条真实的 CI 事故教训）：
 * 只写 `const Config = z.object({...})` 时，声明的类型是推导出来的。`declaration: true`
 * 生成 .d.ts 需要给这个推导类型起名，于是 TypeScript 会把 schemastery 内部类型
 * 的**物理路径**写进声明文件。开发机上 schemastery 落在 node_modules 顶层，
 * 路径可移植；但 dsh 0.2.0-rc.1 / 0.2.1-rc.5 的 peer 解析把 schemastery 落到
 * `.pnpm/@deepseek-ai+schemastery@3.18.5/node_modules/...`，同一份源码就直接报
 *
 *   error TS2742: The inferred type of 'Config' cannot be named without a
 *   reference to '.pnpm/@deepseek-ai+schemastery@3.18.5/node_modules/@deepseek-ai/schemastery'.
 *   This is likely not portable. A type annotation is necessary.
 *
 * 显式标注把这个名字固定成 `Schemastery<...>`（schemastery 自己声明的全局类型），
 * 声明文件从此只引用包名而不引用物理路径，跨版本可移植。CI 的 compat 矩阵
 * 就是这条标注的看门人。
 *
 * **为什么三个字段全是 .volatile()**：0.2.2 的 `dsh-settings` 只把 volatile
 * 字段暴露到设置页（`volatileForm(schema)` 对非 volatile 的字段返回 `undefined`，
 * 条目直接从 `describe()` 里消失，写入还会抛 `has no volatile fields`）。
 * 不标 volatile 的字段对用户等于不存在：既看不见也改不了。而 **volatile 不等于
 * 有默认值**——字段缺席时引用照样存在，`.get()` 返回 `undefined`，#04 的优先级
 * 链正是在这个 `undefined` 上工作的。
 */
import z from '@deepseek-ai/schemastery';

import { RUNTIME_MODES, type RuntimeMode } from '../l0/mode.js';

/** 界面语言。技能正文按语言取不同描述文件。 */
type Locale = 'zh' | 'en';

/**
 * 运行时档位字段。const 联合，非法字符串在校验期就被拒——
 * 上游把这个校验推迟到 normalizeMode（且只在部分调用点生效），
 * 导致环境变量写垃圾值能一路进到运行时。
 *
 * const 列表由 L0 的 RUNTIME_MODES 生成而非手抄：档位加一个值只改一处，
 * 且方向正确——config 依赖 L0，L0 不依赖 config。
 */
const modeSchema: Schemastery<RuntimeMode, RuntimeMode> = z.union(
  RUNTIME_MODES.map((mode) => z.const(mode)),
);

const localeSchema: Schemastery<Locale, Locale> = z.union([z.const('zh'), z.const('en')]);

/**
 * 字段表。单独抽成 interface 是为了让 `Config` 的类型标注可读：
 * 每个字段都是一个 schema，`ObjectS` / `ObjectT` 从这里推出输入与输出形状。
 *
 * 第三类型参数 `'volatile'` 是必须的：`.volatile()` 把 schema 的 Mode 从
 * `'plain'` 切成 `'volatile'`，输出类型随之从 `T` 变成 `Volatile<T | undefined>`。
 * 漏写第三参会让 `ObjectT<ConfigShape>` 算成裸值，与运行时形状不符。
 */
export interface ConfigShape {
  readonly defaultMode: Schemastery<RuntimeMode, RuntimeMode, 'volatile'>;
  readonly skillDir: Schemastery<string, string, 'volatile'>;
  readonly locale: Schemastery<Locale, Locale, 'volatile'>;
}

/**
 * 插件配置。
 *
 * 键名与语义：
 * - `defaultMode`：用户期望的默认档位，缺省由优先级链兜底（见 #04）。
 * - `skillDir`：技能目录，相对路径按 DSH_HOME 解析（见 L0 的 resolveSkillDir）。
 * - `locale`：技能描述语言。
 *
 * 三个字段都不给默认值，理由见文件头。
 */
export const Config: Schemastery<
  Schemastery.ObjectS<ConfigShape>,
  Schemastery.ObjectT<ConfigShape>
> = z.object({
  defaultMode: modeSchema.volatile(),
  skillDir: z.string().volatile(),
  locale: localeSchema.volatile(),
});

/**
 * 校验后配置的形状。
 *
 * 用 `Schemastery.TypeT` 而不是 `z.infer`：`z` 是默认导出的值，不是命名空间，
 * `z.infer` 在 verbatimModuleSyntax 下直接类型报错
 * （'z' only refers to a type, but is being used as a namespace here）。
 *
 * 这里描述的是"字段齐全"的形态；运行时 validate(undefined) 可能得到空对象
 * （schemastery 的 ObjectS 每项可选），所以 apply 的入参可以用 Partial<...>，
 * 缺什么由 #04 的优先级链兜底。
 *
 * **每个字段的类型是 `Volatile<T | undefined>` 而不是 `T`**——读它必须经
 * `src/config/volatile.ts` 的三态解包，直接当裸值用会在运行期拿到一个
 * 引用对象。（类型系统在这里恰好帮了忙：把引用当字符串用会报错。）
 */
export type PonytailConfig = Schemastery.TypeT<typeof Config>;
