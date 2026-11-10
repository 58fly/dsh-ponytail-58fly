/**
 * `/ponytail-gain`：把「效率」从一份静态记分牌变成能读本机运行期事实的命令。
 *
 * **只吃 `src/stats`**：快照与基线表都由它提供，这里不 import prompt / state / config
 * 的任何实现模块，分层矩阵（`scripts/verify.mjs` 第 3 组）才不用为它开口子。
 *
 * **口径与面板一致**：主数字 → 注入率 → 按档位分布 → 基准推算 → 出处行。差别只有
 * 两处（见 `docs/design/ponytail-efficiency-ui.md` §10）：命令里可以印起算时间，
 * 末尾固定指向面板的图形版。
 *
 * **排版为什么用 `padRight` 而不是表格**：命令结果是纯文本块，宿主按等宽渲染；
 * markdown 表格在终端里会被原样打印成一行竖线。中文是双宽字符，这里按「显示宽度」
 * 补齐（见 `displayWidth`），否则四档那几行会歪。
 *
 * **数字从 `baseline.ts` 读，不在这里写死**：`projectSavings` 的每一行已经带
 * `center/from/to/source`，本文件只负责乘与排版；系数改版只动那一处。
 *
 * @module
 */
import type { Context } from '@deepseek-ai/cordis';
import { RUNTIME_MODES } from '../l0/mode.js';
import { describeError } from '../l0/errors.js';
import {
  BASELINE,
  BASELINE_CAVEAT,
  BASELINE_NO_ACTIVE,
  baselineBasis,
  projectSavings,
  type Estimate,
} from '../stats/baseline.js';
import type { StatsHandle } from '../stats/index.js';
import type { StatsView } from '../stats/types.js';

/** 宿主注册表里的命令名（不带斜杠）。 */
export const COMMAND_NAME = 'ponytail-gain';

/** 命令名对应的日志 scope。 */
const LOGGER_SCOPE = 'ponytail-58fly';

/** 基线出处：与 `BASELINE` 的每一行同源，这里取一次给页脚用。 */
const BASELINE_SOURCE = BASELINE.outputTokens.source;

/** 第一层标题。数字是打开命令那一刻的快照，所以这里不承诺它会自己刷新。 */
const HEADLINE = 'Ponytail 效率 · 本机运行期累计（不落盘，宿主重启即清零）';

/** 空态两行，与面板同一份措辞（§7）。 */
const EMPTY_TITLE = '本机运行期累计：还没开始计数';

/** 空态正文：说清让数据出现的具体动作。 */
const EMPTY_BODY = '发一条消息就会开始记：每个经过 Ponytail pre-step 的轮次都算一次。';

/**
 * 把字符串折成终端显示宽度。
 *
 * 只处理本项目会出现的两种字符：ASCII 占 1 列，中日韩与全角标点占 2 列。
 * 够用即可——真做 Unicode 宽度表要引依赖，为了几行对齐不值得。
 * @param text - 原文。
 * @returns 显示列数。
 */
function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    const wide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6);
    width += wide ? 2 : 1;
  }
  return width;
}

/**
 * 按显示宽度右侧补空格。
 * @param text - 原文。
 * @param width - 目标显示宽度。
 * @returns 补好空格的文本（已超宽时原样返回，不截断）。
 */
function padRight(text: string, width: number): string {
  const gap = width - displayWidth(text);
  return gap > 0 ? text + ' '.repeat(gap) : text;
}

/**
 * 千分位分隔，只用于计数。
 * @param value - 非负整数。
 * @returns 分组后的字符串。
 */
function group(value: number): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * 字节数换成人类可读的近似值：命令里不该出现七位裸字节。
 * @param bytes - 累计注入字节。
 * @returns 带单位的字符串。
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return String(Math.round(bytes)) + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

/**
 * `HH:MM` 本地时间；只用于「从几点开始计数」。
 * @param epochMs - `firstAt`。
 * @returns 补零的时:分。
 */
function clockOf(epochMs: number): string {
  const date = new Date(epochMs);
  return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
}

/**
 * 一行基准推算：`输出 token   约 −45%    [−54%, −35%]`。
 *
 * `projectSavings` 给的是「token 数」（已乘过基数），这里先除以基数还原成比例，
 * 再乘 100 印成百分比：命令要说的是「比没用的情况少多少比例」，
 * 不是「少了 −4176 个 token」。
 * @param label - 指标名（中文，双宽）。
 * @param line - `projectSavings` 的一行。
 * @param base - 推算基数（非 off 轮次 × 每轮假定 token），为 0 时比例不可算。
 * @returns 定宽的一行文本。
 */
