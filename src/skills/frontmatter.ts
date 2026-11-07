/**
 * SKILL.md 的 frontmatter 解析（最小实现）。
 *
 * 为什么本票就要它：宿主 dsh-skill 在 validateCandidate（lib/index.js:452-462）
 * 对候选项做硬校验，其中 :456 是
 *   if (candidate.description.length === 0) throw new Error(...)
 * 也就是"只读目录名、description 给空串"的极简 provider 在真实宿主上一跑就会让
 * 整个 ctx.skills.list() 抛错、技能目录变成不可用。同一个函数里还校验 name 必须
 * 匹配 SKILL_NAME、provider 必须等于注册名、rank 必须有限。这些约束本模块与
 * provider.ts 逐条满足，test/composition.test.mjs 逐条断言。
 *
 * 解析范围刻意小于 #10：
 * - 支持 key: value、折叠标量 >、字面块 |（上游六个技能的 description 全是折叠标量）；
 * - 不解析嵌套结构、不解析多文档、不做类型转换（除调用策略的两个布尔键外，全部按字符串处理）；
 * - 不用 yaml 库：v0.1 的运行时依赖定案是"零依赖"（见地图 Decisions），
 *   frontmatter 只有十几个键的平面形状，逐行读足够。
 *
 * 调用策略（disable-model-invocation / user-invocable）本版已收：
 * 宿主 validateInvocation（lib/index.js:505-510）只要 invocation 给了对象，
 * modelInvocable 与 userInvocable 就必须都是布尔，否则抛 TypeError 让整条
 * catalog 不可用。所以本模块要么给出"两值齐全"的对象，要么整块不下发。
 */
import { readFile } from 'node:fs/promises';

/**
 * 旧的调用策略键：上游 dsh-skill 内部模型用的名字。
 *
 * 为什么必须点名报错而不是静默忽略：SKILL.md 是给人手写的文件，
 * 用户照着 SDK 类型写 modelInvocable: false 时，若被当成未知键丢弃，
 * 技能依旧会被模型自动调用——"配置写了、行为没变、还没有任何提示"
 * 是比报错更贵的故障。所以出现即抛错，并在错误里给出新键拼写。
 */
export const LEGACY_INVOCATION_KEYS = ['disableModelInvocation', 'modelInvocable', 'userInvocable'] as const;

/** frontmatter 里实际接受的两个调用策略键（kebab-case，YAML 惯例）。 */
export const INVOCATION_KEYS = ['disable-model-invocation', 'user-invocable'] as const;

/** 调用策略；与宿主 SkillInvocation 结构一致，两值必须同时给出。 */
export interface SkillInvocation {
  /** 模型能否自动调用；由 disable-model-invocation 反向得到。 */
  readonly modelInvocable: boolean;
  /** 用户能否用 /name 手动调用。 */
  readonly userInvocable: boolean;
}

/** 解析结果：只保留本插件真正消费的键。 */
export interface SkillFrontmatter {
  /** 技能名；缺省时调用方应回落到目录名。 */
  readonly name?: string;
  /** 技能描述；宿主强制非空。 */
  readonly description?: string;
  /** 何时使用；可选，宿主不强制。 */
  readonly whenToUse?: string;
  /** 调用策略；两个键都缺省时为 undefined（宿主缺省即两者都可）。 */
  readonly invocation?: SkillInvocation;
  /** frontmatter 之后的正文（已 trim）。 */
  readonly body: string;
}

/**
 * frontmatter 内容本身非法（旧键、非布尔值等）。
 *
 * 为什么单独一个错误类型：readSkillMarkdown 只应把"文件读不到"折成空结果，
 * 必须把"文件读到了、但写错了"原样抛给调用方——那是用户要修的东西，
 * 吞掉就变成静默丢技能。
 */
export class SkillFrontmatterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkillFrontmatterError';
  }
}

/** 空结果，用于文件读不到时。 */
const EMPTY: SkillFrontmatter = { body: '' };

/** 旧键 → 新键的对照，只用于错误信息（键顺序与 LEGACY_INVOCATION_KEYS 一致）。 */
const LEGACY_KEY_REPLACEMENT: Readonly<Record<string, string>> = {
  disableModelInvocation: '"disable-model-invocation"',
  modelInvocable: '"disable-model-invocation"（布尔反向）与 "user-invocable"',
  userInvocable: '"user-invocable"',
};

/**
 * 从 SKILL.md 文本里切出 frontmatter 与正文。
 * @param text - 文件全文。
 * @returns 解析结果；没有合法 frontmatter 时 body 为全文、其余字段缺省。
 * @throws SkillFrontmatterError 调用策略字段非法时。
 */
export function parseSkillMarkdown(text: string): SkillFrontmatter {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  if ((lines[0] ?? '').trim() !== '---') return { body: normalized.trim() };
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end === -1) return { body: normalized.trim() };
  const header = lines.slice(1, end);
  const body = lines.slice(end + 1).join('\n').trim();
  const fields = readFields(header);
  const invocation = readInvocation(fields);
  return {
    ...(fields['name'] !== undefined ? { name: fields['name'] } : {}),
    ...(fields['description'] !== undefined ? { description: fields['description'] } : {}),
    ...(fields['whenToUse'] !== undefined ? { whenToUse: fields['whenToUse'] } : {}),
    ...(invocation !== undefined ? { invocation } : {}),
    body,
  };
}

