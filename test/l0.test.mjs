/**
 * L0 层纯函数单测。
 *
 * L0 是唯一"无副作用、无 I/O、不 import 任何其他层"的一层（见 `src/l0/mode.ts`
 * 与 `src/l0/paths.ts` 的文件头），因此它可以被直接单测，不需要起 Cordis 上下文。
 * 这里的每一条断言都对应上游一处真实缺陷，注释里写明是哪一条。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_MODE,
  PRIORITY_LEVELS,
  RUNTIME_MODES,
  coerceMode,
  isRuntimeMode,
} from '../lib/l0/mode.js';
import {
  DSH_HOME_ENV,
  PLUGIN_ID,
  expandHomePath,
  getConfigDir,
  resolveDshHome,
  resolveSkillDir,
  resolveSkillDirValue,
} from '../lib/l0/paths.js';

test('coerceMode：四档全认，大小写与空白归一', () => {
  for (const mode of RUNTIME_MODES) {
    assert.equal(coerceMode(mode), mode);
    assert.equal(coerceMode(mode.toUpperCase()), mode);
    assert.equal(coerceMode(`  ${mode}\t`), mode);
  }
});

test('coerceMode：非字符串一律 null，不做 String() 强转', () => {
  // 上游 src/ponytail-priority.ts:103 用 normalizeMode(String(...)) 强转，
  // 于是 undefined 变成 'undefined'、对象变成 '[object Object]'，
  // 都是"看起来归一了其实没归"的假成功。这里必须是 null。
  for (const raw of [undefined, null, 42, true, {}, [], () => {}]) {
    assert.equal(coerceMode(raw), null, `${String(raw)} 应为 null`);
  }
});

test('coerceMode：review 不是第五档，交给命令层', () => {
  // 上游 src/ponytail-commands.ts:83-84 把 'review' 当独立一次性模式，
  // src/ponytail-instructions.ts:71 用 new Set(['review']) 单列。它不经过归一化。
  assert.equal(coerceMode('review'), null);
});

test('coerceMode：无效值不回落默认档（回落是调用方的事）', () => {
  // 上游 src/ponytail-state.ts:372 把归一失败的值原样保留，制造垃圾态。
  // 本层只回答"这是不是合法档位"，不替调用方决定兜底。
  // 注意 'off ' 是**合法**的（空白会被 trim），见上一个用例；这里只放真无效值。
  for (const raw of ['', '   ', 'litee', 'ultra2', 'o ff', 'FULL2']) {
    assert.equal(coerceMode(raw), null);
  }
  assert.equal(DEFAULT_MODE, 'full');
});

test('isRuntimeMode：类型守卫与 coerceMode 判定一致', () => {
  assert.equal(isRuntimeMode('lite'), true);
  assert.equal(isRuntimeMode('LITE'), false); // 守卫不做归一，只认字面量
});

test('PRIORITY_LEVELS：顺序就是诊断链顺序', () => {
  assert.deepEqual([...PRIORITY_LEVELS], ['env', 'patch', 'fallback']);
});

test('expandHomePath：波浪号按传入 home 展开，其余原样', () => {
  assert.equal(expandHomePath('~/x', '/h'), '/h/x');
  assert.equal(expandHomePath('/a/~/b', '/h'), '/a/~/b');
  assert.equal(expandHomePath('~', '/h'), '/h');
});

test('resolveDshHome：显式 > 环境变量 > ~/.dsh', () => {
  const env = { [DSH_HOME_ENV]: '/from-env' };
  assert.equal(resolveDshHome('/explicit', env, '/home/u'), '/explicit');
  assert.equal(resolveDshHome(undefined, env, '/home/u'), '/from-env');
  assert.equal(resolveDshHome(undefined, {}, '/home/u'), '/home/u/.dsh');
  assert.equal(resolveDshHome('~/custom', {}, '/home/u'), '/home/u/custom');
});

test('resolveDshHome：空白环境变量视为未设置', () => {
  assert.equal(resolveDshHome(undefined, { [DSH_HOME_ENV]: '   ' }, '/home/u'), '/home/u/.dsh');
});

test('resolveDshHome：末尾斜杠归一（避免拼出双斜杠路径）', () => {
  assert.equal(resolveDshHome('/a/b///', {}, '/home/u'), '/a/b');
  assert.equal(resolveDshHome(undefined, { [DSH_HOME_ENV]: '/x/' }, '/home/u'), '/x');
});

test('resolveDshHome：拿不到家目录时明确报错，不静默用相对路径', () => {
  // 静默回落 '.' 会让 later 的 skillDir 变成进程 cwd，是典型的部署事故。
  assert.throws(() => resolveDshHome(undefined, {}, ''), /无法确定家目录/);
});

test('getConfigDir / resolveSkillDir：目录名带 PLUGIN_ID，不是旧包名', () => {
  assert.equal(PLUGIN_ID, 'ponytail-58fly');
  assert.equal(getConfigDir('/h/.dsh'), `/h/.dsh/${PLUGIN_ID}`);
  assert.equal(getConfigDir('/h/.dsh', '/h/.dsh/profiles/desktop'), `/h/.dsh/profiles/desktop/${PLUGIN_ID}`);
  assert.equal(resolveSkillDir('/h/.dsh'), `/h/.dsh/${PLUGIN_ID}/skills`);
});

test('resolveSkillDir：相对路径按 dshHome 解析，绝对路径原样', () => {
  assert.equal(resolveSkillDir('/h/.dsh', 'extra/skills'), '/h/.dsh/extra/skills');
  assert.equal(resolveSkillDir('/h/.dsh', '/abs/skills'), '/abs/skills');
});

test('resolveSkillDirValue：${package} 标记解析到包自身，其余语义不变', () => {
  // 这条是"装完即用"的关键：裸相对路径会被解析成 $DSH_HOME/node_modules/…，
  // 根本不是包的位置，所以必须有标记。
  assert.equal(resolveSkillDirValue('${package}/skills', '/h/.dsh', '/pkg/dsh-ponytail-58fly'), '/pkg/dsh-ponytail-58fly/skills');
  assert.equal(resolveSkillDirValue('${package}', '/h/.dsh', '/pkg/x'), '/pkg/x');
  // 包根未知时不猜：退回缺省（$DSH_HOME/<PLUGIN_ID>/skills），只降级不崩。
  assert.equal(resolveSkillDirValue('${package}/skills', '/h/.dsh'), `/h/.dsh/${PLUGIN_ID}/skills`);
  // 普通相对路径行为不受影响。
  assert.equal(resolveSkillDirValue('extra/skills', '/h/.dsh', '/pkg/x'), '/h/.dsh/extra/skills');
  assert.equal(resolveSkillDirValue('/abs/skills', '/h/.dsh', '/pkg/x'), '/abs/skills');
  assert.equal(resolveSkillDirValue(undefined, '/h/.dsh', '/pkg/x'), `/h/.dsh/${PLUGIN_ID}/skills`);
});