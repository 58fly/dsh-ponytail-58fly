/** 极简 React 元素 → HTML 串：原型只需要 inline style 与文字，不需要事件。 */
const VOID = new Set(['br', 'hr', 'img', 'input', 'path', 'circle', 'line', 'rect', 'polyline']);

function styleToCss(style) {
  if (typeof style === 'string') return style;
  if (!style || typeof style !== 'object') return '';
  return Object.entries(style)
    .filter(([, v]) => v !== undefined && v !== null && v !== false)
    .map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}:${typeof v === 'number' && !['flex', 'flexGrow', 'flexShrink', 'opacity', 'zIndex', 'fontWeight', 'lineHeight'].includes(k) ? v + 'px' : v}`)
    .join(';');
}

function attrs(props) {
  return Object.entries(props)
    .filter(([k, v]) => k !== 'children' && v !== undefined && v !== null && v !== false && typeof v !== 'function')
    .map(([k, v]) => {
      if (k === 'style') return ` style="${styleToCss(v)}"`;
      if (k === 'className') return ` class="${v}"`;
      if (k === 'dangerouslySetInnerHTML') return ` data-html="1"`;
      if (typeof v === 'object') return '';
      if (v === true) return ` ${k}`;
      return ` ${k}="${String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}"`;
    })
    .join('');
}

export function toHtml(node) {
  if (node === null || node === undefined || node === false || node === true) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  if (Array.isArray(node)) return node.map(toHtml).join('');
  if (typeof node === 'function') return toHtml(node());
  if (typeof node === 'object' && 'type' in node) {
    const { type, props } = node;
    if (typeof type === 'function') return toHtml(type(props));
    if (type === Symbol.for('react.fragment') || type === undefined) return toHtml(props?.children ?? '');
    const tag = String(type);
    const body = toHtml(props?.children ?? '');
    if (VOID.has(tag)) return `<${tag}${attrs(props ?? {})}/>`;
    return `<${tag}${attrs(props ?? {})}>${body}</${tag}>`;
  }
  return '';
}
