/**
 * 把 `render.mjs` 产出的三份面板 HTML 拼成一张可截图的静态页。
 * 三种状态并排（同宽），再各来一份 420px 紧凑宽度，用来核对窄屏退化。
 * 页面里只补 DSW 主题变量与宿主 primitives 的最小外观，不覆盖面板自己的 inline style。
 */
import { readFile, writeFile } from 'node:fs/promises';

const here = new URL('./', import.meta.url);
const panels = JSON.parse(await readFile(new URL('./out/panels.json', here), 'utf8'));

const TOKENS = `
:root{
  --dsw-alias-bg-layer-1:#ffffff; --dsw-alias-bg-layer-2:#f7f7f8; --dsw-alias-bg-layer-3:#efeff1;
  --dsw-alias-border-l3:#e3e3e6; --dsw-alias-label-primary:#17181a; --dsw-alias-label-secondary:#6b6f76;
  --dsw-alias-label-tertiary:#9aa0a6;
  --dsw-alias-state-success-primary:#1a9e5f; --dsw-alias-state-warn-primary:#c47b00;
  --dsw-alias-state-danger-primary:#d1332e; --dsw-alias-state-info-primary:#2a6fd6;
  --dsw-alias-state-business-primary:#3d6ef5;
  --dsw-font-family:-apple-system,"SF Pro Text","PingFang SC",sans-serif;
  --dsw-font-mono:ui-monospace,"SF Mono",Menlo,monospace;
  --dsw-radius-md:8px;
}
*{box-sizing:border-box}
body{margin:0;padding:24px;background:var(--dsw-alias-bg-layer-3);font-family:var(--dsw-font-family);color:var(--dsw-alias-label-primary)}
h1{font-size:16px;margin:0 0 16px}
.grid{display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap}
.col{background:var(--dsw-alias-bg-layer-1);border:0.5px solid var(--dsw-alias-border-l3);border-radius:10px;padding:16px;width:520px}
.col.narrow{width:420px}
.col>h2{font-size:12px;margin:0 0 12px;color:var(--dsw-alias-label-secondary);font-family:var(--dsw-font-mono)}
button{font:inherit;font-size:12px;border:0.5px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-1);border-radius:6px;padding:3px 8px;cursor:pointer;color:inherit}
button[aria-checked=true]{background:var(--dsw-alias-bg-layer-1);box-shadow:0 0 0 1px var(--dsw-alias-border-l3);font-weight:600}
[role=radiogroup]{display:flex;gap:2px;background:var(--dsw-alias-bg-layer-3);padding:2px;border-radius:7px}
[role=radiogroup] button{border:none;background:transparent;flex:1;text-align:center}
[role=radiogroup] button[aria-checked=true]{background:var(--dsw-alias-bg-layer-1)}
[data-tag]{display:inline-flex;align-items:center;font-size:11px;line-height:16px;padding:0 6px;border-radius:4px;border:0.5px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-secondary)}
[data-tag=success]{color:var(--dsw-alias-state-success-primary);border-color:currentColor}
[data-tag=warning]{color:var(--dsw-alias-state-warn-primary);border-color:currentColor}
[data-tag=danger]{color:var(--dsw-alias-state-danger-primary);border-color:currentColor}
[data-tag=info]{color:var(--dsw-alias-state-info-primary);border-color:currentColor}
code{font-family:var(--dsw-font-mono);font-size:11px}
table{border-collapse:collapse;width:100%}
`;

const ORDER = [
  ['b-clean', '① 干净：三层里只有内置兜底命中', false],
  ['a-shaded', '② 环境变量命中：补丁层写了没赢', false],
  ['d-invalid', '③ 值非法：管道在补丁层断开', false],
  ['e-compact', '④ 420px 紧凑：层名在上，值在下', true],
];

const body = ORDER.map(
  ([key, title, narrow]) => `
  <div class="col${narrow ? ' narrow' : ''}"><h2>${title}</h2>${panels[key] ?? '<em>缺少 ' + key + '</em>'}</div>`,
).join('');

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Ponytail 面板原型 · 管道诊断卡</title><style>${TOKENS}</style></head>
<body><h1>Ponytail 设置页 · 管道诊断卡（真面板组件渲染）</h1><div class="grid">${body}</div></body></html>`;

await writeFile(new URL('./out/index.html', here), html, 'utf8');
process.stdout.write(`out/index.html ${html.length} bytes\n`);
