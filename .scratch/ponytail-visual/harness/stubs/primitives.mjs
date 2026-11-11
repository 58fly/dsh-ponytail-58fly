/**
 * 宿主 primitives 的**同形替身**：只保留面板用到的五个，标记与文字输出与宿主一致，
 * 样式从简（原型页自己注入）。换掉的是宿主组件的外观实现，不是面板逻辑。
 */
import { createElement as h, useState } from 'react';
import { helpState } from '../harness.mjs';

export function Button({ children, variant, size, disabled, onClick, ...rest }) {
  return h('button', { ...rest, disabled, onClick, 'data-variant': variant ?? '', 'data-size': size ?? '' }, children);
}

export function Tag({ children, tone }) {
  return h('span', { 'data-tag': tone ?? 'default' }, children);
}

export function SegmentedControl({ id, label, value, options, onChange, disabled }) {
  return h(
    'div',
    { role: 'radiogroup', 'aria-label': label, id, 'data-value': value },
    options.map((option) =>
      h(
        'button',
        {
          key: option.value,
          role: 'radio',
          'aria-checked': option.value === value,
          title: option.title,
          disabled,
          onClick: () => onChange(option.value),
        },
        option.label,
      ),
    ),
  );
}

export function PathLabel({ path }) {
  return h('code', { 'data-path': path }, path);
}

export function HoverCard({ anchor, content, inline }) {
  // 展开态初值来自 harness 的开关：票 06 要有「展开后」的那一帧才能量宽度。
  const [open, setOpen] = useState(helpState.expanded);
  return h(
    'span',
    {
      'data-inline': inline ? '1' : '0',
      onMouseEnter: () => setOpen(true),
      onMouseLeave: () => setOpen(false),
    },
    anchor,
    open ? h('span', { 'data-hovercard': '1' }, content) : null,
  );
}

/** Menu：只画锚点与（开着时的）条目列表。原型里不点菜单，够看排版即可。 */
export function Menu({ open, anchor, items }) {
  return h(
    'span',
    { 'data-menu': open ? 'open' : 'closed' },
    anchor,
    open && items
      ? h('span', { 'data-menu-list': '1', role: 'menu' }, items.map((item) => h('span', { key: item.id, role: 'menuitem' }, item.label)))
      : null,
  );
}
