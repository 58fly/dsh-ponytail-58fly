/**
 * prompt · 阶梯正文的裁剪与两套渲染。
 *
 * 三件事都在这里，因为它们是同一条链上的相邻步骤，拆开只会让「为什么这行被删了」
 * 更难追：
 *
 * 1. {@link shapeLabel} —— 一行是不是「档位标记行」，是的话它的标签是什么；
 * 2. {@link filterLadderBody} —— 按档位裁掉不该出现的标记行，围栏内一律不动；
 * 3. {@link renderLadderSection} / {@link renderModeUpdate} —— 同一份正文的两种用法。
 *
 * **两个渲染出口是刻意分开的**，这是本插件与上游最大的结构差别：
 *
 * - {@link renderLadderSection} 进 system prompt 的固定段，只在会话诞生时按
 *   **baseline 档位**渲染一次、终身不变——前缀字节稳定，KV cache 才不报废；
 * - {@link renderModeUpdate} 进 `agent/pre-step` 注入的尾部消息，每次真换档才发一条，
 *   带完整正文。模型读到的是「最新档位 + 完整指令」，而前缀一个字节都没动。
 *
 * 上游把这两件事合并成「每轮重新渲染 section」（src/ponytail-instructions.ts:85），
 * 于是**每次切档都让整个 system prompt 前缀失效**，这是 B-03 的根因。
 */
import { coerceMode, type RuntimeMode } from '../l0/mode.js';
import { scanFenceLines } from './fence.js';

/**
 * 表格形状：首列加粗。
 *
 * 比上游宽松在**不锚定行首**（上游 `/^\|\s*\*\*(.+?)\*\*\s*\|/` 要求竖线顶格）：
 * 缩进过的表格在 markdown 里依然是表格，把它漏掉等于让模型多读一行过期档位说明——
 * 漏裁不报错、只是悄悄变差，比误删更难发现。
 */
const TABLE_SHAPE = /^\s*\|\s*\*\*(.+?)\*\*\s*\|/;

/**
 * 列表形状：列表项名 + 冒号 + 引号。
 *
 * 相比上游 `/^-\s*([^:]+)(?:：|:)\s*["「]/` 覆盖五种合理漂移（见
 * `docs/research/ponytail-prototype-fence-and-composition.md` §1.5 的 V10–V14）：
 * 星号/加号/有序 bullet、两空格缩进、加粗模式名、括号注释（如 `- full (default): "…"`）。
 * 上游那五种写法全部漏裁，实测 17 条变体只对 12 条。
 */
