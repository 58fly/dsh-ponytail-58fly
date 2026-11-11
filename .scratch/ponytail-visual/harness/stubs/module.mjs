/** 解析不到的裸包名的占位：任意导出都是空 React 组件或空函数。 */
import { createElement } from 'react';

const empty = () => null;
const handler = {
  get(_target, key) {
    if (key === '__esModule') return true;
    if (key === 'default') return empty;
    if (typeof key === 'symbol') return undefined;
    if (/^use[A-Z]/.test(String(key))) return () => undefined;
    return empty;
  },
};
const proxy = new Proxy({}, handler);
export const createPortal = (children) => children;
export default proxy;
void createElement;
