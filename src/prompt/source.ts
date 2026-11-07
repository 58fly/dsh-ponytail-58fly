/**
 * prompt · 阶梯正文的进程内缓存。
 *
 * 上游每渲染一次就 `readFileSync` 一次（src/ponytail-instructions.ts:84），而渲染在
 * **每次 assemble** 都发生，同一轮里还可能被组装多次（system prompt、子代理、
 * 摘要压缩各一次）。一个 54 行的 markdown 在热路径上被同步读多遍，代价不在
 * 磁盘带宽而在**同步系统调用阻塞事件循环**。
 *
 * 但缓存有个绕不过去的约束：宿主 `PromptSection.text` 是同步签名
 * （`string | ((context) => string)`，见 dsh-system-prompt 的
 * `PromptSection`），**assemble 里不可能 await 一次 stat**。
 *
 * 所以分工是这样：
 *
 * - {@link LadderSource.refresh} 是异步的，由 `agent/pre-step` 每步调一次
 *   （那里本来就 async），负责 stat + 按需重读；
 * - {@link LadderSource.body} 是同步 getter，assemble 直接读缓存，零系统调用。
 *
 * 失效判据用 `mtimeMs + size` 而不是内容哈希：后者要读完整个文件才能算，
 * 而我们想省掉的正是那次读。文件被改到同一毫秒且长度不变的概率在人工编辑下
 * 可忽略；真遇到了，下一次改动的 mtime 会往前跳。
 */
import { readFileSync, statSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { stripFrontmatter } from './ladder.js';

/** 主技能在技能目录里的相对位置。 */
const LADDER_RELATIVE = ['ponytail', 'SKILL.md'] as const;

/** 一次刷新后观察到的文件指纹。 */
interface StatStamp {
  /** 最后修改时间（毫秒）。 */
  readonly mtimeMs: number;
  /** 字节数。 */
  readonly size: number;
}

/**
 * 阶梯正文的来源。
 *
 * 生命周期跟插件 fiber 一致；`dispose()` 之后所有方法退化为空操作，
 * 防止卸载后迟到的 pre-step 回调还在读盘。
 */
export class LadderSource {
  readonly #path: string;
  #body = '';
  #stamp: StatStamp | null = null;
  #problem: string | null = null;
  #disposed = false;

  /**
   * @param skillDir - 技能目录绝对值。
   */
  constructor(skillDir: string) {
    this.#path = join(skillDir, ...LADDER_RELATIVE);
  }

  /** SKILL.md 的绝对路径，诊断与测试用。 */
  get path(): string {
    return this.#path;
  }

  /**
   * 当前缓存的正文（已剥 frontmatter）。
   *
   * 读不到时返回空字符串而不是抛错：assemble 抛错会让整个 system prompt 组装失败，
   * 用户会看到"发送消息没反应"。空正文的后果只是阶梯规则不出现，显式得多。
   * @returns 正文或空串。
   */
  get body(): string {
    return this.#body;
  }

  /** 最近一次刷新遇到的问题；没问题时为 null。诊断面板读它。 */
  get problem(): string | null {
    return this.#problem;
  }

  /**
   * 重读一次（必要时）。
   *
   * 三步：stat 拿指纹 → 指纹没变就什么都不做 → 变了才读文件并剥 frontmatter。
   * 任何一步失败都只记 `problem` 并**保留上一份正文**：文件被误删/被编辑器写成
   * 半截时，继续用上一份好内容，比让 prompt 突然清空安全得多。
   * @returns 无。
   */
  async refresh(): Promise<void> {
    if (this.#disposed) return;
    let stamp: StatStamp;
    try {
      const info = await stat(this.#path);
      stamp = { mtimeMs: info.mtimeMs, size: info.size };
    } catch (error) {
      this.#problem = '读不到阶梯正文：' + this.#path + '（' + describe(error) + '）';
      return;
    }
    if (this.#stamp !== null && this.#stamp.mtimeMs === stamp.mtimeMs && this.#stamp.size === stamp.size) {
      return;
    }
    let markdown: string;
    try {
      markdown = await readFile(this.#path, 'utf8');
    } catch (error) {
      this.#problem = '读阶梯正文失败：' + this.#path + '（' + describe(error) + '）';
      return;
    }
    this.#body = stripFrontmatter(markdown);
    this.#stamp = stamp;
    this.#problem = null;
  }

  /**
   * 同步预备一次：给"第一次 assemble"用。
   *
   * 为什么必须有它：`PromptSection.text` 是同步签名，插件的第一次 assemble 可能
   * 早于第一次 `agent/pre-step`（宿主在提交本步之前就装配 prompt），此时缓存还空着，
   * 前缀段会渲染成空——用户看到的是"档位声明消失了"，而这不是可接受的降级。
   *
   * 为什么它不违反"不在热路径同步读盘"：只在 `apply` 里调一次，全生命周期一次
   * 同步读；此后每步走 {@link refresh} 的异步 stat。上游是每轮三次，这里是每次
   * 插件装载一次。
   * @returns 无。
   */
  primeSync(): void {
    if (this.#disposed || this.#stamp !== null) return;
    try {
      const markdown = readFileSync(this.#path, 'utf8');
      const info = statSync(this.#path);
      this.#body = stripFrontmatter(markdown);
      this.#stamp = { mtimeMs: info.mtimeMs, size: info.size };
      this.#problem = null;
    } catch (error) {
      this.#problem = '读不到阶梯正文：' + this.#path + '（' + describe(error) + '）';
    }
  }

  /** 标记失效。 */
  dispose(): void {
    this.#disposed = true;
    this.#body = '';
    this.#stamp = null;
  }
}

/**
 * 把任意异常压成一行。
 * @param error - 捕获到的异常。
 * @returns 一行文本。
 */
function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
