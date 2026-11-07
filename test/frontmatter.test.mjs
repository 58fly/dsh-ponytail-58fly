/**
 * frontmatter 解析单测。
 *
 * 用例直接取自上游 skills/ 下的真实文件形状（折叠标量 description），
 * 加上几种会被 #10 遇到的边界：缺 frontmatter、缺 description、引号、字面块。
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { parseSkillMarkdown, readSkillMarkdown, SkillFrontmatterError } from '../lib/skills/frontmatter.js';

test('折叠标量 description 被收成单行（上游六个技能的真实形状）', () => {
  const text = [
    '---',
    'name: ponytail',
    'description: >',
    '  Lazy mode. Use when the user says "be lazy", "find bloat",',
    '  or "/ponytail".',
    '---',
    '',
    '# Ponytail',
    '',
    '正文。',
    '',
  ].join('\n');
  const parsed = parseSkillMarkdown(text);
  assert.equal(parsed.name, 'ponytail');
  assert.equal(parsed.description, 'Lazy mode. Use when the user says "be lazy", "find bloat", or "/ponytail".');
  assert.equal(parsed.body, '# Ponytail\n\n正文。');
});

test('字面块 | 保留换行', () => {
  const text = ['---', 'description: |', '  第一行', '  第二行', '---', ''].join('\n');
  assert.equal(parseSkillMarkdown(text).description, '第一行\n第二行');
});

test('引号包裹的值去掉引号', () => {
  const text = ['---', 'description: "带 空格 的描述"', "name: 'x'", '---', ''].join('\n');
  const parsed = parseSkillMarkdown(text);
  assert.equal(parsed.description, '带 空格 的描述');
  assert.equal(parsed.name, 'x');
});

test('没有 frontmatter 时整篇当正文', () => {
  const parsed = parseSkillMarkdown('# Just Markdown\n\ntext');
  assert.equal(parsed.description, undefined);
  assert.equal(parsed.body, '# Just Markdown\n\ntext');
});

test('frontmatter 未闭合时整篇当正文，不静默吃掉后半段', () => {
  const parsed = parseSkillMarkdown('---\nname: x\n没有结束标记');
  assert.equal(parsed.name, undefined);
  assert.match(parsed.body, /没有结束标记/);
});

test('BOM 与 CRLF 被归一（Windows 上编辑过的文件）', () => {
  const text = '\uFEFF---\r\nname: x\r\ndescription: y\r\n---\r\nbody\r\n';
  const parsed = parseSkillMarkdown(text);
  assert.equal(parsed.name, 'x');
  assert.equal(parsed.description, 'y');
  assert.equal(parsed.body, 'body');
});

test('空值字段被丢弃，不产生空串 description', () => {
  const text = ['---', 'description:', 'name: x', '---', ''].join('\n');
  assert.equal(parseSkillMarkdown(text).description, undefined);
});

test('whenToUse 被识别（宿主 SkillSummary 有该字段）', () => {
  const text = ['---', 'description: d', 'whenToUse: 当用户提到 bloat 时', '---', ''].join('\n');
  assert.equal(parseSkillMarkdown(text).whenToUse, '当用户提到 bloat 时');
});

test('readSkillMarkdown：文件不存在时返回空结果，不抛错', async () => {
  const result = await readSkillMarkdown(join(tmpdir(), 'definitely-missing-xyz', 'SKILL.md'));
  assert.deepEqual(result, { body: '' });
});

test('readSkillMarkdown：真实文件读得到', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ponytail-fm-'));
  try {
    const path = join(dir, 'SKILL.md');
    await writeFile(path, ['---', 'description: d', '---', 'body'].join('\n'), 'utf8');
    const parsed = await readSkillMarkdown(path);
    assert.equal(parsed.description, 'd');
    assert.equal(parsed.body, 'body');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── 调用策略（#10 第 4 条）：宿主 validateInvocation 要求两值都是布尔 ──────────

test('disable-model-invocation: true 让 modelInvocable 变 false，userInvocable 兜底 true', () => {
  const text = ['---', 'description: d', 'disable-model-invocation: true', '---', ''].join('\n');
  assert.deepEqual(parseSkillMarkdown(text).invocation, { modelInvocable: false, userInvocable: true });
});

test('disable-model-invocation: false 让 modelInvocable 保持 true', () => {
  const text = ['---', 'description: d', 'disable-model-invocation: false', '---', ''].join('\n');
  assert.deepEqual(parseSkillMarkdown(text).invocation, { modelInvocable: true, userInvocable: true });
});

test('user-invocable: false 让 userInvocable 变 false，modelInvocable 兜底 true', () => {
  const text = ['---', 'description: d', 'user-invocable: false', '---', ''].join('\n');
  assert.deepEqual(parseSkillMarkdown(text).invocation, { modelInvocable: true, userInvocable: false });
});

test('两键同时给出时各自生效', () => {
  const text = ['---', 'description: d', 'disable-model-invocation: true', 'user-invocable: false', '---', ''].join('\n');
  assert.deepEqual(parseSkillMarkdown(text).invocation, { modelInvocable: false, userInvocable: false });
});

test('布尔值大小写不敏感、可带引号', () => {
  const text = ['---', 'description: d', 'disable-model-invocation: "True"', "user-invocable: 'FALSE'", '---', ''].join('\n');
  assert.deepEqual(parseSkillMarkdown(text).invocation, { modelInvocable: false, userInvocable: false });
});

test('两键都缺省时 invocation 为 undefined（由 provider 兜底，不下发空策略）', () => {
  const text = ['---', 'name: x', 'description: d', '---', ''].join('\n');
  const parsed = parseSkillMarkdown(text);
  assert.equal(parsed.invocation, undefined);
  assert.equal('invocation' in parsed, false);
});

test('旧键 disableModelInvocation 抛错，错误信息点名旧键与新键', () => {
  const text = ['---', 'description: d', 'disableModelInvocation: true', '---', ''].join('\n');
  assert.throws(
    () => parseSkillMarkdown(text),
    (error) => {
      assert.ok(error instanceof SkillFrontmatterError);
      assert.match(error.message, /disableModelInvocation/);
      assert.match(error.message, /disable-model-invocation/);
      return true;
    },
  );
});

test('旧键 modelInvocable 抛错，错误信息点名旧键与新键', () => {
  const text = ['---', 'description: d', 'modelInvocable: false', '---', ''].join('\n');
  assert.throws(
    () => parseSkillMarkdown(text),
    (error) => {
      assert.ok(error instanceof SkillFrontmatterError);
      assert.match(error.message, /modelInvocable/);
      assert.match(error.message, /disable-model-invocation/);
      assert.match(error.message, /user-invocable/);
      return true;
    },
  );
});

test('旧键 userInvocable 抛错，错误信息点名旧键与新键', () => {
  const text = ['---', 'description: d', 'userInvocable: false', '---', ''].join('\n');
  assert.throws(
    () => parseSkillMarkdown(text),
    (error) => {
      assert.ok(error instanceof SkillFrontmatterError);
      assert.match(error.message, /userInvocable/);
      assert.match(error.message, /user-invocable/);
      return true;
    },
  );
});

test('旧键即使取值是块标量也抛错（不被块解析蒙混过去）', () => {
  const text = ['---', 'description: d', 'modelInvocable: >', '  true', '---', ''].join('\n');
  assert.throws(() => parseSkillMarkdown(text), SkillFrontmatterError);
});

test('非布尔值（yes）抛错，并说明合法值', () => {
  const text = ['---', 'description: d', 'disable-model-invocation: yes', '---', ''].join('\n');
  assert.throws(
    () => parseSkillMarkdown(text),
    (error) => {
      assert.ok(error instanceof SkillFrontmatterError);
      assert.match(error.message, /true 或 false/);
      assert.match(error.message, /disable-model-invocation/);
      return true;
    },
  );
});

test('空值的调用策略键按缺省处理（模板留空不等于写了非法布尔）', () => {
  const text = ['---', 'description: d', 'user-invocable:', '---', ''].join('\n');
  assert.equal(parseSkillMarkdown(text).invocation, undefined);
  // 另一个键有值时，空值键回落到自己的缺省：disable 缺省 false、user 缺省 true。
  const mixed = ['---', 'description: d', 'disable-model-invocation: true', 'user-invocable:', '---', ''].join('\n');
  assert.deepEqual(parseSkillMarkdown(mixed).invocation, { modelInvocable: false, userInvocable: true });
});

test('readSkillMarkdown：旧键报错透传，不吞成 EMPTY', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ponytail-fm-bad-'));
  try {
    const path = join(dir, 'SKILL.md');
    await writeFile(path, ['---', 'description: d', 'userInvocable: false', '---', 'body'].join('\n'), 'utf8');
    await assert.rejects(() => readSkillMarkdown(path), SkillFrontmatterError);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('readSkillMarkdown：合法调用策略从真实文件读得到', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ponytail-fm-inv-'));
  try {
    const path = join(dir, 'SKILL.md');
    await writeFile(
      path,
      ['---', 'description: d', 'disable-model-invocation: true', '---', 'body'].join('\n'),
      'utf8',
    );
    const parsed = await readSkillMarkdown(path);
    assert.deepEqual(parsed.invocation, { modelInvocable: false, userInvocable: true });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
