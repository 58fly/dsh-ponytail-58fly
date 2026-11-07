/**
 * 客户端入口：把 Ponytail 面板挂到宿主的设置页（#05）。
 *
 * **为什么顶层 `inject` 只有 `slots`**：`inject` 里写了的服务只要缺席，
 * 这个客户端条目就会被宿主整条跳过（不是降级，是消失），连 `slots` 都用不上。
 * 而 `configForms`（`@deepseek-ai/dsh-client-ui-settings` 提供）与
 * `locale` 属于「有就更好、没有也要能装」的那一类，所以它们走运行时的
 * `ctx.inject([...], scope => ...)`：服务缺席时子 fiber 一直没起来，
 * 面板整块不出现，宿主侧功能零损失——这正是 #05 要求的可降级形态。
 *
 * **注册只用 `slots.inject`，不用裸 `slots.register`**：`slots.inject` 在槽位
 * 还没被声明时静默等待（`dsh-client-ui-renderer/lib/client.js:1393`
 * `if (spec === void 0) return;`），声明出现后才注册；裸 `register` 对未声明
 * 的槽位直接抛错。设置页是 `dsh-client-ui-settings-general` 声明的，
 * 它不一定在组合里。
 *
 * **为什么用 `settings.section` 而不是上游的 `plugins.bundle.config`**：后者是
 * 插件详情页的 keyed slot，用户找档位要去插件管理器翻；设置页才是
 * 「改配置」这件事在该产品里的位置。节选与理由见
 * `docs/research/dsh-plugin-contract-0.2.2.md` 的 #05 一节。
 *
 * @module
 */
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client';
import type {} from '@deepseek-ai/dsh-client-ui-settings/client';
import { PLUGIN_ID } from '../l0/paths.js';
import { coerceMode, type RuntimeMode } from '../l0/mode.js';
import { describeError } from '../l0/errors.js';
import { PonytailPanel, type PanelSnapshot, type WriteOutcome } from './panel.js';

/**
 * 硬依赖只有 `slots`：它是这个文件唯一的注册目标。
 *
 * 早期版本把 `configForms` / `locale` / `remote` 一并写进这里，结果是
 * 没装设置页的部署里整个客户端条目被跳过——包括那条「等槽位声明」的注册。
 */
export const inject = ['slots'];

/** 设置页左侧导航里的条目 id，也是 `only` 过滤用的键。 */
const SECTION_ID = 'ponytail-58fly';

/** 导航里的排序位；宿主自带的一般在 0–40，我们排在它们之后。 */
const SECTION_ORDER = 50;

/** 导航里的显示名（`label` 支持 thunk，但这里是常量，无需跟随 locale 重注册）。 */
const SECTION_LABEL = 'Ponytail';

/** `ctx.inject` 等待失败时记日志用的 scope。 */
const LOGGER_SCOPE = 'ponytail-58fly';

/**
 * 客户端入口。
 * @param ctx - 客户端插件上下文（由宿主在装载 `lib/client.js` 时给）。
 */
export function apply(ctx: Context): void {
  const fiber = ctx.inject(['configForms'], (scope) => {
    // 表单按宿主插件条目 id 取；命名空间就是它（见 dsh-settings 的 describe()）。
    const form = scope.configForms.get<PanelSnapshot>(PLUGIN_ID);

    const writeMode = async (mode: RuntimeMode): Promise<WriteOutcome> => {
      // 归一化只在 l0 一处定义：UI 传下来的值也走同一条路，不信任调用方。
      const normalized = coerceMode(mode);
      if (normalized === null) return { ok: false, message: '档位值非法：' + String(mode) };
      const accepted = await form.set('defaultMode', normalized);
      return accepted
        ? { ok: true, message: '已写入 defaultMode = ' + normalized + '，生效值见下方诊断链。' }
        : { ok: false, message: '宿主拒绝了这次写入：配置可能只读，或该字段没有开放写入。' };
    };

    const resetMode = async (): Promise<WriteOutcome> => {
      const accepted = await form.unset('defaultMode');
      return accepted
        ? { ok: true, message: '已清除用户层覆盖，档位回落到继承值。' }
        : { ok: false, message: '宿主拒绝了这次清除：配置可能只读，或这个字段本来就没有用户层覆盖。' };
    };

    scope.effect(
      () =>
        scope.slots.inject('settings.section', () =>
          scope.slots.register(
            {
              name: 'settings.section',
              id: SECTION_ID,
              order: SECTION_ORDER,
              label: SECTION_LABEL,
              inject: () => ({
                hooks: { snapshot: form },
                writeMode,
                resetMode,
              }),
            },
            PonytailPanel,
          ),
        ),
      'ponytail-58fly: 设置页面板',
    );
  });

  void Promise.resolve(fiber).catch((error: unknown) => {
    ctx.logger(LOGGER_SCOPE).warn('客户端面板接线失败：' + describeError(error));
  });
}
