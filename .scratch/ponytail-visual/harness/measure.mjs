/**
 * 票 06 的量测：全部在浏览器里量，量完再截图。
 * 1. 每列 scrollWidth / clientWidth —— 横向溢出；
 * 2. 管道 SVG 的宽高与命中值字号 —— 窄栏是否真的把槽位收窄；
 * 3. 把每个 `?` 的悬浮内容展开（替身 HoverCard 用 mouseover 开），量它有没有超出面板、文字有没有被截。
 */
export const measure = () => {
  const out = { columns: [], pipes: [], helps: [] };
  for (const col of document.querySelectorAll('.col')) {
    const title = col.querySelector('h2').textContent;
    out.columns.push({
      title,
      width: Math.round(col.getBoundingClientRect().width),
      scroll: col.scrollWidth,
      client: col.clientWidth,
      overflow: col.scrollWidth > col.clientWidth + 1,
    });
    const svg = col.querySelector('[role=group] svg');
    if (svg) {
      const box = svg.getBoundingClientRect();
      const fonts = [...col.querySelectorAll('[role=group] span')].map((n) => getComputedStyle(n).fontSize);
      out.pipes.push({
        title,
        svgWidth: Math.round(box.width),
        svgHeight: Math.round(box.height),
        fonts: [...new Set(fonts)].sort().join(' '),
        overflow: svg.scrollWidth > svg.clientWidth + 1,
      });
    }
  }

  // 展开每个 `?`：HoverCard 的锚点包在带 aria-label 的 span 里。
  const anchors = [];
  for (const col of document.querySelectorAll('.col')) {
    for (const holder of col.querySelectorAll('[data-inline]')) {
      const trigger = holder.querySelector('button[aria-label]') ?? holder;
      const label = trigger.getAttribute('aria-label') ?? (holder.textContent || '').slice(0, 8);
      anchors.push([col, holder, label]);
    }
  }
  return { out, anchorCount: anchors.length, labels: anchors.map((a) => a[2]) };
};

/** 第二步：锚点都已 hover 过（由调用方派发事件），这里量展开后的卡片。 */
export const measureCards = () => {
  const rows = [];
  for (const col of document.querySelectorAll('.col')) {
    const title = col.querySelector('h2').textContent;
    const box = col.getBoundingClientRect();
    for (const card of col.querySelectorAll('[data-hovercard]')) {
      const b = card.getBoundingClientRect();
      rows.push({
        col: title,
        width: Math.round(b.width),
        height: Math.round(b.height),
        chars: card.textContent.replace(/\s+/g, ' ').trim().length,
        beyondPanel: Math.round(Math.max(0, b.right - box.right, box.left - b.left)),
        clippedHorizontally: card.scrollWidth > card.clientWidth + 1,
        clippedVertically: card.scrollHeight > card.clientHeight + 1,
        head: card.textContent.replace(/\s+/g, ' ').trim().slice(0, 24),
      });
    }
  }
  return rows;
};
