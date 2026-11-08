/**
 * README 结构门禁的纯函数单测。
 *
 * 不起 Cordis、不碰文件系统：`check-readme.mjs` 的断言全部抽成接受「文本内容」的
 * 纯函数，所以这里直接喂字符串就能验边界，不需要造临时仓库。
 *
 * 每条断言都对应一次**真实退化**，不是排版口味：
 *
 * 1. 行数上限：README 一旦长回 260 行，GitHub 首页第一屏就全是过程叙事；
 * 2. 加粗小标题：`**加粗**` 独占一行时，Markdown 会把相邻两行并成同一段，
 *    视觉上不成立一个层级，读起来像加了粗的散文；
 * 3. 标题层级：`####` 会把 GitHub 右侧目录撑成四层，且与 `<h2><sub>` 分节混用后
 *    层级深浅全乱；
 * 4. 双语互链：两份文件各自有入口，任一侧漏链就是从英语文档回不到中文；
 * 5. 标题集合一致：中英两份是**同一份文档的两个语种**，结构漂了就说明其中一份
 *    没跟着改——正文可以不同，骨架不行。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MAX_LINES,
  compareHeadings,
  findBoldHeadings,
  findDeepHeadings,
  countLines,
  findLanguageLinks,
} from '../scripts/check-readme.mjs';

/** 一份合规矩的中文 README 骨架。 */
const ZH = [
  '<h1 align="center">🦥 dsh-ponytail</h1>',
  '',
  '**🌐 [中文](README.md) · [English](docs/README.en.md)**',
  '',
  '<h2 align="center"><sub>INSTALL</sub><br>两步上手</h2>',
  '',
  '```bash',
  '# 装插件',
  'dsh plugin --profile web add dsh-ponytail-58fly',
  '```',
  '',
  '<h2 align="center"><sub>SKILLS</sub><br>六个技能</h2>',
  '',
].join('\n');

/** 与中文骨架结构一致的英文版。 */
const EN = [
  '<h1 align="center">🦥 dsh-ponytail</h1>',
  '',
  '**🌐 [English](docs/README.en.md) · [中文](README.md)**',
  '',
  '<h2 align="center"><sub>INSTALL</sub><br>Two steps</h2>',
  '',
  '```bash',
  '# install the plugin',
  'dsh plugin --profile web add dsh-ponytail-58fly',
  '```',
  '',
  '<h2 align="center"><sub>SKILLS</sub><br>Six skills</h2>',
  '',
].join('\n');

test('countLines 按换行计行，末尾无换行不多算一行', () => {
  assert.equal(countLines('a'), 1);
  assert.equal(countLines('a\nb'), 2);
  assert.equal(countLines('a\nb\n'), 2);
  assert.equal(countLines(''), 0);
});

test('findBoldHeadings 抓独占一行的加粗小标题', () => {
  assert.deepEqual(findBoldHeadings('正文\n**装完没有设置面板？**\n后续'), [2]);
});

test('findBoldHeadings 不误伤 badge 行与句中加粗', () => {
  const text = ['**🌐 [中文](README.md) · [English](docs/README.en.md)**', '档位只决定 **强度**，不改变阶梯本身。'].join('\n');
  // badge 行确实独占一行加粗，但它不含句末标点、且是本插件头部约定的互链行：
  // 只允许「互链行」一种例外，靠行内是否含 `](` 判断。
  assert.deepEqual(findBoldHeadings(text), []);
});

test('findDeepHeadings 抓 #### 及更深', () => {
  assert.deepEqual(findDeepHeadings('# a\n## b\n### c\n#### d\n##### e'), [4, 5]);
});

test('findLanguageLinks 认出两份文件里各自的互链', () => {
  const zh = findLanguageLinks(ZH, 'zh');
  assert.equal(zh.ok, true);
  assert.match(zh.target ?? '', /README\.en\.md$/u);

  const en = findLanguageLinks(EN, 'en');
  assert.equal(en.ok, true);
  assert.match(en.target ?? '', /README\.md$/u);
});

test('findLanguageLinks 漏链时判红并说清改哪', () => {
  const zh = findLanguageLinks('# 标题\n\n正文\n', 'zh');
  assert.equal(zh.ok, false);
  assert.match(zh.reason ?? '', /docs\/README\.en\.md/u);

  const en = findLanguageLinks('# Title\n\nbody\n', 'en');
  assert.equal(en.ok, false);
  assert.match(en.reason ?? '', /README\.md/u);
});

test('findLanguageLinks 只认指向本仓另一语种的链接', () => {
  // 指向别人的 README.en.md 不算：那是最常见的复制粘贴事故。
  const wrong = findLanguageLinks('**🌐 [English](https://example.com/foo/README.en.md)**', 'zh');
  assert.equal(wrong.ok, false);
});

test('compareHeadings 结构一致时通过', () => {
  const result = compareHeadings(ZH, EN);
  assert.equal(result.ok, true);
  assert.deepEqual(result.onlyInZh, []);
  assert.deepEqual(result.onlyInEn, []);
});

test('compareHeadings 报出两边各自独有的节', () => {
  const en = EN.replace("<sub>SKILLS</sub>", '<sub>USAGE</sub>');
  const result = compareHeadings(ZH, en);
  assert.equal(result.ok, false);
  assert.deepEqual(result.onlyInZh, ['SKILLS']);
  assert.deepEqual(result.onlyInEn, ['USAGE']);
});

test('compareHeadings 把 <h2><sub> 与 ## 认成同一层骨架', () => {
  const zh = '## CORE\n\n## SKILLS\n';
  const en = '<h2 align="center"><sub>CORE</sub><br>Core</h2>\n\n### 小节\n\n<h2><sub>SKILLS</sub></h2>\n';
  const result = compareHeadings(zh, en);
  assert.equal(result.ok, true, '英文版多几节正文小节不该判红，骨架按 h2 层比');
});

test('行数上限是 180', () => {
  assert.equal(MAX_LINES, 180);
});
