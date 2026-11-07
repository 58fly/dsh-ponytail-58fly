/**
 * 六个真技能经**真实宿主**跑一遍（#10 验收项）。
 *
 * 与 composition.test.mjs 的分工：那边用临时目录、一两个假技能验装配语义
 * （空目录不抛、rank 生效）；这里吃的是仓库里真实的 skills/ 目录，验的是
 * "我们要发布的东西在真实宿主上真的能被列出来、被读到、被卸干净"。
 * 前者防回归，后者防自欺——临时目录里写得再漂亮，正文里一个笔误
 * 就能让整条 catalog 变 incomplete。
 *
 * 宿主用 npm 上真实发布的 @deepseek-ai/dsh-skill 与 cordis（版本由
 * package.json 钉住），不是桩。
 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';

import { Context } from '@deepseek-ai/cordis';
import { BUNDLED_SKILL_RANK, SkillRegistry } from '@deepseek-ai/dsh-skill';
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt';

import * as Ponytail from '../lib/plugin.js';
import { PONYTAIL_SKILL_RANK, SKILL_IDS } from '../lib/skills/provider.js';
import { DESCRIPTIONS_POLICY } from '../lib/skills/description.js';

const here = dirname(fileURLToPath(import.meta.url));
/** 仓库里的真实技能目录（发布物的一部分，package.json 的 files 已包含）。 */
const REAL_SKILLS = join(here, '..', 'skills');

/** ctx.plugin 返回 thenable Fiber，装载是异步的；给微任务与定时器一次机会。 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

/**
 * 起一个最小宿主，只装本插件声明的两个硬依赖。
 * @returns 已装好 SystemPrompt 与 SkillRegistry 的上下文。
 */
async function bootHost() {
  const ctx = new Context();
  await ctx.plugin(SystemPrompt);
  await ctx.plugin(SkillRegistry);
  await settle();
  return ctx;
}

/** 真实技能目录里的六个技能，按名字排序便于比对。 */
const SORTED_IDS = [...SKILL_IDS].sort();

test('真实 skills/ 目录经宿主 ctx.skills.list() 返回恰好六个技能', async () => {
  const ctx = await bootHost();
  const fiber = await ctx.plugin(Ponytail, { skillDir: REAL_SKILLS });
  await settle();
  const listed = await ctx.skills.list({});
  const names = listed.map((skill) => skill.name).sort();
  assert.deepEqual(names, SORTED_IDS, '六个技能必须一个不少');
  for (const skill of listed) {
    assert.equal(skill.provider, 'ponytail-58fly', `${skill.name} 必须来自本插件`);
    assert.ok(skill.description.length > 0, `${skill.name} 的描述不能为空（宿主会整条抛错）`);
    // 长度口径与宿主一致：折叠后 UTF-16 长度，超了宿主会 slice 掉尾部的触发词。
    const folded = skill.description.replaceAll(/\s+/g, ' ').trim();
    assert.ok(
      folded.length <= DESCRIPTIONS_POLICY.ours,
      `${skill.name} 的描述折叠后 ${folded.length} 字符，超过我们自己把守的 ${DESCRIPTIONS_POLICY.ours}`,
    );
    // #10 定案：六个技能全部模型可调用、也全部可手动调用。
    assert.deepEqual(skill.invocation, { modelInvocable: true, userInvocable: true }, `${skill.name} 的调用策略`);
    assert.match(skill.description, /[\u4e00-\u9fff]/, `${skill.name} 的描述必须带中文触发词`);
  }
  await fiber.dispose();
  await settle();
  await ctx.fiber.dispose();
});

