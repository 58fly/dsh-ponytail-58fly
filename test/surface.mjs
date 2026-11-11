/**
 * 卡面守卫的公共工具：把 `?` 里的正文削掉，剩下的才是「用户一眼看到的东西」。
 *
 * 票 03 把说明文本从卡面搬进了 `?`，所以「这句解释不许出现」的断言必须只看
 * 卡面；`?` 正文里那句话是要求保留的。两个 surface 测试共用这一个函数，
 * 免得一边削了、另一边忘了削。
 * @param source - 面板源码。
 * @returns 削掉全部 `<HelpBubble>…</HelpBubble>` 区间后的源码。
 */
export function withoutHelp(source) {
  const open = '<HelpBubble';
  const close = '</HelpBubble>';
  let out = '';
  let cursor = 0;
  for (;;) {
    const start = source.indexOf(open, cursor);
    if (start === -1) return out + source.slice(cursor);
    out += source.slice(cursor, start);
    const end = source.indexOf(close, start);
    if (end === -1) return out + source.slice(start);
    cursor = end + close.length;
  }
}
