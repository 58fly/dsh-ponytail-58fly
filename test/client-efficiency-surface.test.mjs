/**
 * 效率卡的卡面守卫（票 02 验收项）。
 *
 * 与 `client-panel-surface.test.mjs` 同一套办法：扫源码，钉「解释语不回到卡面」。
 * 票 02 删掉的是效率卡的表头、五行说明与长标签；它们回来，说明图形还不够自己说话。
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
 * 卡面 = 效率区块的源码 - 所有 `?` 的正文。
 *
 * 票 03 之后那些口径句子合法地住在 `?` 里，卡面只剩图形与数字；这条断言
 * 守的就是「它们不许从 `?` 里跑回卡面」。
 */
const SURFACE = withoutHelp(panel.slice(panel.indexOf('const STATS_TEXT')));

/** 票 02 明确要求从卡面消失的字样。 */
const BANNED = [
  />指标</,
  />数值</,
  />说明\/图形</,
  /按档位分布/,
  /受管轮次都算一次/,
  /次数不是字节/,
  /档位被切换的次数/,
  /slash 命令被调用的次数/,
  /这是上游基准，不是本机测量/, // 只剩限定语一行，这句长标题撤掉
  /比没用 ponytail 的情况/,
];

/** 票 03：这五句话必须在 `?` 里找得到（卡面上没有，不等于丢了）。 */
const IN_HELP = [
  /每个经过 Ponytail pre-step 的轮次都算一次/,
  /注入次数 \/ 受管轮次/,
  /次数不是字节/,
  /档位被切换的次数/,
  /slash 命令被调用的次数/,
];

test('卡面删掉的每一句话都在某个 `?` 里', () => {
  const missing = IN_HELP.filter((pattern) => !pattern.test(panel)).map(String);
  assert.deepEqual(missing, [], `这些句子既不卡面也不在 ? 里，等于丢了：${missing.join('，')}`);
});

test('效率卡不再出现表头、说明文本与长标签', () => {
  const hits = BANNED.filter((pattern) => pattern.test(SURFACE)).map(String);
  assert.deepEqual(hits, [], `这些解释层又回到了效率卡：${hits.join('，')}`);
});

test('清零从卡底挪进卡头菜单，卡底不再有清零按钮', () => {
  assert.match(SURFACE, /aria-haspopup="menu"/);
  // 卡底那行「清零统计」按钮消失：清零点只在菜单项里。
  assert.doesNotMatch(SURFACE, />\s*清零统计\s*</);
  // 卡底那个按钮是 `disabled={resetting || confirming}` 配文案三元；现在这个三元只喂菜单项。
  assert.doesNotMatch(SURFACE, /disabled=\{resetting \|\| confirming\}/);
  assert.doesNotMatch(SURFACE, /onClick=\{\(\) => setConfirming\(true\)\}/);
});
