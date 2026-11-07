/**
 * 技能描述的折叠与判长（纯函数，零 I/O，不 import node:）。
 *
 * 为什么要有这个模块：宿主把技能目录渲染成 catalog 时，对每条 description
 * 走 dsh-tool-skill/lib/index.js:1094-1097 的 catalogDescription：
 *   const normalized = value.replaceAll(/\s+/g, ' ').trim();
 *   return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 3)}...`;
 * 注意它数的是 UTF-16 code unit（String#length），不是码点，也不是字节。
 * 本模块必须与之逐字同口径，否则"本地判过、宿主判挂"或者反过来。
 *
 * 本模块的阈值（480）比宿主的上限（500）低 20：留给宿主那句
 * "...（已截断）"之外的拼接余量，也让人在本地跑的判长与目录里看到的长度一致。
 * 判定必须在折叠之后做 —— 上游技能的 description 全是折叠标量，
 * 源码里带换行，写的时候看着短、折叠后一数就超。
 */

/** 描述长度策略：max 是宿主上限，ours 是本仓库自己在写技能时把守的阈值。 */
export const DESCRIPTIONS_POLICY = { max: 500, ours: 480 } as const;

/**
 * 与宿主 catalogDescription 同口径的折叠：空白串收成一个空格、去掉首尾。
 * @param value - 原始描述（可能含换行、缩进）。
 * @returns 折叠后的单行字符串。
 */
export function foldDescription(value: string): string {
  // 正则必须是 /\s+/g 且不带 u 标志以外的分支：换成按码点切分会改变
  // 代理对与零宽字符的处理，与宿主对不上。
  return value.replaceAll(/\s+/g, ' ').trim();
}

/**
 * 照抄宿主 catalogDescription 的截断语义。
 *
 * 为什么保留这个函数而不是直接在 judgeDescription 里内联：
 * 它的 slice 按 UTF-16 切，正好会把 emoji 的代理对劈成两半、
 * 再拼上 "..." 产生一个孤立代理（渲染成 �）。这是宿主的既有行为，
 * 本仓库不修它（那是宿主的事），但必须把它钉进测试，表明"我们已知情"，
 * 也表明本地阈值 480 就是为了让大多数描述根本走不到这条切半路径。
 * @param value - 原始描述。
 * @param maxLength - 宿主上限（UTF-16 长度）。
 * @returns 折叠（必要时截断）后的字符串。
 */
export function truncateDescription(value: string, maxLength: number): string {
  const normalized = foldDescription(value);
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 3)}...`;
}

/** 判长结果。 */
export interface DescriptionJudgement {
  /** 折叠后的字符串（就是要写进目录文本的那份）。 */
  readonly folded: string;
  /** 折叠后的 UTF-16 长度。 */
  readonly length: number;
  /** 是否在阈值以内。 */
  readonly ok: boolean;
}

/**
 * 按本仓库阈值判定一条描述能否原样进目录。
 * @param raw - 原始描述（含换行、缩进都行）。
 * @param ours - 阈值，缺省取 DESCRIPTIONS_POLICY.ours（480）。
 * @returns 折叠串、长度与判定。
 */
export function judgeDescription(raw: string, ours: number = DESCRIPTIONS_POLICY.ours): DescriptionJudgement {
  const folded = foldDescription(raw);
  // 长度必须用 .length（UTF-16 code unit）：宿主就是用它比的。
  // [...s].length 数的是码点，含 emoji 的描述会少算一半，判过之后宿主仍然截断。
  const length = folded.length;
  return { folded, length, ok: length <= ours };
}
