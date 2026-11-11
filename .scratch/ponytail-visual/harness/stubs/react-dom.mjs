/** `react-dom` 的静态桩：原型不挂真实 DOM，Portal 直通 children。 */
export function createPortal(children) {
  return children;
}
export const flushSync = (fn) => fn();
export default { createPortal, flushSync, version: '18.3.1' };
