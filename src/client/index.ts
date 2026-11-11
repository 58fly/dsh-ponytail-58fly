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
import type { StatsView } from '../stats/types.js';
import {
  PonytailPanel,
  type ConfigOpenResult,
  type PanelSnapshot,
  type StatsPanelPort,
  type StatsStatus,
  type WriteOutcome,
} from './panel.js';

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
 * 统计端点。与 `src/plugin.ts` 的 `STATS_PATH` 是同一个契约的两半，
 * 所以两边各写一份字面量：放进共享常量会让人以为它可以单方面改。
 *
 * 为什么不是 `connection.rpc.call`：宿主把自定义 RPC 通道交给了静态 fallback
 * （POST 405 / GET 404，桌面宿主实测），所以服务端挂在 `/api` 的 Fetch 精确路由上，
 * 这里就用同一个会话的 `fetch` 打过去——鉴权 cookie 本来就跟着走。
 *
 * 为什么用页面全局 `fetch` 而不是 `connection.fetch.fetch`：客户端 `connection`
 * 服务 `provide` 出来的 handle 只有 `interactions / openWebSocket / isLoopback /
 * generation / state / rpc / reconnect / registerGenerationSource / start`
 * （`@deepseek-ai/dsh-client-connection/lib/client.browser.js:1421-1496`），**没有 `fetch`**。
 * 早前按「handle 暴露 fetch.fetch」写的那版在本机实测永远抛 TypeError、
 * 面板停在错误态。同域名请求自带会话 cookie，`fetch` 就是最薄的正确契约。
 */
const STATS_PATH = '/api/ponytail-stats/snapshot';

/**
 * 面板开着时的重读间隔。
 *
 * 宿主的事件转发白名单是硬编码且每进程只允许一个源（票 04），没有合法推送，
 * 所以只能由面板自己定时拉。两秒是「够快看出数字在动、又不至于把宿主端点当心跳打」
 * 的折中；真正省事的那次读取仍然是订阅时的立即一拉。
 */
const STATS_POLL_MS = 2000;

/**
 * `sidebarRight` 服务面里我们用到的部分（宿主的 `ISidebarRight`）。
 *
 * 只写 `openResource` 与 `mounted`：前者开资源，后者回答「现在有没有会话」。
 * 其余成员（`openTab`、`closeTab`、`registerCloseHandler` …）面板不用，不声明就不会被误用。
 */
interface SidebarRightFace {
  /** 当前挂载的会话 id；没有会话时为 `undefined`。 */
  readonly mounted: { getSnapshot: () => string | undefined };
  /** 把 `dsh-resource://…` 地址开成右侧标签；没有会话时抛错。 */
  openResource: (address: string) => void;
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /**
     * 右侧边栏导航服务（宿主 `@deepseek-ai/dsh-client-ui-sidebar-right` 的 client face）。
     *
     * 本仓不装那个包的类型，所以在这里补一条最小声明——和宿主各插件用
     * `declare module '@deepseek-ai/cordis'` 合并 `Context` 的做法一致。
     * 服务缺席时这里**没有**成员可读：只有当 `ctx.inject` 把它列进依赖，
     * 回调里的 `scope` 才保证有这个成员。
     */
    sidebarRight: SidebarRightFace;
  }
}

/** 面板里「打开配置文件」指向的文件：配置文件本身。 */
const PATCH_FILE = 'cordis.patch.yml';

/**
 * 与宿主 `dsh-util-workspace-path` 的 `encodeSegment` 同义：保留冒号（Windows 盘符）。
 * @param segment - 一个路径段。
 * @returns 编码后的段。
 */
function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/%3A/gi, ':');
}

/**
 * 逐段编码 `/` 分隔的路径；宿主解析地址时会逐段解码。
 * @param path - `/` 分隔的路径。
 * @returns 编码后的路径。
 */
function encodePath(path: string): string {
  return path.split('/').map(encodeSegment).join('/');
}

