/**
 * 真实 Cordis 组合测试（#03 验收项之一）。
 *
 * 与上游 `scripts/behavior.test.mjs` 的差别：上游大量用桩对象模拟宿主，本测试
 * 装载的是 **npm 上真实发布的宿主包**（`@deepseek-ai/dsh-system-prompt`、
 * `@deepseek-ai/dsh-skill`、`@deepseek-ai/cordis`，版本由 package.json 的
 * devDependencies 钉住），因此它检验的是真实装配语义：fiber 生命周期、service
 * 注册、section 排序、`declare module` 增强下的真实签名。
 *
 * 裸包名 import 可行的原因：这些包都已装进本仓库 node_modules，宿主运行时也从
 * 同一处解析（`~/.dsh/profiles/<name>/node_modules` 只放第三方插件自己的依赖）。
 * 不再需要 #02 原型里那条 `DSH_MODULES` 绝对路径（那条路留着给"测 App 内实装版"
 * 的场景，本文件不使用）。
 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

import { Context } from '@deepseek-ai/cordis';
import { BUNDLED_SKILL_RANK, SkillRegistry } from '@deepseek-ai/dsh-skill';
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt';

import * as Ponytail from '../lib/plugin.js';
import {
  createSkillProvider,
  BUNDLED_SKILL_RANK as LOCAL_BUNDLED_SKILL_RANK,
  PONYTAIL_SKILL_RANK,
  RANK_IS_BELOW_BUNDLED,
} from '../lib/skills/provider.js';

/** ctx.plugin 返回 thenable Fiber，装载是异步的；给微任务与定时器一次机会。 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

/**
 * 起一个最小宿主：只有本插件声明的两个硬依赖。
 * @returns 已装好 SystemPrompt 与 SkillRegistry 的上下文。
 */
async function bootHost() {
  const ctx = new Context();
  await ctx.plugin(SystemPrompt);
  await ctx.plugin(SkillRegistry);
  await settle();
  return ctx;
}

/** 读当前装配出的 section 名（顺序即优先级）。 */
async function sectionNames(ctx) {
  const assembled = await ctx.systemPrompt.assemble(undefined);
  return assembled.sections.map((section) => section.name);
}

test('装配后 prompt section 出现在 persona 之间，顺序可预测', async () => {
  const ctx = await bootHost();
  const fiber = await ctx.plugin(Ponytail);
  await settle();
  const names = await sectionNames(ctx);
  // 0.2.2 的 assemble 固定先给 harness:identity（order -1000，原型期没有这一段）。
  assert.deepEqual(names, [
    'harness:identity',
    'deployment:persona-prefix',
    'ponytail-58fly',
    'deployment:persona-suffix',
  ]);
  await fiber.dispose();
  await settle();
  await ctx.fiber.dispose();
});

test('section 的 text 是真实渲染结果，不是空串', async () => {
  const ctx = await bootHost();
  const fiber = await ctx.plugin(Ponytail);
  await settle();
  const assembled = await ctx.systemPrompt.assemble(undefined);
  const section = assembled.sections.find((item) => item.name === 'ponytail-58fly');
  assert.ok(section, 'ponytail-58fly 段必须存在');
  // assemble 只暴露 {name, text}，不含 order（#02 观测到的口径）。
  assert.deepEqual(Object.keys(section).sort(), ['name', 'text']);
  // #07 起段正文是真实的阶梯渲染（不是 #03 的占位一行）。这里装配时没有 agent，
  // 于是按全局活档位渲染——有 agent 时才走 baseline 锁。
  assert.ok(section.text.startsWith('PONYTAIL 已启用 · 档位：full'), '段正文：' + section.text);
  await fiber.dispose();
  await settle();
  await ctx.fiber.dispose();
});

test('skills provider 注册成功，空目录返回空列表而非抛错', async () => {
  const ctx = await bootHost();
  const fiber = await ctx.plugin(Ponytail, { skillDir: join(tmpdir(), 'ponytail-missing-dir-xyz') });
  await settle();
  // ENOENT 必须降级成空列表：宿主在目录不存在时仍要能出目录页。
  assert.deepEqual(await ctx.skills.list(), []);
  await fiber.dispose();
  await settle();
  await ctx.fiber.dispose();
});

