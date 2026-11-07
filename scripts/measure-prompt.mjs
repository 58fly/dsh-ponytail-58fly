/**
 * 前缀稳定性测量（#07 验收项之一：前缀不变必须被证明）。
 *
 * 这个脚本只做三件事，全部基于**真实宿主包**（不是桩）：
 * 1. 起一个最小宿主，装本插件，造一个带 id 的 agent；
 * 2. 装一次系统提示、切一次档、再装一次，逐字节比对两段前缀；
 * 3. 打印每段的 UTF-8 字节数，以及当轮 reminder 的字节数。
 *
 * **关于 token**：宿主没有对外暴露统一的 tokenizer（不同 provider 各算各的），
 * 所以这里如实给 `null`，不拿"4 字节≈1 token"之类的经验值糊弄——那种数字
 * 在中文与代码混排下误差可以到 2 倍。真要 token 数，请用目标 provider 的
 * 计数接口，本脚本只保证字节数精确。
 *
 * 用法：`node scripts/measure-prompt.mjs`
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Context } from '@deepseek-ai/cordis';
import { SkillRegistry } from '@deepseek-ai/dsh-skill';
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt';

import * as Ponytail from '../lib/plugin.js';
import { runtimeOf, PRIORITY_ENV_NAME } from '../lib/plugin.js';
import { renderModeUpdate, stripFrontmatter } from '../lib/prompt/ladder.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SECTION = 'ponytail-58fly';

/** 等一次事件循环：ctx.plugin 是异步装载。 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

/**
 * 把装配结果拼成宿主最终发出去的 system prompt。
 *
 * 与宿主 `renderPrompt` 完全一致（dsh-system-prompt/lib/index.js:119-121）：
 * 丢弃空段，其余用两个换行连接。这里自己拼是为了把"段"与"整条前缀"都量出来。
 * @param assembly - assemble 的返回值。
 * @returns 渲染后的文本。
 */
const render = (assembly) =>
  assembly.sections
    .map((section) => section.text)
    .filter((text) => typeof text === 'string' && text.length > 0)
    .join('\n\n');

/** UTF-8 字节数。 */
const bytes = (text) => Buffer.byteLength(text, 'utf8');

const ctx = new Context();
await ctx.plugin(SystemPrompt);
await ctx.plugin(SkillRegistry);
await settle();

const fiber = await ctx.plugin(Ponytail, {
  defaultMode: 'full',
  skillDir: join(ROOT, 'skills'),
});
await settle();

// 造一个"有会话身份"的 agent：段正文的 baseline 锁只在能读到 agent 时生效。
const agent = { id: 'measure-session' };
const assembleFor = () => ctx.systemPrompt.assemble({ agent, scope: agent });

const firstAssembly = await assembleFor();
const firstPrompt = render(firstAssembly);
const firstSection = firstAssembly.sections.find((item) => item.name === SECTION)?.text ?? '';

// 切档：走与命令、面板同一条写入口之外的那条路径（环境变量），
// 这样不需要 settings 服务也能改活档位。
process.env[PRIORITY_ENV_NAME] = 'ultra';
await runtimeOf(fiber.ctx).refresh();
await settle();

const secondAssembly = await assembleFor();
const secondPrompt = render(secondAssembly);
const secondSection = secondAssembly.sections.find((item) => item.name === SECTION)?.text ?? '';

const identical = firstPrompt === secondPrompt;
// 与运行时一致：正文先剥 frontmatter（LadderSource 在读盘时做同一件事）。
const ladderBody = stripFrontmatter(readFileSync(join(ROOT, 'skills', 'ponytail', 'SKILL.md'), 'utf8'));
const reminder = renderModeUpdate('ultra', 'full', ladderBody);

console.log('=== 前缀稳定性 ===');
console.log('切档前档位：full；切档后活档位：' + runtimeOf(fiber.ctx).mode);
console.log('整条 system prompt 字节（切档前）：' + bytes(firstPrompt));
console.log('整条 system prompt 字节（切档后）：' + bytes(secondPrompt));
console.log('逐字节相同：' + identical);
console.log('ponytail 段字节（切档前）：' + bytes(firstSection));
console.log('ponytail 段字节（切档后）：' + bytes(secondSection));
console.log('');
console.log('=== 当轮新增 ===');
console.log('切档 reminder 字节：' + bytes(reminder));
console.log('token：null（宿主未暴露统一 tokenizer，按 provider 自行计数）');

await fiber.dispose();
await settle();
await ctx.fiber.dispose();

if (!identical) {
  console.error('前缀被切档改动了——KV cache 会失效，这是 #07 的硬约束，必须修。');
  process.exitCode = 1;
}
