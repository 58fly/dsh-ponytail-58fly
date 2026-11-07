/**
 * 阶梯正文裁剪单测（#07 验收项：17 条形状变体全部正确、围栏内误删 0）。
 *
 * 上游的过滤只用两条正则、且逐行就地删（src/ponytail-instructions.ts:20-45），
 * 对围栏一无所知。这里的每一条都用"真实正文里会出现的写法"钉住行为：
 * 表格行、三种项目符号、有序列表、中英文冒号、中英文引号、括号说明。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  filterLadderBody,
  renderLadderSection,
  renderModeUpdate,
  shapeLabel,
  stripFrontmatter,
} from '../lib/prompt/ladder.js';

/** 一行是否会在 full 档被保留。 */
const keptInFull = (line) => filterLadderBody(line, 'full').trim().length > 0;

test('V1 表格行：非当前档被删', () => {
  assert.equal(keptInFull('| **lite** | 最小改动 |'), false);
});

test('V2 表格行：当前档保留', () => {
  assert.equal(keptInFull('| **full** | 常规 |'), true);
});

test('V3 表格行：标签大写也能识别', () => {
  assert.equal(keptInFull('| **LITE** | 最小改动 |'), false);
});

test('V4 表格行：标签两侧留空格', () => {
  assert.equal(keptInFull('| ** lite ** | 最小改动 |'), false);
});

test('V5 列表：加粗标签', () => {
  assert.equal(keptInFull('- **lite**: "只改必要的地方"'), false);
});

test('V6 列表：无加粗标签', () => {
  assert.equal(keptInFull('- lite: "只改必要的地方"'), false);
});

test('V7 列表：中文冒号 + 中文引号', () => {
  assert.equal(keptInFull('- lite：「只改必要的地方」'), false);
});

test('V8 列表：中文冒号 + 直角引号外的双引号', () => {
  assert.equal(keptInFull('- lite：“只改必要的地方”'), false);
});

test('V9 列表：星号项目符号', () => {
  assert.equal(keptInFull('* lite: "只改必要的地方"'), false);
});

test('V10 列表：加号项目符号', () => {
  assert.equal(keptInFull('+ lite: "只改必要的地方"'), false);
});

test('V11 列表：有序列表', () => {
  assert.equal(keptInFull('1. lite: "只改必要的地方"'), false);
});

test('V12 列表：标签后带半角括号说明', () => {
  assert.equal(keptInFull('- lite (最小): "只改必要的地方"'), false);
});

test('V13 非档位标签的表格行一律保留', () => {
  // 上游把非法标签当默认档，于是 | **注意** | 这种普通表格行在非默认档被误删。
  assert.equal(keptInFull('| **注意** | 这里是说明 |'), true);
});

test('V14 冒号后不是引号的列表行一律保留', () => {
  // 形如 "- 说明: 随便写" 的普通条目不是档位标记，不能因为"看着像"就删。
  assert.equal(keptInFull('- lite: 只改必要的地方'), true);
});

test('V15 围栏内的档位行一律保留（对比 A 方案会误删）', () => {
  const body = ['前文', '```', '| **lite** | 示例表里的 lite 行 |', '```', '后文'].join('\n');
  const filtered = filterLadderBody(body, 'full');
  assert.ok(filtered.includes('| **lite** |'), '围栏内的档位行被误删了');
});

test('V16 缩进的档位行仍按围栏外处理', () => {
  assert.equal(keptInFull('   | **lite** | 最小改动 |'), false);
});

test('V17 off 行在 full 档被删，在 off 档保留', () => {
  assert.equal(keptInFull('| **off** | 关闭 |'), false);
  assert.equal(filterLadderBody('| **off** | 关闭 |', 'off').trim().length > 0, true);
});

test('shapeLabel 只判形状不判合法性', () => {
  assert.equal(shapeLabel('| **lite** | x |'), 'lite');
  assert.equal(shapeLabel('| **注意** | x |'), '注意');
  assert.equal(shapeLabel('普通段落'), null);
});

test('stripFrontmatter 只吃文件开头的块', () => {
  assert.equal(stripFrontmatter('---\nname: x\n---\n正文'), '正文');
  assert.equal(stripFrontmatter('前言\n---\nname: x\n---\n正文').startsWith('前言'), true);
  assert.equal(stripFrontmatter('没有 frontmatter'), '没有 frontmatter');
});

test('renderLadderSection：off 档返回空串（宿主据此剔除整段）', () => {
  assert.equal(renderLadderSection('off', '正文'), '');
});

test('renderLadderSection：启用档带档位声明', () => {
  const text = renderLadderSection('lite', '| **full** | 常规 |\n| **lite** | 最小 |');
  assert.ok(text.startsWith('PONYTAIL 已启用 · 档位：lite'));
  assert.ok(text.includes('| **lite** |'));
  assert.equal(text.includes('| **full** |'), false);
});

test('renderModeUpdate：启用档用替换式措辞并带完整正文', () => {
  const text = renderModeUpdate('lite', 'full', '| **lite** | 最小 |');
  assert.ok(text.startsWith('<system-reminder>'));
  assert.ok(text.includes('取代此前任何档位说明'));
  assert.ok(text.includes('（取代原档位 full）'));
  assert.ok(text.includes('| **lite** |'));
  assert.ok(text.trimEnd().endsWith('</system-reminder>'));
});

test('renderModeUpdate：off 档不给正文', () => {
  const text = renderModeUpdate('off', 'full', '| **lite** | 最小 |');
  assert.ok(text.includes('档位已关闭'));
  assert.equal(text.includes('| **lite** |'), false);
});

test('renderModeUpdate：正文不可用时给降级说明而不是空白', () => {
  const text = renderModeUpdate('lite', null, '');
  assert.ok(text.includes('阶梯正文不可用'));
  assert.equal(text.includes('（取代原档位'), false);
});
