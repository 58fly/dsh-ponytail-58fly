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

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const panel = await readFile(join(root, 'src/client/panel.tsx'), 'utf8');

/**
 * 只取效率区块的源码：从 `STATS_TEXT` 常量到文件末尾。
 * 档位卡与诊断卡在它前面，那里出现「数值」之类不算这张卡的事。
 */
const SURFACE = panel.slice(panel.indexOf('const STATS_TEXT'));

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
