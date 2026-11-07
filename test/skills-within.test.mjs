/**
 * 判据 8（技能 provider 越界防护）的回归测试（#13）。
 *
 * 三条逃逸在此之前都是真的：符号链接指向技能目录之外照样被列出、伪造
 * `locator.path` 能读到任意绝对路径、越界时 `resourceBase` 连父目录一起交出。
 * 修复后的契约写在 `src/skills/provider.ts` 文件头：**越界一律降级，不抛错**——
 * 抛错会让整条 catalog 变 incomplete，六个技能一个都用不了，比少一个更糟。
 *
 * 为什么单独一个文件：`isWithinRoot` 是个纯函数，它的边界（兄弟目录前缀、
 * 相对路径、`..` 段、盘符大小写）与 provider 的 I/O 收口是两类断言，混在
 * 一起时哪条红了不好定位。
 *
 * **两侧都必须 realpath**：macOS 的 `os.tmpdir()` 给 `/var/folders/…`，
 * 而 `realpath` 回 `/private/var/folders/…`。本文件自己构造临时目录，
 * 所以每条断言里的期望值也一律先 realpath，否则测出来的红是假的。
 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { isWithinRoot } from '../lib/l0/within.js';
import { createSkillProvider } from '../lib/skills/provider.js';

/** 一条合法技能。 */
const GOOD_SKILL = ['---', 'name: good', 'description: >', '  合法技能，用来占位。', '---', '', '# Good', '', '正文'.repeat(20), ''].join('\n');

/**
 * 造一个临时工作区：`skills/good` 是真技能，`outside/good` 在根之外。
 * @returns 已 realpath 的两侧绝对路径与清理函数。
 */
async function makeWorkspace() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ponytail-within-')));
  const skills = join(base, 'skills');
  const outside = join(base, 'outside');
  await mkdir(join(skills, 'good'), { recursive: true });
  await mkdir(join(outside, 'evil'), { recursive: true });
  await writeFile(join(skills, 'good', 'SKILL.md'), GOOD_SKILL, 'utf8');
  await writeFile(join(outside, 'evil', 'SKILL.md'), GOOD_SKILL.replace('name: good', 'name: evil'), 'utf8');
  return { base, skills, outside, cleanup: () => rm(base, { recursive: true, force: true }) };
}

/** 收集 warn 文案，测试里按需断言。 */
function collector() {
  const messages = [];
  return { messages, warn: (message) => messages.push(message) };
}

// ---------------------------------------------------------------- 纯函数边界

test('isWithinRoot：根目录本身算在内', () => {
  assert.equal(isWithinRoot('/a/b', '/a/b'), true);
});

test('isWithinRoot：子目录算在内', () => {
  assert.equal(isWithinRoot('/a/b', '/a/b/c'), true);
  assert.equal(isWithinRoot('/a/b', '/a/b/c/d/SKILL.md'), true);
});

test('isWithinRoot：兄弟目录不算（不能用裸 startsWith）', () => {
  // 这就是 isWithinRoot 存在的理由：'/a/bc' 以 '/a/b' 开头，但它不是 '/a/b' 的子路径。
  assert.equal(isWithinRoot('/a/b', '/a/bc'), false);
  assert.equal(isWithinRoot('/a/b', '/a/bc/d'), false);
});

test('isWithinRoot：路径分隔符边界归一（尾斜杠、重复斜杠）', () => {
  assert.equal(isWithinRoot('/a/b/', '/a/b/c'), true);
  assert.equal(isWithinRoot('/a//b', '/a/b/c'), true);
  assert.equal(isWithinRoot('/a/b', '/a/b/c/'), true);
});

test('isWithinRoot：相对路径一律不算（fail-closed）', () => {
  assert.equal(isWithinRoot('a/b', '/a/b/c'), false);
  assert.equal(isWithinRoot('/a/b', 'c'), false);
  assert.equal(isWithinRoot('', '/a/b'), false);
  assert.equal(isWithinRoot('/a/b', ''), false);
});

test('isWithinRoot：含 . 或 .. 段的路径一律不算（没 realpath 过就不该进判定）', () => {
  assert.equal(isWithinRoot('/a/b', '/a/b/../etc/passwd'), false);
  assert.equal(isWithinRoot('/a/b', '/a/b/./c'), false);
});

test('isWithinRoot：POSIX 根是所有人的根', () => {
  assert.equal(isWithinRoot('/', '/anything/at/all'), true);
  assert.equal(isWithinRoot('/', 'relative'), false);
});

test('isWithinRoot：盘符只折大小写，不同盘符不算', () => {
  assert.equal(isWithinRoot('C:/a', 'c:/a/b'), true);
  assert.equal(isWithinRoot('C:/a', 'D:/a/b'), false);
  assert.equal(isWithinRoot('C:/', 'C:/x'), true);
});

// ------------------------------------------------------------ provider 收口

