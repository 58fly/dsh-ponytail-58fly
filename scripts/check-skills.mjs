/**
 * 六个技能目录的发布前校验（#10 的机器化验收）。
 *
 * 为什么是独立的脚本而不是并进 verify.mjs：verify.mjs 查的是"产物与仓库纯度"，
 * 这份查的是"技能内容本身合不合契约"（描述长度、调用策略、斜杠写法、与上游的
 * 对应关系）。两者的失败含义、修法、责任人都不一样，混在一起报错会让人改错地方。
 * 但两者都在 prepublishOnly 里跑，谁红了都发不出去。
 *
 * 三条断言都来自实测，不是口味：
 * 1) 描述长度：宿主 catalogDescription（dsh-tool-skill/lib/index.js:1094-1097）先
 *    replaceAll(/\s+/g," ").trim() 再比 UTF-16 .length，超长就 slice(0, max-3)+"..."，
 *    尾部触发词会被直接吃掉。宿主上限 500，我们压到 480 留 20 字符余量。
 * 2) 调用策略：frontmatter 里不许出现 disable-model-invocation / user-invocable 的
 *    禁用形态。宿主 :944 把非 modelInvocable 的技能从模型目录里滤掉，:955 空集时
 *    整段 catalog 消失，:875/:878 的 skill 工具直接抛错——六个全禁 = 技能面归零。
 *    另外旧键（disableModelInvocation / modelInvocable / userInvocable）必须报错，
 *    静默忽略会让人以为关掉了其实没关。
 * 3) 斜杠写法：SKILL_GESTURE（:1108）是 /(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/g，
 *    只认 ASCII 空白边界。"／ponytail" 全角斜杠、"/ponytail，" 紧跟全角标点都不匹配，
 *    写进正文就是一条永远触发不了的摆设。
 */
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

/** 描述阈值：宿主上限 500，留 20 字符余量。 */
const DESCRIPTION_OURS = 480;
/** 宿主上限，只用于报错时说明"为什么是 480"。 */
const DESCRIPTION_HOST = 500;

const failures = [];
/** 不阻塞发布但必须被看见的提醒（上游漂移、网络跳过等）。 */
const warnings = [];
/**
 * @param condition - 检查是否通过。
 * @param message - 失败说明（含怎么改）。
 */
function check(condition, message) {
  if (!condition) failures.push(message);
}

/** 读文本，读不到返回 null（不抛）。 */
async function readText(path) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

/**
 * 与宿主 catalogDescription 同口径：折叠空白后量 UTF-16 长度。
 * @param value - frontmatter 里的 description 原文。
 * @returns 折叠后的字符串。
 */
function fold(value) {
  return value.replaceAll(/\s+/g, ' ').trim();
}

/**
 * 切出 frontmatter 块与正文。
 * @param text - SKILL.md 全文。
 * @returns 头部行与正文；没有合法 frontmatter 时 header 为空。
 */
function splitFrontmatter(text) {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  if ((lines[0] ?? '').trim() !== '---') return { header: [], body: normalized };
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end === -1) return { header: [], body: normalized };
  return { header: lines.slice(1, end), body: lines.slice(end + 1).join('\n') };
}

/**
 * 从头部读一个键的原始值（折叠标量与字面块都收成单行）。
 * @param header - frontmatter 行。
 * @param key - 键名。
 * @returns 原始值；不存在时 undefined。
 */
function readField(header, key) {
  const pattern = new RegExp('^' + key.replace(/[-]/g, '\\-') + ':\\s*(.*)$');
  for (let index = 0; index < header.length; index += 1) {
    const match = pattern.exec(header[index] ?? '');
    if (match === null) continue;
    const raw = (match[1] ?? '').trim();
    if (raw === '>' || raw === '|' || raw === '>-' || raw === '|-') {
      const block = [];
      let cursor = index + 1;
      while (cursor < header.length && /^\s+\S/.test(header[cursor] ?? '')) {
        block.push((header[cursor] ?? '').trim());
        cursor += 1;
      }
      return block.join(' ');
    }
    return raw;
  }
  return undefined;
}

