/**
 * L0 · 路径词汇表。
 *
 * 只做字符串运算，不读文件系统（存在性由调用方判断），因此可以在任何
 * 环境里单测。宿主目录的解析基准来自 DSH_HOME，与宿主 dsh-app-boot 的
 * resolveDshHome 同语义：显式参数 > 环境变量 > 家目录下的 .dsh。
 */

/** 覆盖 Harness 主目录的环境变量名，与宿主同名。 */
export const DSH_HOME_ENV = 'DSH_HOME';

/** 默认 Harness 主目录名。 */
export const DSH_HOME_DIR_NAME = '.dsh';

/**
 * 本插件在 Harness 主目录下独占的子目录名，同时也是 settings 命名空间。
 *
 * 与包名一致：技能够不着它，配置面板靠它定位。改名时这一处要跟着改，
 * 且必须与 package.json#name 保持一致（见 README 的"命名"一节）。
 */
export const PLUGIN_ID = 'ponytail-58fly';

/**
 * 展开开头的 ~ 为家目录。
 * @param path - 可能是 ~ 开头的路径。
 * @param home - 家目录绝对值。
 * @returns 展开后的路径；无 ~ 前缀时原样返回。
 */
export function expandHomePath(path: string, home: string): string {
  if (path === '~') return home;
  if (path.startsWith('~/')) return home + path.slice(1);
  return path;
}

/**
 * 解析 Harness 主目录的绝对值。
 * @param configured - 显式配置值（最高优先级），空字符串视为未配置。
 * @param env - 环境变量表，默认 process.env；显式传入以便单测。
 * @param home - 家目录绝对值，默认取 os.homedir()。
 * @returns 绝对路径，无尾部分隔符。
 */
export function resolveDshHome(
  configured?: string,
  env: Record<string, string | undefined> = process.env,
  home?: string,
): string {
  const explicit = configured?.trim();
  if (explicit) return normalizeAbsolute(expandHomePath(explicit, homeDir(home)));
  const fromEnv = env[DSH_HOME_ENV]?.trim();
  if (fromEnv) return normalizeAbsolute(expandHomePath(fromEnv, homeDir(home)));
  return normalizeAbsolute(joinPath(homeDir(home), DSH_HOME_DIR_NAME));
}

/**
 * 本插件的配置目录：profile 给了就落在 profile 里，否则落在 Harness 主目录。
 * @param dshHome - resolveDshHome 的结果。
 * @param profileDir - profile 目录绝对值；未指定时用 dshHome 下的插件独占目录。
 * @returns 绝对路径。
 */
export function getConfigDir(dshHome: string, profileDir?: string): string {
  const base = profileDir?.trim() ? normalizeAbsolute(profileDir) : dshHome;
  return joinPath(base, PLUGIN_ID);
}

/**
 * 技能目录：随包发布的 skills/ 是默认位置，配置可覆盖。
 *
 * 相对路径按 Harness 主目录解析——这是唯一一处"相对路径有基准"的地方，
 * 其余路径一律要求绝对（见 #10 的越权拦截判据）。
 * @param dshHome - Harness 主目录绝对值。
 * @param configured - 配置里的 skillDir；可以是绝对路径或相对 dshHome 的路径。
 * @returns 绝对路径。
 */
export function resolveSkillDir(dshHome: string, configured?: string): string {
  const raw = configured?.trim();
  if (!raw) return joinPath(dshHome, PLUGIN_ID, 'skills');
  const expanded = expandHomePath(raw, dshHome);
  if (isAbsolutePath(expanded)) return normalizeAbsolute(expanded);
  return normalizeAbsolute(joinPath(dshHome, expanded));
}

/**
 * 把用户值里的包内标记换成包安装目录。
 *
 * 为什么需要这个标记：技能目录的**正确默认值**是包内的 `skills/`，但它是运行时值，
 * 宿主在加载 bundle patch 时不做变量展开，不能写进 `cordis.patch.yml`。
 * 裸写相对路径又会被 {@link resolveSkillDir} 按 `$DSH_HOME` 解析成
 * `$DSH_HOME/node_modules/…` —— 不是包的位置。用一个显式标记把"相对谁"说清楚：
 * 读到标记就是"相对包自身"，其余相对路径语义保持不变。
 */
export const PACKAGE_ROOT_TOKEN = '${package}';

/**
 * 解析 skillDir 的最终值。
 *
 * 标记解析是纯字符串运算：包根由调用方给（`import.meta.url` 推出来），所以本函数
 * 仍然零 I/O，可以直接单测。
 * @param raw - 配置里的原始值，可含 {@link PACKAGE_ROOT_TOKEN}。
 * @param dshHome - Harness 主目录绝对值。
 * @param packageRoot - 本包安装目录绝对值。
 * @returns 绝对路径。
 */
export function resolveSkillDirValue(raw: string | undefined, dshHome: string, packageRoot?: string): string {
  const trimmed = raw?.trim();
  const token = PACKAGE_ROOT_TOKEN;
  const usesToken = trimmed === token || (trimmed?.startsWith(token + '/') ?? false) || (trimmed?.startsWith(token + '\\') ?? false);
  if (trimmed && usesToken) {
    // 包根未知时**不能**把这个值当普通相对路径扔给 resolveSkillDir：
    // 那会拼出 `$DSH_HOME/${package}/skills` 这种带标记的怪路径。
    // 退回缺省目录，只降级不崩。
    if (!packageRoot) return resolveSkillDir(dshHome);
    const rest = trimmed.slice(token.length).replace(/^[\\/]+/, '');
    return normalizeAbsolute(joinPath(normalizeAbsolute(packageRoot), rest));
  }
  return resolveSkillDir(dshHome, trimmed);
}

/**
 * 家目录取值，抽出来只为让单测能注入。
 *
 * `override` 显式传入时以它为准：给了空串就是"家目录未知"，直接报错，
 * 绝不悄悄换回 `process.env.HOME`——那样测试会"碰巧通过"，而真正的部署
 * 事故（家目录为空）反而被掩盖。
 */
function homeDir(override?: string): string {
  if (override === undefined) return homedirImpl();
  const trimmed = override.trim();
  if (trimmed) return trimmed;
  throw new Error('无法确定家目录：HOME / USERPROFILE 均未设置');
}

/** 去掉重复分隔符与尾部分隔符（根目录除外）。 */
function normalizeAbsolute(path: string): string {
  const collapsed = path.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  if (collapsed === '/') return '/';
  return collapsed.length > 1 && collapsed.endsWith('/') ? collapsed.slice(0, -1) : collapsed;
}

/** 是否为绝对路径（POSIX 或 Windows 盘符）。 */
function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path);
}

/** 拼接路径段，不引入 node:path 以便保持零 I/O。 */
function joinPath(...parts: string[]): string {
  return parts.filter((part) => part.length > 0).join('/').replace(/\/{2,}/g, '/');
}

/** os.homedir 的惰性转发：本模块顶层不产生副作用。 */
function homedirImpl(): string {
  const fromEnv = process.env.HOME ?? process.env.USERPROFILE;
  if (fromEnv) return fromEnv;
  throw new Error('无法确定家目录：HOME / USERPROFILE 均未设置');
}