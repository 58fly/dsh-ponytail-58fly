/**
 * prompt · 围栏状态机。
 *
 * 只回答一个问题：**哪些行在 markdown 围栏代码块内**。它不参与裁剪，
 * 也不认识档位——裁剪逻辑在 `ladder.ts`，两者分开是因为围栏判定有独立的
 * 规范可对齐（CommonMark 0.31 §4.5），而形状识别是本插件自己的事。
 *
 * 为什么必须有它：上游 `filterSkillBodyForMode`（src/ponytail-instructions.ts:6-26）
 * 纯按行的文本形状裁剪，于是在围栏里写「文档示例」的表格/列表行会被当成真档位行删掉。
 * `docs/research/ponytail-prototype-fence-and-composition.md` §1.3 的四条夹具实测：
 * 上游在 F1 误删围栏内 4 行、F3 误删 4 行、F4 误删 6 行；围栏感知版全部为 0。
 *
 * 六条规则逐条对齐规范，也逐条有单测（test/fence.test.mjs）：
 *
 * | # | 规则 | 反例 |
 * |---|---|---|
 * | 1 | 开围栏 = ≤3 空格缩进 + ≥3 个反引号或波浪号 | 4 空格缩进是缩进代码块 |
 * | 2 | 反引号围栏的 info string 不得含反引号 | `\`\`\` a\`b` 不是开围栏；波浪号围栏允许 |
 * | 3 | 闭围栏必须与开围栏同字符 | `~~~` 不能闭合反引号围栏 |
 * | 4 | 闭围栏长度 ≥ 开围栏长度 | 4 反引号围栏内的三反引号行是内容 |
 * | 5 | 闭围栏行尾只允许空白 | `\`\`\` 后面跟文字` 不是闭合 |
 * | 6 | 未闭合 → 其后到文末一律围栏内 | 文档写到一半就结束 |
 */

/** 一次开围栏的身份。闭围栏靠它判断「同字符且不短于」。 */
interface FenceOpen {
  /** 围栏字符，反引号或波浪号。 */
  readonly char: string;
  /** 开围栏的字符个数。 */
  readonly length: number;
}

/** 围栏边界候选行：0–3 空格缩进 + 连续围栏字符 + 其余（info string 或行尾空白）。 */
const FENCE_RUN = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/** 闭围栏的尾部只允许空白（规则 5）。 */
const BLANK_TAIL = /^[ \t]*$/;

/**
 * 逐行判定是否落在围栏内。
 *
 * 开围栏行与闭围栏行本身都判 `false`——它们是边界标记，不是内容；
 * 只有真正夹在两者之间的行才算「围栏内」。这样调用方可以直接
 * `if (inside[i]) 跳过裁剪`，不必再区分边界。
 * @param lines - 已按行切分的正文。
 * @returns 与入参等长的布尔数组；`true` = 该行在围栏内。
 */
export function scanFenceLines(lines: readonly string[]): readonly boolean[] {
  const inside: boolean[] = [];
  let open: FenceOpen | null = null;

  for (const line of lines) {
    if (open === null) {
      const match = FENCE_RUN.exec(line);
      if (match !== null) {
        const run = match[1] ?? '';
        const info = match[2] ?? '';
        const char = run[0] ?? '';
        // 规则 2：反引号围栏的 info string 不能含反引号，否则这行不是围栏起点。
        if (!(char === '`' && info.includes('`'))) {
          open = { char, length: run.length };
          inside.push(false);
          continue;
        }
      }
      inside.push(false);
      continue;
    }

    // 已在围栏内：先当作内容，再判断这一行是不是闭围栏。
    const match = FENCE_RUN.exec(line);
    const closes =
      match !== null &&
      (match[1]?.[0] ?? '') === open.char &&
      (match[1]?.length ?? 0) >= open.length &&
      BLANK_TAIL.test(match[2] ?? '');
    if (closes) {
      open = null;
      inside.push(false);
      continue;
    }
    inside.push(true);
  }
  return inside;
}

/** 围栏统计，供诊断与测试断言"这篇正文到底有几段围栏"。 */
export interface FenceStats {
  /** 已闭合的围栏对数。 */
  readonly closed: number;
  /** 到文末仍未闭合的围栏数（0 或 1）。 */
  readonly unclosed: number;
}

/**
 * 统计围栏开合情况。
 *
 * 单独给一个函数是为了让诊断面板能说人话：「这个技能正文里有一段没闭合的围栏，
 * 后面全被当成代码，档位裁剪在它里面一行都不会生效」——这种问题只看渲染结果
 * 是看不出来的。
 * @param lines - 已按行切分的正文。
 * @returns 统计结果。
 */
export function fenceStats(lines: readonly string[]): FenceStats {
  let closed = 0;
  let open: FenceOpen | null = null;
  for (const line of lines) {
    const match = FENCE_RUN.exec(line);
    if (match === null) continue;
    const run = match[1] ?? '';
    const info = match[2] ?? '';
    const char = run[0] ?? '';
    if (open === null) {
      if (!(char === '`' && info.includes('`'))) open = { char, length: run.length };
      continue;
    }
    if (char === open.char && run.length >= open.length && BLANK_TAIL.test(info)) {
      closed += 1;
      open = null;
    }
  }
  return { closed, unclosed: open === null ? 0 : 1 };
}