const upstream = JSON.parse((await readText(join(root, 'skills/UPSTREAM.json'))) ?? '{}');
const expected = upstream.expectedDirs ?? [
  'ponytail',
  'ponytail-review',
  'ponytail-audit',
  'ponytail-debt',
  'ponytail-gain',
  'ponytail-help',
];

const entries = await readdir(join(root, 'skills'), { withFileTypes: true }).catch(() => null);
check(entries !== null, 'skills/ 目录不存在：六个技能是发布物的一部分，缺了整个技能面都空了。');
const dirs = (entries ?? []).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
check(
  JSON.stringify(dirs) === JSON.stringify([...expected].sort()),
  `skills/ 下的目录必须正好是 ${expected.join('、')}，实际是 ${dirs.join('、') || '(空)'}：` +
    '多一个会被 provider 一并暴露（用户看到不该有的技能），少一个等于功能缺失。',
);

/** 宿主 SKILL_GESTURE，抄一份用于正文扫描。 */
const SKILL_GESTURE = /(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/g;

for (const name of expected) {
  const path = join(root, 'skills', name, 'SKILL.md');
  const text = await readText(path);
  check(text !== null, `skills/${name}/SKILL.md 不存在`);
  if (text === null) continue;
  const { header, body } = splitFrontmatter(text);
  check(header.length > 0, `skills/${name}/SKILL.md 没有 frontmatter：宿主会给空描述，整份 catalog 抛错`);

  // 1) 描述长度与触发词
  const rawDescription = readField(header, 'description');
  check(rawDescription !== undefined && rawDescription.length > 0, `skills/${name}/SKILL.md 缺 description`);
  const folded = fold(rawDescription ?? '');
  check(
    folded.length <= DESCRIPTION_OURS,
    `skills/${name} 的描述折叠后 ${folded.length} 字符，超过我们的阈值 ${DESCRIPTION_OURS}` +
      `（宿主上限 ${DESCRIPTION_HOST}，超了会 slice(0,${DESCRIPTION_HOST}-3)+"..." 把尾部触发词吃掉）：再删几个词，或把触发词挪到描述前半段。`,
  );
  check(
    /[\u4e00-\u9fff]/.test(folded),
    `skills/${name} 的描述没有任何中文：宿主只把描述原文交给模型读（dsh-tool-skill/lib/index.js:1028-1030），` +
      '中文触发词是中文用户命中这个技能的唯一入口。',
  );
  check(
    new RegExp('`' + name + '`').test(folded) || folded.includes(name),
    `skills/${name} 的描述里没有技能名本身：斜杠命令与目录行都以名字为准，描述里不带名字会让模型对不上号。`,
  );

  // 2) 调用策略：不许出现禁用形态，不许出现旧键
  const disablesModel = header.some((line) => /^disable-model-invocation:\s*(true|yes|on)\s*$/i.test(line.trim()));
  check(
    !disablesModel,
    `skills/${name} 设了 disable-model-invocation: true：宿主要么把它从模型目录滤掉（:944 → :955 整段 catalog 消失），` +
      '要么在 skill 工具里直接抛错（:875/:878）。六个技能一个都不许关。',
  );
  const disablesUser = header.some((line) => /^user-invocable:\s*(false|no|off)\s*$/i.test(line.trim()));
  check(!disablesUser, `skills/${name} 设了 user-invocable: false：斜杠命令面会少一个入口，我们没有任何理由关它`);
  const legacy = header
    .map((line) => /^([A-Za-z][A-Za-z0-9_-]*):/.exec(line.trim())?.[1])
    .filter((key) => key === 'disableModelInvocation' || key === 'modelInvocable' || key === 'userInvocable');
  check(
    legacy.length === 0,
    `skills/${name} 用了旧调用策略键 ${legacy.join('、')}: 新键是 disable-model-invocation（布尔反向）与 user-invocable；` +
      '旧键会被 provider 直接报错，装不上。',
  );

  // 3) 正文里的斜杠写法
  for (const match of body.matchAll(SKILL_GESTURE)) {
    const token = match[2] ?? '';
    check(
      expected.includes(token) || token === '',
      `skills/${name}/SKILL.md 正文里出现了 ${'/' + token}，但 skills/ 下没有这个技能：` +
        '要么是笔误，要么是指向别的宿主的命令（如 /plugin），换成该宿主的说法。',
    );
  }
  for (const bad of body.matchAll(/[／]|\/[a-z0-9-]+[，。、；：！？）】]/g)) {
    failures.push(
      `skills/${name}/SKILL.md 正文里的 "${bad[0]}" 触发不了斜杠命令：SKILL_GESTURE（:1108）只认 ASCII 空白边界，` +
        '"／ponytail" 或 "/ponytail，xxx" 都要改成 "/ponytail xxx"（斜杠命令后留一个半角空格）。',
    );
  }
}

// ── 上游漂移报警（CI 每日跑；本地离线时只提醒） ─────────────────────────────
// 真源是 DietrichGebert/ponytail 的 skills/ 子树（#08 定案）。这里只问一句
// "上游那个 tree 还是不是我们冻的那个"：是则静默，否则说明上游改了技能内容，
// 人要去 review 差异再决定要不要跟。绝不自动同步——正文是产品内容，不是依赖。
const TREES_API = 'https://api.github.com/repos/';

/**
 * GitHub API 的请求头。匿名额度只有 60 次/小时且按出口 IP 共享，
 * CI 里必须带 token（workflow 已注入 GITHUB_TOKEN）；本地没 token 时
 * 退化成"跳过并提醒"，不阻塞发布。
 * @returns 请求头。
 */
function githubHeaders() {
  const token = process.env['GITHUB_TOKEN'];
  return {
    accept: 'application/vnd.github+json',
    'user-agent': 'dsh-ponytail-58fly-check',
    ...(token === undefined || token === '' ? {} : { authorization: 'Bearer ' + token }),
  };
}
async function checkUpstreamDrift() {
  const { repo, tag, tree } = upstream;
  if (typeof repo !== 'string' || typeof tree !== 'string') return;
  let response;
  try {
    response = await fetch(TREES_API + repo + '/git/trees/' + tree, {
      headers: githubHeaders(),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    warnings.push(`上游漂移检查跳过（网络不可达：${error instanceof Error ? error.message : error}）`);
    return;
  }
  if (response.status === 403 || response.status === 429) {
    warnings.push(`上游漂移检查跳过（GitHub 限流 HTTP ${response.status}）：CI 里请配 GITHUB_TOKEN`);
    return;
  }
  if (!response.ok) {
    // tree 对象查不到通常意味着上游删了分支或强推过：这才是最该看的情况。
    failures.push(
      `上游 skills 树 ${tree} 已查不到（HTTP ${response.status}）：${repo} 的 ${tag} 可能已被改写或删除。` +
        '核对 DISTANT 真源后更新 skills/UPSTREAM.json，别让冻结对象悬空。',
    );
    return;
  }
  const latest = await fetch(TREES_API + repo + '/commits?per_page=1&path=skills', {
    headers: githubHeaders(),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (latest === null || !latest.ok) {
    warnings.push('上游漂移检查只验了冻结对象仍存在，HEAD 对比跳过（API 不可达）');
    return;
  }
  const commits = await latest.json().catch(() => null);
  const head = Array.isArray(commits) && commits[0] !== undefined ? String(commits[0].sha ?? '') : '';
  if (head !== '' && !head.startsWith(String(tag ?? ''))) {
    warnings.push(
      `上游 ${repo} 的 skills/ 已有新提交 ${head.slice(0, 7)}（冻结在 ${tag}）：` +
        'review 差异后人工决定是否跟进，并更新 skills/UPSTREAM.json。',
    );
  }
}

if (upstream.enabled !== false) await checkUpstreamDrift();

if (failures.length > 0) {
  console.error(`\n技能校验失败 ${failures.length} 项：\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}\n`);
  process.exit(1);
}
for (const warning of warnings) console.warn(`warn: ${warning}`);
console.log(`技能校验通过（${expected.length} 个技能，描述阈值 ${DESCRIPTION_OURS}/${DESCRIPTION_HOST}，${warnings.length} 条提醒）`);
