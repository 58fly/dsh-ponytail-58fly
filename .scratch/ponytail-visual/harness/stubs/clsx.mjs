/** `clsx` 的最小实现：拼接真值 class。 */
export default function clsx(input) {
  const list = Array.isArray(input) ? input : [input];
  return list.filter((item) => typeof item === 'string' && item.length > 0).join(' ');
}
