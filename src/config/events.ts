/**
 * 宿主事件日志的类型增强。
 *
 * Cordis 的 `Events` 是一个空接口，各包用 `declare module` 往里加自己发的事件；
 * 不声明就只能写 `ctx.on('settings/updated' as never, …)`，而那会把「事件名拼错」
 * 这件事也一起静音——路由不到任何监听器，运行时毫无征兆。
 *
 * 这里声明的是**宿主核心包发的两条事件**，不是本包自己发的：
 *
 * - `settings/updated`：`dsh-settings` 在描述符 revision 变化时 `emit(ns)`，参数是
 *   插件条目 id。我们的目的是「有人改了我们的配置」，所以不筛选 id，统一重算——
 *   跨插件的广播过滤靠 id 比对，一旦将来宿主换了 id 形态就会漏，重算更安全。
 * - `loader/volatile-update`：`cordis-plugin-loader` 在 volatile-only 快路径里
 *   `emit(fiber, paths)`，参数是**受影响的键路径数组**（`string[][]`，如
 *   `[['defaultMode']]`），不含值。它是 volatile 字段变更的唯一信号。
 *
 * 两条都只被当作「该重读了」的提示，不解析参数——重新 `describe()` 拿到的是权威
 * 快照，比从事件参数里拼状态可靠。
 */
import type {} from '@deepseek-ai/cordis';

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** 某个插件条目的设置描述符变化。参数是插件条目 id。 */
    'settings/updated'(id: string): void;
    /** volatile 字段被原地更新。参数是受影响的键路径列表。 */
    'loader/volatile-update'(paths: string[][]): void;
  }
}

export {};