/** 清零用的载荷：字符串字面量，与服务端的 `isResetRequest` 对齐。 */
const STATS_RESET = 'reset';

/** 服务端 `StatsReply` 的客户端视图。 */
interface StatsReplyShape {
  readonly snapshot: StatsView;
  readonly assumption: string;
}

/**
 * 把响应收窄成快照。
 *
 * 一层层验形状而不是 `as`：宿主换版本时这里会给出可读的错误，而不是让面板拿到
 * 一个 `undefined.managedTurns` 然后在渲染里崩。`verify` 第 6 组也禁 `as unknown as`。
 * @param response - `fetch` 的返回。
 * @returns 快照。
 */
async function readStatsReply(response: Response): Promise<StatsView> {
  if (!response.ok) throw new Error(`统计端点返回 ${String(response.status)}`);
  const body: unknown = await response.json();
  if (body === null || typeof body !== 'object' || !('snapshot' in body)) {
    throw new Error('统计通道返回的形状不认识');
  }
  const snapshot = (body as StatsReplyShape).snapshot;
  if (snapshot === null || typeof snapshot !== 'object' || typeof snapshot.managedTurns !== 'number') {
    throw new Error('统计通道返回的快照不完整');
  }
  return snapshot;
}

/** 统计端点的传输：页面全局 `fetch` 的形状（测试里换成桩）。 */
type StatsTransport = (request: Request) => Promise<Response>;

/**
 * 打一次统计端点；`payload` 原样 JSON 化，`'reset'` 表示清零。
 * @param transport - 页面的 `fetch`。
 * @param payload - `null` 读取，`'reset'` 清零。
 */
