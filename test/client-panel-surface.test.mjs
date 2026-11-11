/**
 * 诊断卡的卡面守卫（票 01 验收项之一）。
 *
 * 这张卡的改造目标是**让图形自己把话说清**：三层竖排就是取值顺序，实心点就是
 * 答案。任何一句解释性文字回到卡面，都说明图形没做到该做的事——所以这条测试
 * 扫面板源码，而不是渲染结果，钉的是「解释语永远不回来」。
 *
 * 只扫 `panel.tsx`：归因与管道画法的字面量都不该带着这些解释性词汇。
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const panel = await readFile(join(root, 'src/client/panel.tsx'), 'utf8');

/**
 * 只剔除 `pipeLabel()` 这一个函数体：它产出的是 aria-label，不是卡面文字，
 * 里面必须保留「先命中的赢」「没赢」这类说法，否则读屏用户拿不到机制。
 * 其余部分（组件、样式、管道画法）全部留在扫描范围内。
 */
const SURFACE = panel.replace(/function pipeLabel[\s\S]*?\n}\n/, '');

/** 被删掉的那批解释层。 */
const BANNED = [
  /取值顺序\s*环境变量/, // 规则句
  /先命中的赢/, // 规则句结尾
  /'生效'/, // 五态标签
  /'被覆盖'/,
  /'值非法'/,
  />状态</, // 表头
  />来源</,
  />取值</,
  /'未设置'/, // 值位已改渲染 `—` / `?`，这条防的是有人把文字状态标签加回来
  /'备注'/,
  /LEGEND/,
  /DIAGNOSIS_RULE/,
];

test('诊断卡的规则句、五态标签与表格列标题不再出现在面板源码里', () => {
  const hits = BANNED.filter((pattern) => pattern.test(SURFACE)).map(String);
  assert.deepEqual(hits, [], `这些解释层又回到了卡面：${hits.join('，')}`);
});

test('管道容器带 role="group" 与说全三层结局的 aria-label', () => {
  // `role="img"` 会把子树从无障碍树里换掉，层名与值就读不到了。
  assert.match(panel, /role="group"/);
  // 注释里还会提到 role="img" 为什么被换掉，只禁真正的 JSX 属性。
  assert.doesNotMatch(panel, /role="img"\s/);
  assert.match(panel, /取值顺序\$\{order\}/);
  assert.match(panel, /没赢/);
  assert.match(panel, /不是有效档位/);
});
