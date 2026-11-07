/**
 * 异常文本化：把任意抛出物压成一行可读文字。
 *
 * 为什么放在 l0：诊断文案在 config、prompt、commands 三处都要用。
 * 让它留在 config 层会逼着 prompt 反向依赖 config（分层检查会红灯），
 * 而这段逻辑本来就不含任何配置语义——它只是 `String(error)` 的护栏版本。
 */

/**
 * 把捕获到的异常压成一行文本。
 *
 * 只取 `message`：堆栈对"设置页那一行红色提示"没有额外信息，
 * 但会把一整段栈塞进用户界面与日志。需要堆栈时调用方自己 `console.error(error)`。
 * @param error - 捕获到的任意抛出物。
 * @returns 一行文本；非 Error 走 `String()`。
 */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