test('list()：符号链接指向技能目录之外时跳过并告警', async () => {
  const { skills, outside, cleanup } = await makeWorkspace();
  try {
    await symlink(join(outside, 'evil'), join(skills, 'evil-linked'));
    const notes = collector();
    const provider = createSkillProvider({ skillDir: skills, warn: notes.warn });
    const candidates = await provider.list({});
    assert.deepEqual(candidates.map((c) => c.name), ['good'], '越界的符号链接不能出现在目录里');
    const hit = notes.messages.find((m) => m.includes('evil-linked'));
    assert.ok(hit, `必须有一条告警点名 evil-linked，实得：${JSON.stringify(notes.messages)}`);
    assert.ok(hit.includes(await realpath(outside)), `告警要写出真实逃逸目标，实得：${hit}`);
  } finally {
    await cleanup();
  }
});

test('get()：伪造 locator.path 指向根之外时返回 undefined（不抛错）', async () => {
  const { skills, outside, cleanup } = await makeWorkspace();
  try {
    const notes = collector();
    const provider = createSkillProvider({ skillDir: skills, warn: notes.warn });
    const [candidate] = await provider.list({});
    assert.ok(candidate, '前置：真技能必须能列出来');
    const forged = { ...candidate, locator: { path: join(outside, 'evil', 'SKILL.md') } };
    const definition = await provider.get(forged);
    assert.equal(definition, undefined, '越界读取必须降级成 undefined');
    const hit = notes.messages.find((m) => m.includes('已拒绝读取'));
    assert.ok(hit, `必须有一条拒绝告警，实得：${JSON.stringify(notes.messages)}`);
  } finally {
    await cleanup();
  }
});

test('get()：路径不存在时返回 undefined（ENOENT 也是降级，不是错误）', async () => {
  const { skills, cleanup } = await makeWorkspace();
  try {
    const provider = createSkillProvider({ skillDir: skills, warn: () => {} });
    const [candidate] = await provider.list({});
    assert.ok(candidate);
    const gone = { ...candidate, locator: { path: join(skills, 'good', 'NOPE.md') } };
    assert.equal(await provider.get(gone), undefined);
  } finally {
    await cleanup();
  }
});

test('正常技能不受影响：list 与 get 都照常，resourceBase 指向已 realpath 的目录', async () => {
  const { skills, cleanup } = await makeWorkspace();
  try {
    const notes = collector();
    const provider = createSkillProvider({ skillDir: skills, warn: notes.warn });
    const candidates = await provider.list({});
    assert.deepEqual(candidates.map((c) => c.name), ['good'], '真技能必须还在');
    const definition = await provider.get(candidates[0]);
    assert.ok(definition, '真技能必须能取到正文');
    assert.ok(definition.content.includes('# Good'));
    assert.equal(definition.resourceBase.kind, 'directory');
    assert.equal(definition.resourceBase.path, join(skills, 'good'));
    assert.deepEqual(notes.messages, [], '正常路径不该有任何告警');
  } finally {
    await cleanup();
  }
});

test('缺 description 的告警带真实目录名与真实路径（转义 bug 的回归）', async () => {
  const { skills, cleanup } = await makeWorkspace();
  try {
    await mkdir(join(skills, 'silent'), { recursive: true });
    await writeFile(join(skills, 'silent', 'SKILL.md'), ['---', 'name: silent', '---', '', '# Silent', ''].join('\n'), 'utf8');
    const notes = collector();
    const provider = createSkillProvider({ skillDir: skills, warn: notes.warn });
    const candidates = await provider.list({});
    assert.deepEqual(candidates.map((c) => c.name), ['good'], '空描述的技能必须被跳过');
    const hit = notes.messages.find((m) => m.includes('缺少 description'));
    assert.ok(hit, `必须有一条空描述告警，实得：${JSON.stringify(notes.messages)}`);
    // 修复前这里输出的是字面量 "${name}" 与 "${path}"，两个变量名都不该出现。
    assert.ok(!hit.includes('${'), `占位符没有被插值：${hit}`);
    assert.ok(hit.includes('silent'), `告警要点名真实目录名，实得：${hit}`);
    assert.ok(hit.includes(join(skills, 'silent', 'SKILL.md')), `告警要写出真实路径，实得：${hit}`);
  } finally {
    await cleanup();
  }
});

test('技能目录本身不存在时 list() 返回空数组（未装技能不是错误）', async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ponytail-within-')));
  try {
    const notes = collector();
    const provider = createSkillProvider({ skillDir: join(base, 'nope'), warn: notes.warn });
    assert.deepEqual(await provider.list({}), []);
    assert.deepEqual(notes.messages, []);
    assert.equal(await provider.get({ name: 'x', description: 'x', source: 'bundled', provider: 'p', rank: 1, path: join(base, 'nope', 'x', 'SKILL.md') }), undefined);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