const LIST_SHAPE =
  /^\s*(?:[-*+]|\d+[.)])\s+(?:\*\*)?([^:*()\n]+?)(?:\*\*)?\s*(?:\([^)\n]*\))?\s*(?::|：)\s*["「『“]/;

/**
 * 取出这一行的档位标签，非形状行返回 null。
 *
 * 只回答「这行长得像不像档位标记」，**不判断标签是不是合法档位**——
 * 那件事在 {@link filterLadderBody} 里做，因为「像标记但不是档位」与
 * 「不是标记」的处理方式相同（都原样保留），而「是不是标记」需要复用。
 * @param line - 一行正文。
 * @returns 标签原文（可能带大小写/空格差异），或 null。
 */
export function shapeLabel(line: string): string | null {
  const table = TABLE_SHAPE.exec(line);
  if (table !== null) return table[1] ?? null;
  const list = LIST_SHAPE.exec(line);
  if (list !== null) return list[1] ?? null;
  return null;
}

/**
 * 剥掉 YAML frontmatter。
 *
 * 宿主技能目录里的 SKILL.md 带 frontmatter（`name` / `description` / `argument-hint`），
 * 那段是给技能目录页看的，塞进 system prompt 既浪费又被模型当成元数据。
 * 只认**文件开头**的 `---` 块：正文中间的 `---` 是分隔线，不是 frontmatter。
 * @param markdown - 原文。
 * @returns 去掉 frontmatter 的正文。
 */
export function stripFrontmatter(markdown: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(markdown);
  return match === null ? markdown : markdown.slice(match[0].length);
}

/**
 * 按档位裁剪阶梯正文。
 *
 * 裁掉的对象只有一类：**围栏外、且标签是合法档位、且不等于当前档位**的形状行。
 * 其余一律原样保留——包括：
 *
 * - 围栏内的形状行（那是文档示例，删了就是误导）；
 * - 标签不是合法档位的形状行（`| **注意** | … |` 这种是普通表格，
 *   上游的 `normalizeMode` 会把非法标签归成默认档，于是它在非默认档被静默删掉）；
 * - 所有非形状行。
 *
 * @param body - 已剥 frontmatter 的正文。
 * @param mode - 当前档位。
 * @returns 裁剪后的正文。
 */
export function filterLadderBody(body: string, mode: RuntimeMode): string {
  const lines = body.split('\n');
  const inside = scanFenceLines(lines);
  const kept = lines.filter((line, index) => {
    if (inside[index] === true) return true;
    const label = shapeLabel(line);
    if (label === null) return true;
    const labelMode = coerceMode(label);
    if (labelMode === null) return true;
    return labelMode === mode;
  });
  return kept.join('\n');
}

/**
 * 档位改成大字显示：`full` → `FULL`。
 *
 * 上游在 reminder 里用大写（src/ponytail-instructions.ts 的 `toUpperCase()`），
 * 是为了让模型在一大段正文里一眼抓到那一行。沿用。
 * @param mode - 档位。
 * @returns 大写形式。
 */
export function upperMode(mode: RuntimeMode): string {
  return mode.toUpperCase();
}

/**
 * system prompt 固定段的正文：会话 baseline 档位 + 裁剪后的阶梯。
 *
 * `off` 档返回空字符串——宿主 `renderPrompt` 会把空段从最终提示词里滤掉
 * （`dsh-system-prompt/lib/index.js:119-121`），所以"不出现"正是我们要的效果，
 * 不需要另外注销 section。
 * @param mode - 会话 baseline 档位。
 * @param body - 阶梯正文（已剥 frontmatter，未裁剪）。
 * @returns 段正文。
 */
export function renderLadderSection(mode: RuntimeMode, body: string): string {
  if (mode === 'off') return '';
  const filtered = filterLadderBody(body, mode).trim();
  // 正文读不到（技能目录没装、文件被删）时不能返回空段：前缀段消失意味着模型
  // 在整个会话里都不知道 ponytail 存在，而尾部 reminder 只在切档时才出现。
  // 降级成一句最小可用说明，比"静默没有规则"显式。
  const text = filtered.length === 0 ? '（阶梯正文不可用，按最小可用改动执行。）' : filtered;
  return 'PONYTAIL 已启用 · 档位：' + mode + '\n\n' + text;
}

/**
 * 尾部 reminder 的正文：`<system-reminder>` 包住完整阶梯。
 *
 * 为什么是**完整正文**而不是「只告诉它换了档」：模型每一步都是无状态的，
 * 它只看得到这一轮的上下文。只说「档位变了」等于让它自己回忆新档位该做什么——
 * 而 system prompt 里的那份还是**诞生时**的档位，两者一旦不同就是矛盾指令。
 * 所以这条消息必须自带完整指令集，并用「替换式措辞」声明它盖过前面所有档位说明。
 *
 * off 档不给正文：这条消息的全部信息量就是「现在没有阶梯约束」。
 * @param mode - 新档位。
 * @param previousMode - 上一档位，用于写"取代了谁"；null 表示无法确定。
 * @param body - 阶梯正文（已剥 frontmatter，未裁剪）。
 * @returns 消息正文。
 */
export function renderModeUpdate(
  mode: RuntimeMode,
  previousMode: RuntimeMode | null,
  body: string,
): string {
  const suffix = previousMode === null ? '' : '（取代原档位 ' + previousMode + '）';
  if (mode === 'off') {
    return [
      '<system-reminder>',
      'PONYTAIL 档位已关闭' + suffix + '。',
      '本会话恢复普通开发模式，直到显式重新启用。按常规工程实践执行，不受 ponytail 阶梯约束。',
      '</system-reminder>',
    ].join('\n');
  }
  const filtered = filterLadderBody(body, mode);
  return [
    '<system-reminder>',
    'PONYTAIL 档位已切换为 ' + upperMode(mode) + suffix + '。',
    '以下完整指令集适用于本会话后续所有回复，并取代此前任何档位说明：',
    '',
    filtered.trim().length === 0 ? '（阶梯正文不可用，按最小可用改动执行。）' : filtered,
    '</system-reminder>',
  ].join('\n');
}
