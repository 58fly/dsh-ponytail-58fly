/**
 * 围栏扫描单测（#07 验收项：围栏内误删 0）。
 *
 * 判据全部对齐 CommonMark 0.31 §4.5。这些用例不是"随手举几个例子"，
 * 每条都对应一个真实会写进 SKILL.md 的形状——阶梯正文里既有示例围栏，
 * 也有"反引号围栏里再讲反引号"的说明段。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fenceStats, scanFenceLines } from '../lib/prompt/fence.js';

/** 把正文拆行后扫描，返回 true 的下标集合。 */
const insideOf = (text) => {
  const lines = text.split('\n');
  return scanFenceLines(lines)
    .map((flag, index) => (flag ? index : -1))
    .filter((index) => index >= 0);
};

test('无围栏：全部判 false', () => {
  assert.deepEqual(insideOf('第一行\n第二行'), []);
});

test('三反引号成对：中间行在围栏内，围栏行本身不在', () => {
  assert.deepEqual(insideOf('```\n中间\n```'), [1]);
});

test('波浪号围栏同样成立', () => {
  assert.deepEqual(insideOf('~~~\n中间\n~~~'), [1]);
});

test('四空格缩进的三个反引号是缩进代码块，不是围栏', () => {
  // 如果这里判成围栏，后面整段正文都会被当成"围栏内"而免于裁剪，
  // 于是档位行该删的没删——静默失效，比多删更难发现。
  assert.deepEqual(insideOf('    ```\n尾巴'), []);
});

test('反引号围栏的 info 里不得再含反引号', () => {
  // 形如 ```js` 的行按 CommonMark 不是围栏开头，而是普通段落。
  assert.deepEqual(insideOf('```js`\n尾巴\n```'), []);
});

test('闭合围栏必须同字符：三反引号不会被波浪号关掉', () => {
  // 闭合失败 → 围栏延续到文末，于是那一行 `~~~` 自己也算围栏内容。
  assert.deepEqual(insideOf('```\n中间\n~~~'), [1, 2]);
});

test('闭合围栏长度不得小于开启围栏', () => {
  assert.deepEqual(insideOf('````\n中间\n```\n还在里面\n````'), [1, 2, 3]);
});

test('闭合围栏行尾只允许空白', () => {
  assert.deepEqual(insideOf('```\n中间\n``` x\n还在里面\n```'), [1, 2, 3]);
});

test('未闭合围栏一直延伸到文末', () => {
  assert.deepEqual(insideOf('```\n一\n二\n三'), [1, 2, 3]);
});

test('fenceStats 报出未闭合那一处', () => {
  assert.deepEqual(fenceStats('```\n中间'.split('\n')), { closed: 0, unclosed: 1 });
  assert.deepEqual(fenceStats('```\na\n```\n~~~\nb'.split('\n')), { closed: 1, unclosed: 1 });
});