test('ctx.skills.get() 能取到每个技能的正文，且正文不是空串', async () => {
  const ctx = await bootHost();
  const fiber = await ctx.plugin(Ponytail, { skillDir: REAL_SKILLS });
  await settle();
  for (const id of SKILL_IDS) {
    const skill = await ctx.skills.get(id, {});
    assert.ok(skill, `${id} 必须能被 get() 取到`);
    assert.ok(skill.content.length > 100, `${id} 的正文太短，可能 frontmatter 切错了`);
    assert.ok(!skill.content.startsWith('---'), `${id} 的正文里还带着 frontmatter`);
    // resourceBase 指向技能目录，宿主的相对资源解析靠它。
    assert.equal(skill.resourceBase?.kind, 'directory', `${id} 的 resourceBase 必须是目录`);
    assert.equal(skill.resourceBase?.path, join(REAL_SKILLS, id), `${id} 的 resourceBase 必须指向它自己的目录`);
  }
  await fiber.dispose();
  await settle();
  await ctx.fiber.dispose();
});

test('插件 dispose 之后技能目录清空（不留半条缓存）', async () => {
  const ctx = await bootHost();
  const fiber = await ctx.plugin(Ponytail, { skillDir: REAL_SKILLS });
  await settle();
  assert.equal((await ctx.skills.list({})).length, SKILL_IDS.length);
  await fiber.dispose();
  await settle();
  assert.deepEqual(await ctx.skills.list({}), [], '注销后不能再留下任何技能');
  await ctx.fiber.dispose();
});

test('rank 全部是 550，且严格小于宿主内置的 600', async () => {
  // 同名时 rank 小的赢；内置包永远不该盖住插件自带的技能。
  assert.equal(PONYTAIL_SKILL_RANK, 550);
  assert.ok(PONYTAIL_SKILL_RANK < BUNDLED_SKILL_RANK, `550 必须小于真实宿主的 ${BUNDLED_SKILL_RANK}`);
});

/** 一个"故意写错"的技能目录，用来验证坏条目不拖垮其余技能。 */
async function makeBrokenDir(files) {
  const dir = await mkdtemp(join(tmpdir(), 'ponytail-broken-'));
  for (const [name, content] of Object.entries(files)) {
    await mkdir(join(dir, name), { recursive: true });
    await writeFile(join(dir, name, 'SKILL.md'), content, 'utf8');
  }
  return dir;
}

/** 一条合法技能（frontmatter 用折叠标量，与仓内六份同形）。 */
const GOOD_SKILL = ['---', 'name: good', 'description: >', '  合法技能，用来占位。', '---', '', '# Good', '', '正文'.repeat(40), ''].join('\n');

test('显式写 disable-model-invocation: false 的技能仍然出现在 list() 里', async () => {
  const dir = await makeBrokenDir({
    good: GOOD_SKILL,
    explicit: GOOD_SKILL.replace('name: good', 'name: explicit').replace(
      '  合法技能，用来占位。',
      '  合法技能，用来占位。\ndisable-model-invocation: false\nuser-invocable: true',
    ),
  });
  try {
    const ctx = await bootHost();
    const fiber = await ctx.plugin(Ponytail, { skillDir: dir });
    await settle();
    const listed = await ctx.skills.list({});
    const names = listed.map((skill) => skill.name).sort();
    assert.deepEqual(names, ['explicit', 'good'], '显式全 false 不等于禁用，两个技能都要在');
    for (const skill of listed) {
      assert.deepEqual(skill.invocation, { modelInvocable: true, userInvocable: true }, `${skill.name} 的调用策略`);
    }
    await fiber.dispose();
    await settle();
    await ctx.fiber.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('一个技能写了旧调用策略键，只跳过它自己，其余技能照常出现', async () => {
  const dir = await makeBrokenDir({
    good: GOOD_SKILL,
    legacy: GOOD_SKILL.replace('name: good', 'name: legacy').replace('  合法技能，用来占位。', '  合法技能。\nmodelInvocable: false'),
  });
  try {
    const ctx = await bootHost();
    const fiber = await ctx.plugin(Ponytail, { skillDir: dir });
    await settle();
    const listed = await ctx.skills.list({});
    assert.deepEqual(listed.map((skill) => skill.name), ['good'], '写错的那个必须被跳过，好的那个必须还在');
    await fiber.dispose();
    await settle();
    await ctx.fiber.dispose();
    // 告警走 ctx.logger.warn；这里只断言"没把整份目录炸掉"，告警文案由
    // provider 的单测与 README 兜住（日志断言会把测试绑死在日志格式上）。
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
