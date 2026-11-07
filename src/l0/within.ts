/**
 * L0 · 路径包含判定。
 *
 * 只回答一个问题：一个**已经规约过**的绝对路径，是否落在某个**同样已经规约过**的
 * 根目录之内。不做任何 I/O，也不替你调 `realpath`——两侧的规约由调用方负责，
 * 因为只有调用方知道哪一侧可以安全解析（本仓里是 `fs.realpath`，见
 * `src/skills/provider.ts`）。与 `paths.ts` 的分工：那边是"宿主目录怎么拼"，
 * 这里是"拼出来的东西有没有跑出围栏"，后者是安全判定，宁可误拒不可误放。
 *
 * **为什么不能只用 `String.prototype.startsWith`**：`/a/bc` 确实以 `/a/b` 开头，
 * 但它是 `/a/b` 的兄弟而不是子孙。把"开头相同"当"在目录里"，攻击者只需在根
 * 目录旁边放一个同前缀目录（`skills-evil` 之于 `skills`）就整条绕过。必须按
 * 分隔符边界比较：等于根，或以 `根 + /` 开头。
 *
 * **为什么不折叠大小写**：`realpath` 返回的是文件系统里的真实大小写，两侧都
 * 折过一次就不该再折第二次；反过来折了会把 `SKILLS` 与 `skills` 当成同一个
 * 目录，在大小写敏感的文件系统上放过一次真实的越界。唯一的例外是 Windows
 * 的盘符字母——它不区分大小写，只折那一个字符。
 */

/** POSIX 根目录。 */
const POSIX_ROOT = '/';

/** 盘符式绝对路径前缀（Windows，分隔符已归一成 `/`）。 */
const DRIVE_PREFIX = /^[A-Za-z]:\//;

/** `C:` 这种"盘符根"归一后的形态，用来判断尾部分隔符该不该削。 */
const DRIVE_ONLY = /^[A-Za-z]:$/;

/**
 * 压成可以逐字比较的形态：统一分隔符、折叠重复分隔符、去掉尾部分隔符。
 *
 * 不处理 `.` 与 `..`——遇到它们 {@link isWithinRoot} 直接判否（见下），
 * 因为规约过的路径里不该出现这两个段，出现了就说明调用方没做规约。
 * 也不支持 UNC（`\\server\share`）：本仓的路径来源是 `DSH_HOME` 与包根，
 * 两者都不是 UNC，为不存在的形态写分支只会挡住测试。
 * @param path - 任意路径字符串。
 * @returns 归一后的字符串；空输入仍是空串。
 */
function canonical(path: string): string {
  const unified = path.replaceAll('\\', '/');
  const collapsed = unified.replaceAll(/\/{2,}/g, '/');
  const trimmed = collapsed.length > 1 && collapsed.endsWith('/') ? collapsed.slice(0, -1) : collapsed;
  // `C:/` 削尾斜杠会变成 `C:`，那既不是绝对路径也不是可比的根，补回来。
  return DRIVE_ONLY.test(trimmed) ? trimmed + '/' : trimmed;
}

/** 是否为绝对路径（POSIX 或 Windows 盘符）。 */
function isAbsolutePath(path: string): boolean {
  return path.startsWith(POSIX_ROOT) || DRIVE_PREFIX.test(path);
}

/** 只把盘符字母折成小写：`C:/a` 与 `c:/a` 是同一个位置。 */
function foldDrive(path: string): string {
  return DRIVE_PREFIX.test(path) ? path.slice(0, 1).toLowerCase() + path.slice(1) : path;
}

/** 是否含 `.` 或 `..` 段。 */
function hasRelativeSegment(path: string): boolean {
  for (const segment of path.split('/')) {
    if (segment === '.' || segment === '..') return true;
  }
  return false;
}

/**
 * 候选路径是否落在根目录之内（含根目录本身）。
 *
 * 契约明确：`root` 与 `candidate` 都必须已经是绝对路径、且已经过
 * `realpath` 规约。不满足契约时一律返回 `false`（fail-closed）：判定跑在
 * 安全路径上，"说不清"必须当成"不在里面"，否则一个没规约的
 * `/skills/../../../etc` 就能让校验形同虚设。
 * @param root - 围栏根目录，已规约的绝对路径。
 * @param candidate - 待判定的路径，已规约的绝对路径。
 * @returns 在根之内（或就是根本身）返回 `true`，其余一律 `false`。
 */
export function isWithinRoot(root: string, candidate: string): boolean {
  const base = canonical(root);
  const target = canonical(candidate);
  if (base.length === 0 || target.length === 0) return false;
  if (!isAbsolutePath(base) || !isAbsolutePath(target)) return false;
  if (hasRelativeSegment(base) || hasRelativeSegment(target)) return false;
  const fence = foldDrive(base);
  const subject = foldDrive(target);
  // 根是文件系统根时没有边界可言：所有绝对路径都在里面。
  if (fence === POSIX_ROOT) return true;
  // 盘符根的写法自带尾斜杠（C:/），再补一个会拼出 C://；两者都要认。
  return subject === fence || subject.startsWith(fence.endsWith('/') ? fence : fence + '/');
}
