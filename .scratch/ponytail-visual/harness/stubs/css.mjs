/** `*.module.css` 的桩：任何键名都回自己，样式表在原型页里单独注入。 */
export default new Proxy({}, { get: (_, key) => String(key) });