test('skills provider 列出目录里的技能，rank 低于宿主内置档', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ponytail-skills-'));
  try {
    await mkdir(join(dir, 'ponytail'), { recursive: true });
    await writeFile(
      join(dir, 'ponytail', 'SKILL.md'),
      ['---', 'name: ponytail', 'description: >', '  懒人模式本体：六阶梯子。', '---', '', '# Ponytail', '', '正文。', ''].join('\n'),
      'utf8',
    );
    const ctx = await bootHost();
    const fiber = await ctx.plugin(Ponytail, { skillDir: dir });
    await settle();

    // 集成面：ctx.skills.list() 返回 SkillSummary（**不含 rank**，rank 只在
    // candidate 上）。所以 rank 的断言必须落在 provider 本身上，见下。
    const list = await ctx.skills.list();
    assert.equal(list.length, 1);
    assert.equal(list[0].name, 'ponytail');
    assert.equal(list[0].provider, 'ponytail-58fly');
    assert.equal(list[0].source, 'bundled');
    assert.equal(list[0].description, '懒人模式本体：六阶梯子。');
    assert.deepEqual(list[0].invocation, { modelInvocable: true, userInvocable: true });

    // 宿主 get 走的是 candidate → SkillDefinition 全链路，能拿到正文。
    const definition = await ctx.skills.get('ponytail');
    assert.ok(definition, 'ctx.skills.get 必须能取到技能');
    assert.equal(definition.content, '# Ponytail\n\n正文。');
    assert.equal(definition.resourceBase.kind, 'directory');
    // 断言必须拿 realpath 归一的两侧：provider 现在对每条目做 realpath（#13 判据 8），
    // 而 macOS 的 os.tmpdir() 给 /var/folders/…、realpath 回 /private/var/folders/…，
    // 直接比字符串会误报。这行本身就是"两侧都 realpath"这条约束的回归测试。
    assert.equal(definition.resourceBase.path, join(await realpath(dir), 'ponytail'));

    // candidate 面：rank 必须小于 BUNDLED_SKILL_RANK(=600)，否则同名时内置赢。
    const candidates = await createSkillProvider({ skillDir: dir }).list({});
    assert.equal(candidates.length, 1);
    assert.ok(candidates[0].rank < BUNDLED_SKILL_RANK, `rank=${candidates[0].rank} 必须 < ${BUNDLED_SKILL_RANK}`);
    assert.equal(candidates[0].rank, PONYTAIL_SKILL_RANK);

    await fiber.dispose();
    await settle();
    await ctx.fiber.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('卸载插件后 section 与技能目录一起清空，宿主服务仍在', async () => {
  const ctx = await bootHost();
  const fiber = await ctx.plugin(Ponytail);
  await settle();
  assert.ok((await sectionNames(ctx)).includes('ponytail-58fly'));
  await fiber.dispose();
  await settle();
  assert.ok(!(await sectionNames(ctx)).includes('ponytail-58fly'), 'section 必须随 fiber 一起消失');
  assert.deepEqual(await ctx.skills.list(), [], 'provider 必须随 fiber 一起消失');
  // 宿主自己的段还在，说明我们只清了自己的注册。
  const names = await sectionNames(ctx);
  assert.ok(names.includes('deployment:persona-prefix'));
  await ctx.fiber.dispose();
});

test('config 的 defaultMode 合法值生效，缺省回落 DEFAULT_MODE', async () => {
  const ctx = await bootHost();
  const fiber = await ctx.plugin(Ponytail, { defaultMode: 'lite' });
  await settle();
  const section = async () =>
    (await ctx.systemPrompt.assemble(undefined)).sections.find((s) => s.name === 'ponytail-58fly').text;
  assert.ok((await section()).startsWith('PONYTAIL 已启用 · 档位：lite'));
  await fiber.dispose();
  await settle();

  // 字段缺省：schemastery 的 validate(undefined) 返回 {}，apply 必须自己兜底。
  const fiber2 = await ctx.plugin(Ponytail, undefined);
  await settle();
  assert.ok((await section()).startsWith('PONYTAIL 已启用 · 档位：full'));
  await fiber2.dispose();
  await settle();
  await ctx.fiber.dispose();
});

test('config 的非法档位被 schemastery 在校验期拒掉，不进入 apply', async () => {
  // 这是"Schema 不给 .default()"换来的好处：非法值根本到不了运行时。
  // 上游 src/ponytail-config.ts:106-122 从环境变量取值时是 `as RuntimeMode` 硬转，
  // 垃圾值原样进系统；我们这条链路上没有任何一条路径能塞进非法档位。
  const ctx = await bootHost();
  let message = '';
  try {
    // ctx.plugin 返回的是 thenable Fiber 而不是 Promise，
    // 所以 assert.rejects 用不了（它会要求 promiseFn 返回 Promise）。
    const fiber = await ctx.plugin(Ponytail, { defaultMode: 'LITE' });
    await fiber.dispose();
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assert.match(message, /expected "off" \| "lite" \| "full" \| "ultra" but got "LITE"/);
  // 校验失败后 section 一个都不该多出来。
  assert.ok(!(await sectionNames(ctx)).includes('ponytail-58fly'));
  await ctx.fiber.dispose();
});

test('同一个上下文里重复装载同名 section 会被拒，说明注册是真的在宿主侧生效', async () => {
  const ctx = await bootHost();
  const first = await ctx.plugin(Ponytail);
  await settle();
  let rejected = false;
  try {
    const second = await ctx.plugin(Ponytail);
    await settle();
    await second.dispose();
  } catch {
    rejected = true;
  }
  assert.equal(rejected, true, '重名 section 必须抛错，否则说明 section 名没有真正占到');
  await first.dispose();
  await settle();
  await ctx.fiber.dispose();
});

test('连起两轮装配不残留（热重载等价场景）', async () => {
  const ctx = await bootHost();
  for (let round = 0; round < 2; round += 1) {
    const fiber = await ctx.plugin(Ponytail);
    await settle();
    assert.ok((await sectionNames(ctx)).includes('ponytail-58fly'));
    await fiber.dispose();
    await settle();
    assert.ok(!(await sectionNames(ctx)).includes('ponytail-58fly'));
  }
  await ctx.fiber.dispose();
});

test('本地抄的 BUNDLED_SKILL_RANK 与宿主真实值一致', () => {
  // 为什么要有这条：src/skills/provider.ts 不能从 @deepseek-ai/dsh-skill 值导入
  // （宿主 profile 里解析不到这个包，值导入会让产物带上一条必炸的运行时依赖），
  // 于是 600 被抄成了本地常量。抄来的数字会随上游漂移，这条断言就是那个哨兵：
  // 上游一旦改档，测试立刻红灯，而不是等到同名技能被内置包盖住才有人发现。
  assert.equal(LOCAL_BUNDLED_SKILL_RANK, BUNDLED_SKILL_RANK);
  assert.equal(RANK_IS_BELOW_BUNDLED, true);
  assert.ok(PONYTAIL_SKILL_RANK < BUNDLED_SKILL_RANK);
});
