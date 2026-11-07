/**
 * 静态渲染器：一个测试与诊断用的小工具。
 *
 * 骨架阶段（#03）这里曾是提示段的占位实现；#07 换成真正的 baseline 渲染后，
 * 生产路径不再经过本文件，但"给一段定值文本造一个 PromptSection 渲染器"
 * 在组合测试里仍然有用——它可以精确控制段正文，从而单独验证宿主的段装配行为。
 *
 * 之所以保留而不是删掉：删掉会让 `lib/types/prompt/render.d.ts`（上一版构建产物）
 * 与源码不一致，而构建产物不该被手工编辑。
 */
import type { AssembleContext } from '@deepseek-ai/dsh-system-prompt';

/**
 * 造一个恒定输出同一段文本的渲染器。
 * @param text - 每次渲染返回的正文。
 * @returns 渲染器。
 */
export function createStaticRenderer(text: string): (context: AssembleContext) => string {
  return () => text;
}
