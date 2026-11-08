/**
 * README 结构门禁。
 *
 * 为什么单开一个脚本而不是并进 `verify.mjs`：`verify.mjs` 查的是"产物与仓库纯度"
 * （源码只导宿主公开面、声明与磁盘一致、零写盘），这份查的是"对外文档的骨架合不合
 * 发布契约"（行数、三级以内、必留章节、双语互链、两份语种骨架一致）。失败含义、
 * 修法、责任人都不一样，混在一起报错会让人改错地方。两者都在 `prepublishOnly` 里跑，
 * 谁红了都发不出去。
 *
 * 结构完全照 `check-skills.mjs`：断言聚合成 `failures[]`，不阻塞但必须被看见的收进
 * `warnings[]`，最后一次性打印并 `process.exit(1)`。断言本体是**纯函数**（接受文本
 * 内容），薄壳只负责读文件——这样 `test/readme-structure.test.mjs` 不用造临时仓库
 * 就能验边界，与 `verify-published.mjs` 的 `classifyMissing` 同一惯例。
 *
 * 每条断言的理由见 `test/readme-structure.test.mjs` 文件头：都对应一次真实退化，
 * 不是排版口味。
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/** 中文版行数上限。超了说明过程叙事又长回来了。 */
export const MAX_LINES = 180;

/** 英文版行数上限：结构同中文，正文压到约 80%，所以给同一上限即可。 */
export const MAX_LINES_EN = MAX_LINES;

/**
 * 数行数。
 *
 * 末尾单个换行不额外算一行——`wc -l` 数的是换行符个数，`'a\n'.split('\n')` 会得到
 * 两个元素，直接拿 `length` 会虚报。门禁读数必须和 `wc -l` 一致，否则「README 到底
 * 多少行」会变成两份说法。
 * @param text - 文件全文。
 * @returns 行数。
 */
export function countLines(text) {
  const normalized = text.replace(/\r\n/g, '\n');
  const trimmed = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized;
  return trimmed === '' ? 0 : trimmed.split('\n').length;
}

/**
 * 抓「独占一行的加粗」充当小标题的行号。
 *
 * 唯一豁免：同一行里含 `](`（markdown 链接）的加粗行——头部那句双语互链就是这种形状，
 * 它是约定的一部分，不是小标题。badge 行同理（`[![`）。
 *
 * 豁免为什么按「有没有链接」判而不是按行号/位置判：位置一改（加一行 badge、换顺序）
 * 规则就悄悄失效，而「含链接的加粗行」是个稳定的形状特征；tagline 想加粗就该改成
 * 普通文本，那才是它该有的视觉权重。
 * @param text - 文件全文。
 * @returns 1-based 行号数组。
 */
export function findBoldHeadings(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const hits = [];
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!/^\*\*[^*].*\*\*$/u.test(trimmed)) return;
    if (trimmed.includes('](')) return;
    hits.push(index + 1);
  });
  return hits;
}

/**
 * 抓 `####` 及更深的标题行号。
 * @param text - 文件全文。
 * @returns 1-based 行号数组，元素是层级数。
 */
export function findDeepHeadings(text) {
  const hits = [];
  text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .forEach((line) => {
      const match = /^(#{4,6})\s+/u.exec(line);
      if (match !== null) hits.push(match[1].length);
    });
  return hits;
}

/**
 * 抽出文档骨架：每一节的标识。
 *
 * 两种写法等价，因为 README 同时用它们分节：Markdown `##` 与 `<h2><sub>ID</sub></h2>`。
 * 只取这一层——更深的小节（`###`）是正文，不参与双语比对：英文版正文压到 80% 时
 * 合并小节是合理的，节与节之间不能增删。
 * @param text - 文件全文。
 * @returns 节标识数组（保持出现顺序、保持重复，便于报出多余的那个）。
 */
export function extractHeadings(text) {
  const headings = [];
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const sub = /<h2[^>]*>\s*<sub>([^<]+)<\/sub>/iu.exec(line);
    if (sub !== null) {
      headings.push(sub[1].trim().toUpperCase());
      continue;
    }
    const md = /^##\s+(.+?)\s*$/u.exec(line);
    if (md !== null) headings.push(md[1].trim().toUpperCase());
  }
  return headings;
}

/**
 * 比对中文版与英文版的骨架。
 * @param zh - 中文版全文。
 * @param en - 英文版全文。
 * @returns `{ ok, onlyInZh, onlyInEn }`。
 */
export function compareHeadings(zh, en) {
  const zhSet = extractHeadings(zh);
  const enSet = extractHeadings(en);
  const onlyInZh = zhSet.filter((heading) => !enSet.includes(heading));
  const onlyInEn = enSet.filter((heading) => !zhSet.includes(heading));
  return { ok: onlyInZh.length === 0 && onlyInEn.length === 0, onlyInZh, onlyInEn };
}

/**
 * 检查一份 README 里有没有指向另一语种的互链。
 *
 * **必须指向本仓的那一份**：指向别人仓库的同名文件是最常见的复制粘贴事故，
 * 那种链点进去是别人的项目，比没有链更糟。所以认全路径而不是只认文件名。
 * @param text - 文件全文。
 * @param locale - 这一份是哪种语言。
 * @returns `{ ok, target, reason }`。
 */
