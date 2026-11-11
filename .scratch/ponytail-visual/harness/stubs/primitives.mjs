/**
 * 宿主 primitives 的**同形替身**：只保留面板用到的五个，标记与文字输出与宿主一致，
 * 样式从简（原型页自己注入）。换掉的是宿主组件的外观实现，不是面板逻辑。
 */
import { createElement as h, useState } from 'react';

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
  const [open, setOpen] = useState(false);
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