async function requestStats(transport: StatsTransport, payload: unknown): Promise<Response> {
  // `Request` 不接受相对 URL（浏览器要求绝对、Node 干脆抛），所以按当前页面 origin 补全；
  // 测试环境没有 `location`，退回一个占位 origin —— 桩只看 pathname。
  const here = (globalThis as { location?: { origin?: string } }).location;
  const base = here?.origin ?? 'http://localhost';
  return transport(
    new Request(new URL(STATS_PATH, base), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  );
}

/**
 * 客户端入口。
 * @param ctx - 客户端插件上下文（由宿主在装载 `lib/client.js` 时给）。
 */
export function apply(ctx: Context): void {
  // `sidebarRight` 与 `uiSession` 只为票 06 的「打开配置文件」服务：它们缺席时
  // 诊断卡的按钮整个不挂，其余面板照常——所以绝不能写进顶层 `inject`。
  const fiber = ctx.inject(['configForms', 'sidebarRight'], (scope) => {
    // 本仓不装 `dsh-client-ui-sidebar-right` 的类型包（它不是构建设置页的必要依赖），
    // 所以这里按它 client face 的公共成员最小声明一次，而不是把整个包拉进 devDependencies。
    const sidebarRight: SidebarRightFace = scope.sidebarRight;
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

    // 票 06：把配置文件开成右侧文档预览。地址按宿主的
    // `dsh-util-workspace-path` 语法拼（`encodeSegment` 保留冒号给 Windows 盘符），
    // 路径按会话工作目录相对写——绝对路径客户端算不出来。
    //
    // 会话 id 从 `sidebarRight.mounted` 取：`openResource` 内部用的就是同一个快照，
    // 这里先取是为了在没会话时**不抛异常**，而是给出「没有会话」这个结果。
    const openConfigFile = (): ConfigOpenResult => {
      const sessionId = sidebarRight.mounted.getSnapshot();
      if (sessionId === undefined) return 'no-session';
      const address =
        'dsh-resource://file/session/' + encodeSegment(sessionId) + '/' + encodePath(PATCH_FILE);
      try {
        sidebarRight.openResource(address);
        return 'opened';
      } catch (error: unknown) {
        ctx.logger(LOGGER_SCOPE).warn('打开配置文件失败：' + describeError(error));
        return 'missing';
      }
    };

    // 统计通道：挂载时拉一次，之后面板每 STATS_POLL_MS 自己再拉一次（见下面的
    // subscribe）。宿主的事件转发白名单是硬编码且每进程只允许一个源（票 04），
    // 没有合法的推送，所以轮询是唯一不撒谎的「自动更新」。
    const pageFetch = (globalThis as { fetch?: StatsTransport }).fetch;
    let statsSnapshot: StatsView | null = null;
    let statsStatus: StatsStatus = 'loading';
    let notify = (): void => {};
    /* 快照的版本号：只有它变了，`statsStore.getSnapshot()` 才换引用。 */
    let statsRevision = 0;

    /**
     * 「有变化了」的唯一入口：先记一笔版本，再叫醒订阅者。
     *
     * 不在这里直接换快照对象，是因为 `statsPort` 要到下面才定义；缓存在
     * `statsStore.getSnapshot` 里惰性拼出来，两处的顺序就不互相牵连了。
     */
    const publish = (): void => {
      statsRevision += 1;
      notify();
    };

    const pull = (): void => {
      statsStatus = statsSnapshot === null ? 'loading' : statsStatus;
      publish();
      const call = pageFetch === undefined ? null : pageFetch;
      if (call === null) {
        statsStatus = 'error';
        publish();
        return;
      }
      void requestStats(call, null)
        .then(readStatsReply)
        .then((snapshot) => {
          statsSnapshot = snapshot;
          statsStatus = 'ready';
        })
        .catch((error: unknown) => {
          statsStatus = 'error';
          ctx.logger(LOGGER_SCOPE).warn('效率统计读取失败：' + describeError(error));
        })
        .finally(publish);
    };

    const statsPort: StatsPanelPort = {
      get snapshot() {
        return statsSnapshot;
      },
      get status() {
        return statsStatus;
      },
      refresh: () => {
        pull();
      },
      reset: async (): Promise<WriteOutcome> => {
        if (pageFetch === undefined) {
          return { ok: false, message: '宿主没有提供统计通道，清零做不到。' };
        }
        try {
          statsSnapshot = await readStatsReply(await requestStats(pageFetch, STATS_RESET));
          statsStatus = 'ready';
          publish();
          return { ok: true, message: '已清零，从 0 重新计数。' };
        } catch (error) {
          return { ok: false, message: '清零失败：' + describeError(error) };
        }
      },
    };

    // 面板要重渲染才能看见新数字：这里把读接口包成一个「订阅-快照」对，
    // 借用 renderer 已有的 `useSnapshot` 机制（同一套 standardHook 约定）。
    //
    // `getSnapshot()` 的返回引用必须稳定：`useSyncExternalStoreWithSelector` 默认拿
    // `Object.is` 比前后两次返回值，每帧新建一个对象等于宣告「快照一直在变」，
    // React 会一直重渲染（还会报 getSnapshot should be cached）。所以只有
    // `statsRevision` 真的变了才换一个新对象。
    let publishedRevision = -1;
    let publishedView: { readonly port: StatsPanelPort; readonly revision: number } | null = null;

    const statsStore = {
      getSnapshot: () => {
        if (publishedView === null || publishedRevision !== statsRevision) {
          publishedView = { port: statsPort, revision: statsRevision };
          publishedRevision = statsRevision;
        }
        return publishedView;
      },
      subscribe: (listener: () => void) => {
        notify = listener;
        // 面板开着才值得反复拉：数字只在有人看的时候才有意义，没人订阅时
        // 每两秒打一次宿主端点纯属浪费。退订即停，挂载-卸载不会漏定时器。
        const timer = setInterval(pull, STATS_POLL_MS);
        return () => {
          clearInterval(timer);
          notify = () => {};
        };
      },
    };

    scope.effect(() => {
      pull();
      return () => {
        notify = () => {};
      };
    }, 'ponytail-58fly: 效率统计首次读取');

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
                hooks: { snapshot: form, statsStore },
                writeMode,
                resetMode,
                stats: statsPort,
                openConfigFile,
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
