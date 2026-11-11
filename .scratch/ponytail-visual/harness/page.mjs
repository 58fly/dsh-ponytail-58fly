/**
 * 把 `render.mjs` 产出的三份面板 HTML 拼成一张可截图的静态页。
 * 三种状态并排（同宽），再各来一份 420px 紧凑宽度，用来核对窄屏退化。
 * 页面里只补 DSW 主题变量与宿主 primitives 的最小外观，不覆盖面板自己的 inline style。
 */
import { readFile, writeFile } from 'node:fs/promises';

const here = new URL('./', import.meta.url);
const panels = JSON.parse(await readFile(new URL('./out/panels.json', here), 'utf8'));
/* 展开态：由 `node render.mjs` 的第二轮产出，用来量 `?` 的卡片宽度。 */
const helped = await readFile(new URL('./out/panels-help.json', here), 'utf8').then(JSON.parse, () => ({}));

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
/* 暗色只换 token：面板源码一个色值都没写死，主题本来就只到这一层。 */
body.dark,.col.dark{
  --dsw-alias-bg-layer-1:#1e1f21; --dsw-alias-bg-layer-2:#26282b; --dsw-alias-bg-layer-3:#141516;
  --dsw-alias-border-l3:#3a3d41; --dsw-alias-label-primary:#f2f3f5; --dsw-alias-label-secondary:#a2a7ae;
  --dsw-alias-label-tertiary:#6e747b;
  --dsw-alias-state-success-primary:#3fbe83; --dsw-alias-state-warn-primary:#e0a33c;
  --dsw-alias-state-danger-primary:#f0605b; --dsw-alias-state-info-primary:#6fa4f0;
  --dsw-alias-state-business-primary:#6f92f8;
  /* 舞台色在 body 上已经算过一次；列自己重设变量后必须自己再算一次前景色，否则深字落深底。 */
  color:var(--dsw-alias-label-primary);
}
*{box-sizing:border-box}
body{margin:0;padding:24px;background:var(--dsw-alias-bg-layer-3);font-family:var(--dsw-font-family);color:var(--dsw-alias-label-primary)}
h1{font-size:16px;margin:0 0 16px}
.grid{display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap}
.col{background:var(--dsw-alias-bg-layer-1);border:0.5px solid var(--dsw-alias-border-l3);border-radius:10px;padding:16px;width:520px}
.col.narrow{width:420px}
.col.tiny{width:320px}
/* 宿主的 HoverCard 是浮层：宽度有上限、绝对定位、不参与排版。替身照抄这三点，
   否则展开态会把面板撑开，量到的宽度就不是宿主里那个宽度。 */
[data-inline]{position:relative;display:inline-flex}
/* 记录用：每列只留第一个问号的浮层。七张卡各开一个时浮层互相压盖，
   图上就看不出任何一张的宽度；留一个才量得清、也看得清。由页面末尾的
   script 删多余节点——纯 CSS 的 :first-of-type 是相对各自的父节点算的。 */
[data-hovercard]{position:absolute;top:100%;left:0;z-index:20;display:block;width:max-content;max-width:320px;padding:8px;border:0.5px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:17px;white-space:normal;box-shadow:0 4px 16px rgba(0,0,0,.18)}
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
  ['b-clean', '① 干净：三层里只有内置默认值命中', '', false],
  ['a-shaded', '② 环境变量命中：配置文件写了没赢', '', false],
  ['d-invalid', '③ 值非法：管道在配置文件层断开', '', false],
  ['e-compact', '④ 420px 紧凑：层名在上，值在下', '', true],
  ['f-320', '⑤ 320px：管道 12px 竖槽', 'tiny', false],
  ['g-invalid-320', '⑥ 320px + 值非法', 'tiny', false],
  ['a-shaded', '⑦ 暗色：命中 / 没赢 / 没轮到 / 不可观测', 'dark', false],
  ['d-invalid', '⑧ 暗色：值非法（管道断开）', 'dark', false],
  ['b-clean', '⑨ 暗色：干净安装', 'dark', false],
];

const body = ORDER.map(
  ([key, title, cls]) => `
  <div class="col ${cls}"><h2>${title}</h2>${panels[key] ?? '<em>缺少 ' + key + '</em>'}</div>`,
).join('');

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Ponytail 面板原型 · 管道诊断卡</title><style>${TOKENS}</style></head>
<body><h1>Ponytail 设置页 · 管道诊断卡（真面板组件渲染）</h1><div class="grid">${body}</div>
<h1>宽栏 / 420px / 320px / 暗色四组并排；问号展开态在 verify-help.html</h1></body></html>`;

await writeFile(new URL('./out/index.html', here), html, 'utf8');
process.stdout.write(`out/index.html ${html.length} bytes\n`);

/* 验收页二：`?` 全展开。只放 420px 与 320px 两列——`?` 在宽栏最不容易出界，窄栏才见真章。 */
const helpOrder = [
  ['a-shaded', '420px · 环境变量命中', 'narrow'],
  ['f-320', '320px · 环境变量命中', 'tiny'],
  ['d-invalid', '420px · 值非法', 'narrow'],
];
const helpBody = helpOrder
  .map(([key, title, cls]) => `
  <div class="col ${cls}"><h2>${title}</h2>${helped[key] ?? '<em>缺少 ' + key + '</em>'}</div>`)
  .join('');
const helpHtml = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Ponytail 面板 · 七个 ? 全展开</title><style>${TOKENS}</style></head>
<body><h1>Ponytail 面板 · 首个问号展开（卡片宽上限 320px，换行完整不截断）</h1><div class="grid">${helpBody}</div>
<script>
for (const col of document.querySelectorAll('.col')) {
  const cards = col.querySelectorAll('[data-hovercard]');
  for (let i = 1; i < cards.length; i += 1) cards[i].remove();
}
</script></body></html>`;
await writeFile(new URL('./out/verify-help.html', here), helpHtml, 'utf8');
process.stdout.write(`out/verify-help.html ${helpHtml.length} bytes\n`);

/* 验收页三、四：各自只装一组，截图就不用算裁切坐标了。 */
const solo = (title, rows) =>
  `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${title}</title><style>${TOKENS}</style></head><body><h1>${title}</h1><div class="grid">` +
  rows
    .map(([key, label, cls]) => `
  <div class="col ${cls}"><h2>${label}</h2>${panels[key] ?? '<em>缺少 ' + key + '</em>'}</div>`)
    .join('') +
  '</div></body></html>';

const dark = solo('⑤ 暗色主题 · 五态对比（真面板组件渲染）', [
  ['a-shaded', '命中 / 没赢 / 没轮到 / 不可观测', 'dark'],
  ['d-invalid', '值非法：管道断开', 'dark'],
  ['b-clean', '干净安装：只有内置默认值命中', 'dark'],
]);
await writeFile(new URL('./out/verify-dark.html', here), dark, 'utf8');
process.stdout.write(`out/verify-dark.html ${dark.length} bytes\n`);

const tiny = solo('⑥ 320px 窄侧栏 · 管道 12px 竖槽', [
  ['f-320', '环境变量命中', 'tiny'],
  ['g-invalid-320', '值非法', 'tiny'],
]);
await writeFile(new URL('./out/verify-320.html', here), tiny, 'utf8');
process.stdout.write(`out/verify-320.html ${tiny.length} bytes\n`);