export function findLanguageLinks(text, locale) {
  const want = locale === 'zh' ? 'docs/README.en.md' : 'README.md';
  const other = locale === 'zh' ? 'en' : 'zh';
  const pattern = new RegExp('\\[[^\\]]*\\]\\(([^)\\s]+)\\)', 'gu');
  const targets = [...text.matchAll(pattern)].map((match) => (match[1] ?? '').trim());
  const hit = targets.find((target) => {
    // 英文版回链要排除它自己那份：`README.en.md` 结尾也是 `README.md` 的子串。
    if (locale === 'en' && target.endsWith('README.en.md')) return false;
    return target.endsWith(want);
  });
  if (hit !== undefined) return { ok: true, target: hit, reason: null };
  return {
    ok: false,
    target: null,
    reason:
      locale === 'zh'
        ? 'README.md 顶部缺少指向 ' + want + ' 的互链：英语读者从中文首页回不到英文版。'
        : 'docs/README.en.md 顶部缺少指回 README.md 的互链：读者从英文版回不到默认的简体中文版。',
  };
}

/** 中文版必须存在的节（顺带钉住「不许删到只剩两节」）。 */
const REQUIRED_SECTIONS = ['INSTALL', 'SKILLS', 'CONFIG', 'COMPAT', 'TROUBLESHOOT', 'SOURCE'];

/**
 * 校验一份 README 的骨架。
 * @param text - 文件全文。
 * @param options - `{ locale, maxLines }`。
 * @returns `{ failures, warnings }`。
 */
export function checkStructure(text, { locale, maxLines = MAX_LINES }) {
  const failures = [];
  const warnings = [];
  const lines = countLines(text);
  if (lines > maxLines) {
    failures.push(
      `${locale === 'zh' ? 'README.md' : 'docs/README.en.md'} 现有 ${lines} 行，超过上限 ${maxLines}：` +
        '长回来的通常是过程叙事（部署三种形态、发布卡口、历史来源）。把细节留给 docs/，首页只留使用者要的东西。',
    );
  }

  const bold = findBoldHeadings(text);
  if (bold.length > 0) {
    failures.push(
      '第 ' + bold.join('、') + ' 行用 `**加粗**` 独占一行充当小标题：Markdown 会把相邻两行并成同一段，' +
        '视觉上不成立层级。改用 ## 或 <h2><sub>…</sub></h2>。',
    );
  }

  const deep = findDeepHeadings(text);
  if (deep.length > 0) {
    failures.push(
      '出现了 ' + deep.map((level) => '#'.repeat(level)).join('、') + ' 级标题：层级只用 ## / ###，' +
        '再深会把 GitHub 右侧目录撑成四层，且与 <h2><sub> 分节混用后深浅全乱。',
    );
  }

  const link = findLanguageLinks(text, locale);
  if (!link.ok) failures.push(link.reason ?? '缺少双语互链');

  if (locale === 'zh') {
    const present = extractHeadings(text);
    const missing = REQUIRED_SECTIONS.filter((section) => !present.includes(section));
    if (missing.length > 0) {
      failures.push('README.md 缺少必须存在的节：' + missing.join('、') + '（使用者靠这几节装起来并排障）');
    }
  }
  return { failures, warnings };
}

/** 读文本，读不到返回 null（不抛）。 */
async function readText(path) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

/**
 * 薄壳：读两份文件、跑断言、一次性打印。
 * @returns 退出码（0 通过，1 失败）。
 */
async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, '..');
  const failures = [];
  const warnings = [];

  const zh = await readText(join(root, 'README.md'));
  if (zh === null) {
    failures.push('README.md 不存在：npm 页与 GitHub 首页都靠它，缺了整个包的对外说明归零。');
  } else {
    const result = checkStructure(zh, { locale: 'zh', maxLines: MAX_LINES });
    failures.push(...result.failures);
    warnings.push(...result.warnings);
  }

  const en = await readText(join(root, 'docs', 'README.en.md'));
  if (en === null) {
    warnings.push(
      'docs/README.en.md 不存在：本版只发中文版，双语结构一致性检查跳过。下次补英文版时，' +
        '它与 README.md 的 ## 层级骨架必须一致（正文可以压到约 80%）。',
    );
  } else {
    const result = checkStructure(en, { locale: 'en', maxLines: MAX_LINES_EN });
    failures.push(...result.failures);
    warnings.push(...result.warnings);
    if (zh !== null) {
      const diff = compareHeadings(zh, en);
      if (!diff.ok) {
        failures.push(
          '中英两份 README 的节骨架不一致：' +
            (diff.onlyInZh.length > 0 ? '仅中文有 ' + diff.onlyInZh.join('、') + '；' : '') +
            (diff.onlyInEn.length > 0 ? '仅英文有 ' + diff.onlyInEn.join('、') + '；' : '') +
            '两份是同一份文档的两个语种，正文可以不同，骨架不行。',
        );
      }
    }
  }

  if (failures.length > 0) {
    console.error(`\nREADME 结构校验失败 ${failures.length} 项：\n`);
    for (const failure of failures) console.error(`  ✗ ${failure}\n`);
    return 1;
  }
  for (const warning of warnings) console.warn(`warn: ${warning}`);
  const summary = en === null ? '仅中文版' : '中英双语，骨架一致';
  console.log(`README 结构校验通过（${summary}，上限 ${MAX_LINES} 行）`);
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(await main());
}