/**
 * 逐行读 key: value，并把 > / | 块收拢成单行。
 * @param header - frontmatter 内部的行。
 * @returns 键到值的映射；空值被丢弃。
 * @throws SkillFrontmatterError 出现旧调用策略键时。
 */
function readFields(header: readonly string[]): Record<string, string> {
  const fields: Record<string, string> = {};
  for (let index = 0; index < header.length; index += 1) {
    const line = header[index] ?? '';
    const match = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (match === null) continue;
    const key = match[1] ?? '';
    const rawValue = (match[2] ?? '').trim();
    // 旧键的报错必须排在取值解析之前：若先把 modelInvocable: 后面的块当成字符串读走，
    // 旧键就会被"成功"解析成一个未知字段，用户写了等于没写。
    if (LEGACY_INVOCATION_KEYS.some((legacy) => legacy === key)) {
      throw new SkillFrontmatterError(
        `frontmatter 用了旧键 "${key}"，新键是 ${LEGACY_KEY_REPLACEMENT[key] ?? "(未知)"}；` +
          `本插件只认 ${INVOCATION_KEYS.map((name) => `"${name}"`).join(' 与 ')}。`,
      );
    }
    if (rawValue === '>' || rawValue === '|' || rawValue === '>-' || rawValue === '|-') {
      const block: string[] = [];
      let cursor = index + 1;
      while (cursor < header.length && /^\s+\S/.test(header[cursor] ?? '')) {
        block.push((header[cursor] ?? '').trim());
        cursor += 1;
      }
      index = cursor - 1;
      // '>' 折叠成空格，'|' 保留换行；两者对 description 都可用，宿主只要求非空。
      const joined = rawValue.startsWith('>') ? block.join(' ').trim() : block.join('\n').trim();
      if (joined.length > 0) fields[key] = joined;
      continue;
    }
    // 去掉包裹引号（YAML 允许 'x' / "x"）。
    const unquoted = /^'(.*)'$/.exec(rawValue)?.[1] ?? /^"(.*)"$/.exec(rawValue)?.[1] ?? rawValue;
    if (unquoted.length > 0) fields[key] = unquoted;
  }
  return fields;
}

/**
 * 把两个调用策略键折成宿主要求的对象。
 * @param fields - 已读到的键值对。
 * @returns 两键都缺省时 undefined；否则两值齐全的对象。
 * @throws SkillFrontmatterError 出现非布尔值（含空值）时。
 */
function readInvocation(fields: Readonly<Record<string, string>>): SkillInvocation | undefined {
  const disableKey = INVOCATION_KEYS[0];
  const userKey = INVOCATION_KEYS[1];
  const disableRaw = fields[disableKey];
  const userRaw = fields[userKey];
  // readFields 会丢弃空值（`user-invocable:` 后面什么都不写），所以空值在这里表现为
  // "键不存在"，按缺省处理；只有写了非 true/false 的值才由 readBool 报错。
  // 这样 `disable-model-invocation:` 写在模板里留空，不会让整个技能目录抛错。
  if (disableRaw === undefined && userRaw === undefined) return undefined;
  // disable-model-invocation 是"禁用"语义，与 modelInvocable 反向；缺省时可调用（disable = false）。
  const disableModel = disableRaw === undefined ? false : readBool(disableRaw, disableKey);
  const userInvocable = userRaw === undefined ? true : readBool(userRaw, userKey);
  return { modelInvocable: !disableModel, userInvocable };
}

/**
 * 把一个原始值读成布尔。
 * @param raw - 已去引号的值。
 * @param key - 键名，只用于错误信息。
 * @returns 布尔值。
 * @throws SkillFrontmatterError 值不是 true / false（大小写不敏感）时。
 */
function readBool(raw: string, key: string): boolean {
  const lowered = raw.toLowerCase();
  if (lowered === 'true') return true;
  if (lowered === 'false') return false;
  throw new SkillFrontmatterError(
    `frontmatter 的 "${key}" 只接受 true 或 false（大小写不敏感），实际是 "${raw}"；` +
      '宿主校验要求布尔值，写成 yes/no 会在装载时被拒绝。',
  );
}

/**
 * 读一个 SKILL.md 并解析。
 * @param path - SKILL.md 绝对路径。
 * @returns 解析结果；文件不存在或读失败时返回 EMPTY。
 * @throws SkillFrontmatterError 文件读得到但 frontmatter 非法时（不折成 EMPTY，
 * 否则用户写的旧键会静默失效）。
 */
export async function readSkillMarkdown(path: string): Promise<SkillFrontmatter> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return EMPTY;
  }
  // 解析放在 try 之外：只有 I/O 失败才折成空结果，内容错误必须透传。
  return parseSkillMarkdown(text);
}
