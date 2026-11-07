/**
 * skills 模块：把 `skills/` 目录下的技能暴露给宿主技能目录。
 *
 * 边界（本票只立契约与最小可用实现）：
 * - 只实现宿主 `SkillProvider` 的三件套 `{ name, list, get }`；
 * - 不做"技能开关"（v0.1 明确不做，见地图 Not yet specified）；
 * - `list` 在目录不存在时返回空数组且不抛错——宿主把空数组当"这个 provider
 *   暂时没东西"，抛错会让整个 catalog 变成 incomplete。
 *
 * **越界一律降级**（地图 Destination 判据 8）：`skillDir` 下任何条目，只要它的
 * 真实路径落在 `skillDir` 之外（符号链接指向别处、`locator` 被伪造成绝对路径），
 * 就 warn 并跳过/返回 undefined，**不抛错**。理由是同一件事：一次抛错会让整条
 * catalog 变 incomplete，六个技能一个都用不了——而"目录里混进一个越界项"是用户
 * 环境问题，不该让插件整体熄火。判定必须两侧都 `realpath`：macOS 的
 * `/var/folders/…` 真实位置是 `/private/var/folders/…`，只规约一侧会把全部
 * 正常技能判成越界（本机实测）。
 *
 * **为什么本票就要解析 frontmatter**：宿主 `dsh-skill` 在
 * `validateCandidate`（`lib/index.js:452-462`）对候选做硬校验，其中
 * `:456` 是 `if (candidate.description.length === 0) throw new Error(`skill
 * provider "${providerName}" returned skill "${candidate.name}" without a
 * description`)`。也就是说"只读目录名、description 给空串"的极简 provider
 * 在真实宿主上一跑就让整个 `ctx.skills.list()` 抛错。同一个函数里还校验
 * `name` 必须匹配 `SKILL_NAME`、`provider` 必须等于注册名、`rank` 必须有限。
 * 这些约束本文件逐条满足，测试也逐条断言（见 `test/composition.test.mjs`）。
 *
 * 这里刻意**不用** `readdir` 的 signal 选项：@types/node 的
 * `fs/promises.readdir` 没有 signal 重载（只有 `withFileTypes`/`recursive`），
 * 上游为了让 `{ withFileTypes: true, signal }` 通过编译，手写了一个
 * `readdirOpts` 类型再断言——正是我们要消灭的 `as` 来源之一。
 * 目录读取是微秒级操作，不值得为它引入断言；真正需要中断的是文件读取。
 */
import { readdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';

import type { Context } from '@deepseek-ai/cordis';
// **全部是 type-only 导入**：宿主 profile 里没有 @deepseek-ai/dsh-skill 这个包
// （实测 `createRequire('~/.dsh/profiles/desktop/package.json').resolve` 对它报
// MODULE_NOT_FOUND，只有 schemastery 与 cordis 之类被宿主装进 profile）。
// 留一个值导入就会在产物里写出 `import '@deepseek-ai/dsh-skill'`，
// 安装后第一次装载就 ERR_MODULE_NOT_FOUND。上游对这两个包也全是 import type。
import type { SkillCandidate, SkillDefinition, SkillProvider } from '@deepseek-ai/dsh-skill';

import { describeError } from '../l0/errors.js';
import { isWithinRoot } from '../l0/within.js';
import { SkillFrontmatterError, readSkillMarkdown } from './frontmatter.js';

/** 本 provider 在宿主注册表里的名字；与包名一致，便于日志定位。 */
export const PROVIDER_NAME = 'ponytail-58fly';

/**
 * 宿主内置技能的排位（`@deepseek-ai/dsh-skill/lib/types/index.d.ts` 里的
 * `export declare const BUNDLED_SKILL_RANK = 600`）。
 *
 * 刻意抄成本地常量而不是从包里 import：那个包在宿主 profile 里不可解析
 * （见文件头），值导入会让产物带上一条必炸的运行时依赖。正确性由
 * `test/composition.test.mjs` 断言"真实的 BUNDLED_SKILL_RANK 大于本常量"来兜。
 */
export const BUNDLED_SKILL_RANK = 600;

/**
 * 技能在目录里的排位。
 *
 * 必须严格小于宿主的 `BUNDLED_SKILL_RANK`（= 600）：同名技能时 rank 小的赢，
 * 内置包永远不该盖住插件自带的技能。上游取 550，沿用。
 */
export const PONYTAIL_SKILL_RANK = 550;

/** 六个技能目录名，与 `skills/` 下的目录一一对应。 */
export const SKILL_IDS = [
  'ponytail',
  'ponytail-review',
  'ponytail-audit',
  'ponytail-debt',
  'ponytail-gain',
  'ponytail-help',
] as const;

/** 技能 id 的类型。 */
export type SkillId = (typeof SKILL_IDS)[number];

/** 装配参数。 */
export interface SkillProviderOptions {
  /** 技能目录绝对值。 */
  readonly skillDir: string;
  /** 跳过条目时的告警出口；缺省静默（测试与降级路径用）。 */
  readonly warn?: (message: string) => void;
}

/** provider 用来在 list 与 get 之间传递的最小元数据，宿主当不透明对象透传。 */
interface SkillLocator {
  /** SKILL.md 的绝对路径。 */
  readonly path: string;
}

/**
 * 创建一个只读的目录型 provider。
 *
 * **`get` 的第一个参数是 candidate 对象，不是技能名**——上游按名字取，
 * 于是每次都要重新拼路径。宿主已经把 `locator` 透传回来了，直接用。
 * @param options - 装配参数。
 * @returns provider 实例。
 */
export function createSkillProvider(options: SkillProviderOptions): SkillProvider {
  const { skillDir, warn } = options;
  // 围栏根的 realpath 只算一次（惰性）：list 每个条目都要用它判越界，
  // 每条目解析一遍根纯属浪费，而 skillDir 在一次装配内不会变。
  // null 表示目录压根不存在——那是正常的"还没装技能"，不是错误。
  let root: Promise<string | null> | undefined;
  const rootOf = (): Promise<string | null> => {
    root ??= realpath(skillDir).catch((error: unknown) => {
      if (isMissingDirectory(error)) return null;
      throw error;
    });
    return root;
  };
  return {
    name: PROVIDER_NAME,
    async list(): Promise<readonly SkillCandidate[]> {
      const fence = await rootOf();
      if (fence === null) return [];
      const entries = await readdir(skillDir, { withFileTypes: true }).catch((error: unknown) => {
        if (isMissingDirectory(error)) return null;
        throw error;
      });
      if (entries === null) return [];
      const candidates: SkillCandidate[] = [];
      for (const entry of entries) {
        // 点开头先挡掉：它既不是技能也不是越界候选，省一次 realpath。
        if (entry.name.startsWith('.')) continue;
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        const entryPath = join(skillDir, entry.name);
        let realEntry: string;
        try {
          realEntry = await realpath(entryPath);
        } catch (error: unknown) {
          if (!isMissingDirectory(error)) throw error;
          // 悬空符号链接（指向已删除的目标）走这里：跳过这一条，别拖垮目录。
          warn?.(`技能 ${entry.name} 的目录无法解析，已跳过：${entryPath}（${describeError(error)}）`);
          continue;
        }
        // 符号链接收口：目录项是链接、或链接指向根目录之外，一律拒绝。
        // 判定两侧都必须是 realpath 之后的路径（见文件头 macOS 说明）。
        if (!isWithinRoot(fence, realEntry)) {
          warn?.(`技能 ${entry.name} 的真实路径不在技能目录内，已跳过：${realEntry}（技能目录 ${fence}）`);
          continue;
        }
        const path = join(realEntry, 'SKILL.md');
        // **单个技能写错不能拖垮整份目录**：frontmatter 非法（旧调用策略键、
        // 非布尔值）时 readSkillMarkdown 抛 SkillFrontmatterError，宿主那边
        // 一次 list() 抛错就让整条 catalog 变 incomplete，六个技能一个都用不了。
        // 所以按技能粒度收口：告警 + 跳过这一条，其余照常出现。
        // 但错误信息要原样带出来——用户必须知道是哪个文件、哪个键写错了，
        // 否则「技能不见了」变成一个无从下手的黑箱。
        let parsed;
        try {
          parsed = await readSkillMarkdown(path);
        } catch (error: unknown) {
          const detail = error instanceof SkillFrontmatterError ? error.message : String(error);
          warn?.(`技能 ${entry.name} 的 frontmatter 非法，已跳过：${path}（${detail}）`);
          continue;
        }
        // 目录名是事实来源：上游允许 frontmatter 里写别的名字，只会让目录页与
        // 调用名对不上。这里直接用目录名，frontmatter 的 name 只在缺失时参与判断。
        const name = entry.name;
        const description = parsed.description?.trim() ?? '';
        if (description.length === 0) {
          // 空描述会让整个 catalog 抛错（见文件头），代价太大；跳过单条并告警。
          warn?.(`技能 ${name} 缺少 description，已跳过：${path}`);
          continue;
        }
        const locator: SkillLocator = { path };
        candidates.push({
          name,
          description,
          ...(parsed.whenToUse !== undefined ? { whenToUse: parsed.whenToUse } : {}),
          // frontmatter 没写调用策略时取宿主缺省（两者都可）——#10 的定案：
          // 六个技能全部可被模型自动调用，也全部可被 /name 手动调用。
          invocation: parsed.invocation ?? { modelInvocable: true, userInvocable: true },
          source: 'bundled',
          provider: PROVIDER_NAME,
          rank: PONYTAIL_SKILL_RANK,
          locator,
          path,
        });
      }
      return candidates;
    },
    async get(candidate: SkillCandidate): Promise<SkillDefinition | undefined> {
      const declared = (candidate.locator as SkillLocator | undefined)?.path ?? candidate.path;
      if (declared === undefined) return undefined;
      // `locator` 是宿主透传的**不透明对象**，但它的内容来自我们自己的 list()，
      // 而 list() 只产出对得上的路径。真正的入口在宿主之外：一个被篡改的
      // candidate（或未来某个把 locator 当 URL 用的调用方）能把任意绝对路径塞进
      // 来。所以这里不复信 locator，重新走一遍跟 list 一样的围栏：
      // realpath → 判是否在根内 → 越界返 undefined（**不抛错**，见文件头）。
      const fence = await rootOf();
      if (fence === null) return undefined;
      let path: string;
      try {
        path = await realpath(declared);
      } catch (error: unknown) {
        // 目录不存在、指向已删目标、权限不足：都是"这个技能现在读不到"，
        // 与宿主 dsh-skill-filesystem 的处理一致（isAbsentSkillPathError → undefined）。
        if (!isMissingDirectory(error)) throw error;
        return undefined;
      }
      if (!isWithinRoot(fence, path)) {
        warn?.(`技能 ${candidate.name} 的真实路径不在技能目录内，已拒绝读取：${path}（技能目录 ${fence}）`);
        return undefined;
      }
      const parsed = await readSkillMarkdown(path);
      if (parsed.body.length === 0) return undefined;
      return {
        name: candidate.name,
        description: candidate.description,
        ...(parsed.whenToUse !== undefined ? { whenToUse: parsed.whenToUse } : {}),
        invocation: candidate.invocation,
        source: candidate.source,
        provider: PROVIDER_NAME,
        resourceBase: { kind: 'directory', path: join(path, '..') },
        path,
        content: parsed.body,
      };
    },
  };
}

/**
 * 把 provider 注册进宿主。
 *
 * `registerProvider` 收的是"控制面 → provider"的工厂，不是 provider 实例：
 * 宿主在注册时把它自己那把 AbortSignal 与 invalidate 交给你，注册被撤销后
 * signal 会 abort。上游写成 `() => provider`，丢掉了这两个能力。
 * @param ctx - 宿主上下文，必须已提供 skills 服务。
 * @param options - 装配参数。
 * @returns 注销函数。
 */
export function installSkills(ctx: Context, options: SkillProviderOptions): () => void {
  return ctx.skills.registerProvider(() =>
    createSkillProvider({
      skillDir: options.skillDir,
      warn: options.warn ?? ((message) => ctx.logger.warn(message)),
    }),
  );
}

/** 区分"目录不存在"（正常，返回空目录）与"读目录出错"（要炸）。 */
function isMissingDirectory(error: unknown): boolean {
  const code = (error as { readonly code?: unknown } | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/** rank 必须小于宿主内置，供测试与 verify 脚本断言。 */
export const RANK_IS_BELOW_BUNDLED = PONYTAIL_SKILL_RANK < BUNDLED_SKILL_RANK;