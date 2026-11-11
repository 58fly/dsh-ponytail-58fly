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
import { withoutHelp } from './surface.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const panel = await readFile(join(root, 'src/client/panel.tsx'), 'utf8');

/**
 * 只剔除 `pipeLabel()` 这一个函数体：它产出的是 aria-label，不是卡面文字，
 * 里面必须保留「先命中的赢」「没赢」这类说法，否则读屏用户拿不到机制。
 * 其余部分（组件、样式、管道画法）全部留在扫描范围内。
 */
const SURFACE = withoutHelp(panel.replace(/function pipeLabel[\s\S]*?\n}\n/, ''));

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
  // 效率卡的两处图（堆叠条、区间条）是纯图形容器，用 img 角色是对的；管道容器不许用。
  // 右边界取管道容器的闭合（第一个 `</div>`）：整段卡片 JSX 到此为止。
  // 不能用「到效率区块函数定义为止」——那中间横跨了两张卡的整个实现。
  const start = panel.indexOf('<div role="group"');
  const end = panel.indexOf('</div>', start);
  assert.ok(start > 0 && end > start, '找不到管道容器到效率区块之间的片段');
  const pipe = panel.slice(start, end);
  assert.doesNotMatch(pipe, /role="img"\s/);
  assert.match(panel, /取值顺序\$\{order\}/);
  assert.match(panel, /没赢/);
  assert.match(panel, /不是有效档位/);
});

/** 票 03：六个（这里七个，`off` 另挂一个）`?` 入口，标签就是它们的清单。 */
const HELP_ENTRIES = [
  '四档完整说明',
  '诊断链怎么读',
  '受管轮次怎么算',
  '注入率怎么算',
  '这一行的三个量怎么算',
  'off 那段灰条是什么',
  '基准推算的依据',
];

test('诊断卡与效率卡的每个 `?` 都在，且诚实说明没被软化', () => {
  const missing = HELP_ENTRIES.filter((label) => !panel.includes('label="' + label + '"'));
  assert.deepEqual(missing, [], `这些 ? 入口不见了：${missing.join('，')}`);
  // 规则句、机制说明与那句「读不到不代表没生效」必须留在 ? 里。
  assert.match(panel, /自上而下就是取值顺序/);
  assert.match(panel, /先命中的赢/);
  assert.match(panel, /浏览器里看不到宿主的环境变量/);
  assert.match(panel, /没写值不代表它没生效/);
});

/** 用户故事 12：环里是比例，旁边必须有原始分母（`96 / 128`），不能只有百分比。 */
test('注入率环旁边挂着原始分母', () => {
  assert.match(panel, /\{group\(snapshot\.injections\)\} \/ \{group\(snapshot\.managedTurns\)\}/);
});