function renderBaselineRow(label: string, line: Estimate, base: number): string {
  const pct = (value: number): number => Math.round((value / base) * 100);
  const center = pct(line.center);
  const range =
    line.from === null || line.to === null
      ? '（无区间）'
      : '[' + String(pct(line.from)) + '%, ' + String(pct(line.to)) + '%]';
  return padRight(label, 12) + padRight('约 ' + String(center) + '%', 10) + range;
}

/**
 * 基准推算那一段：标题 + 三行 + 推算基数 + 出处 + 限定语 + 面板指向。
 *
 * 与面板共用「三行定值表」的取舍（§6）：只出 outputTokens / cost / time；
 * loc / gzip / turns 没法归因到本机这些轮次，不印。
 * @param managedTurns - 受管轮次。
 * @param offTurns - off 档轮次。
 * @returns 若干行文本。
 */
function baselineBlock(managedTurns: number, offTurns: number): string[] {
  const projection = projectSavings({ managedTurns, turnsByMode: { off: offTurns, lite: 0, full: 0, ultra: 0 } });
  const base = projection.activeTurns * projection.tokensPerTurn;
  const rows = ['比没用 ponytail 的情况（基准推算）'];
  rows.push('  ' + renderBaselineRow('输出 token', projection.outputTokens, base));
  rows.push('  ' + renderBaselineRow('成本', projection.cost, base));
  rows.push('  ' + renderBaselineRow('耗时', projection.time, base));
  rows.push('');
  rows.push(
    '  ' +
      (projection.activeTurns === 0
        ? BASELINE_NO_ACTIVE
        : baselineBasis(projection.activeTurns, projection.tokensPerTurn)),
  );
  rows.push('');
  rows.push('  基线：上游 39 任务 × 5 次 × 三臂，Claude Code + Opus 5.5');
  rows.push('  ' + BASELINE_SOURCE);
  rows.push('  ' + BASELINE_CAVEAT);
  rows.push('');
  rows.push('面板里有图形版：设置 → Ponytail → 效率统计。');
  return rows;
}

/**
 * 渲染整块命令输出。
 *
 * 单独导出：它不碰宿主、不碰日志，`test/gain.test.mjs` 可以直接喂快照断言文案，
 * 不必搭一个假 `ctx`。
 * @param snapshot - 统计快照。
 * @returns 命令结果的正文。
 */
export function renderGain(snapshot: StatsView): string {
  const lines = [HEADLINE];

  if (snapshot.managedTurns === 0) {
    lines.push('');
    lines.push(EMPTY_TITLE);
    lines.push(EMPTY_BODY);
    lines.push('');
    lines.push(...baselineBlock(0, 0));
    return lines.join('\n');
  }

  const rate = Math.round((snapshot.injections / snapshot.managedTurns) * 100);
  lines.push('');
  lines.push(
    '受管轮次 ' + group(snapshot.managedTurns) +
      ' · 注入 ' + group(snapshot.injections) + '（' + String(rate) + '%）' +
      ' · 切档 ' + group(snapshot.modeSwitches) + ' 次' +
      ' · 命令调用 ' + group(snapshot.commandCalls) + ' 次',
  );
  lines.push(
    '注入字节 ' + formatBytes(snapshot.injectedBytes) +
      (snapshot.firstAt === null ? '' : ' · 从 ' + clockOf(snapshot.firstAt) + ' 开始计数'),
  );
  lines.push('');
  lines.push('按档位分布（受管轮次）');
  for (const mode of RUNTIME_MODES) {
    lines.push('  ' + padRight(mode, 6) + group(snapshot.turnsByMode[mode]));
  }
  lines.push('');
  lines.push(...baselineBlock(snapshot.managedTurns, snapshot.turnsByMode.off));
  return lines.join('\n');
}

/**
 * 注册 `/ponytail-gain`。
 *
 * 统计句柄缺席时命令仍然注册，只是每次都说读不到——那比让命令凭空消失好查：
 * 用户至少知道有这条命令、以及为什么这里没有数字。
 * @param ctx - 插件上下文。
 * @param stats - 效率统计句柄（可选）。
 * @returns 无；卸载随插件 fiber。
 */
export function installGainCommand(ctx: Context, stats?: StatsHandle): void {
  const fiber = ctx.inject(['commands'], (scope) => {
    scope.commands.register({
      name: COMMAND_NAME,
      description: '查看本机 Ponytail 效率统计（受管轮次、注入次数、预估区间）',
      input: { hint: '', attachments: false },
      handler: () => {
        if (stats === undefined) {
          return {
            kind: 'error' as const,
            text: '效率统计没有接线（插件装配时缺少统计句柄），所以这里没有数字可看。',
          };
        }
        return { kind: 'success' as const, text: renderGain(stats.snapshot()) };
      },
    });
  });
  void Promise.resolve(fiber).catch((error: unknown) => {
    ctx.logger(LOGGER_SCOPE).warn('收益命令通道接线失败：' + describeError(error));
  });
}
