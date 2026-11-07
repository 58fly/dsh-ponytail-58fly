/**
 * 描述折叠与判长单测（#10 第 5/6 条）。
 *
 * 宿主 catalogDescription（dsh-tool-skill/lib/index.js:1094-1097）的口径是：
 *   normalized = value.replaceAll(/\s+/g, ' ').trim()
 *   normalized.length <= max ? normalized : normalized.slice(0, max - 3) + '...'
 * 长度单位是 UTF-16 code unit。这里逐条把该口径钉死，并把"截断会切半代理对"
 * 这个宿主缺陷也钉成断言——本仓库靠 480 的本地阈值不去踩它，而不是假装它不存在。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DESCRIPTIONS_POLICY,
  foldDescription,
  judgeDescription,
  truncateDescription,
} from '../lib/skills/description.js';

test('策略常量：宿主上限 500，本仓库阈值 480', () => {
  assert.equal(DESCRIPTIONS_POLICY.max, 500);
  assert.equal(DESCRIPTIONS_POLICY.ours, 480);
});

test('foldDescription：换行与多空格收成一个空格', () => {
  assert.equal(foldDescription('a\n\nb   c\td'), 'a b c d');
});

test('foldDescription：去掉首尾空白（含全角空格与制表符）', () => {
  assert.equal(foldDescription('  \t 内容 \u3000 '), '内容');
});

test('foldDescription：折叠标量形状的描述能与宿主给出同一串', () => {
  const raw = 'Lazy mode. Use when the user says\n  "be lazy", "find bloat",\n  or "/ponytail".';
  assert.equal(foldDescription(raw), 'Lazy mode. Use when the user says "be lazy", "find bloat", or "/ponytail".');
});

test('foldDescription：不按码点拆分，emoji 原样保留', () => {
  const folded = foldDescription('🚀  技能  描述');
  assert.equal(folded, '🚀 技能 描述');
  assert.equal(folded.includes('\uFFFD'), false);
});

test('judgeDescription：480 个 a 判 ok', () => {
  const judged = judgeDescription('a'.repeat(480));
  assert.equal(judged.length, 480);
  assert.equal(judged.ok, true);
});

test('judgeDescription：481 个 a 判不 ok', () => {
  const judged = judgeDescription('a'.repeat(481));
  assert.equal(judged.length, 481);
  assert.equal(judged.ok, false);
});

test('judgeDescription：折叠后正好 480 的串判 ok（源码里的换行不算长度）', () => {
  // 200 个字符 + 换行 + 200 个字符 + 引号内多空格，最终折叠成 480 个 a 与分隔空格。
  const raw = ['a'.repeat(239), '   ', 'a'.repeat(240)].join('\n');
  const judged = judgeDescription(raw);
  assert.equal(judged.folded.length, 480);
  assert.equal(judged.length, 480);
  assert.equal(judged.ok, true);
  assert.equal(judged.folded.includes('\n'), false);
});

test('judgeDescription：长度按 UTF-16 数（emoji 占 2），不用码点', () => {
  // 241 个 emoji = 482 个 UTF-16 code unit：按码点数会误判成 241 <= 480。
  const judged = judgeDescription('🚀'.repeat(241));
  assert.equal(judged.length, 482);
  assert.equal(judged.folded.length, 482);
  assert.equal(judged.ok, false);
});

test('judgeDescription：阈值可覆盖', () => {
  assert.equal(judgeDescription('a'.repeat(10), 10).ok, true);
  assert.equal(judgeDescription('a'.repeat(11), 10).ok, false);
});

test('truncateDescription：不超长时原样返回折叠串', () => {
  assert.equal(truncateDescription('a  b', 500), 'a b');
});

test('truncateDescription：正好等于上限时原样返回，不加省略号', () => {
  const value = 'a'.repeat(500);
  assert.equal(truncateDescription(value, 500), value);
});

test('truncateDescription：超长时切到 max-3 再拼三个点', () => {
  const result = truncateDescription('a'.repeat(600), 500);
  assert.equal(result.length, 500);
  assert.equal(result.endsWith('...'), true);
  assert.equal(result.slice(0, 497), 'a'.repeat(497));
});

test('truncateDescription：三百个火箭与 maxLength=500 会把代理对切半（宿主缺陷，已钉住）', () => {
  const result = truncateDescription('🚀'.repeat(300), 500);
  // 600 个 code unit 超长 → 切 497 个（奇数）正好落在代理对中间。
  assert.equal(result.length, 500);
  assert.equal(result.endsWith('...'), true);
  assert.equal(result.includes('\uFFFD'), false);
  // 497 是奇数，切点必落在代理对中间：切出来的最后一格必须是孤立高代理，
  // 它后面紧跟着被丢掉的低代理。这就是宿主会渲染成方框/乱码的那一格。
  assert.equal(/[\uD800-\uDBFF]$/.test(result.slice(0, 497)), true);
  assert.equal(/[\uDC00-\uDFFF]$/.test(result.slice(0, 497)), false);
});

test('truncateDescription：切点落在完整字符边界时不产生孤立代理（480 阈值下的常态）', () => {
  // '🚀'.repeat(240) 是 480 个 code unit，恰好不超长，永远走不到切半分支。
  const result = truncateDescription('🚀'.repeat(240), 480);
  assert.equal(result.length, 480);
  assert.equal(result.endsWith('...'), false);
  assert.equal(/[\uD800-\uDBFF]$/.test(result), false);
});

test('truncateDescription：maxLength 小于 3 时按宿主语义 slice(0, 负数) 保留到末尾（照抄，不修正）', () => {
  // 宿主用的是 slice(0, maxLength - 3)：maxLength=2 时得到 slice(0, -1)，
  // 结果 'abcde...' 反而比上限长。本函数照抄这条语义，是为了让"别把描述压到 3 以下"
  // 这件事在本地也表现得和宿主一模一样；测试钉住它，避免有人"顺手修好"后与宿主不一致。
  assert.equal(truncateDescription('abcdef', 2), 'abcde...');
  assert.equal(truncateDescription('abcdef', 3), '...');
});
