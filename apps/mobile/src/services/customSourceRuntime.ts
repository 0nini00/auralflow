import type { MusicInfo } from "@lx/core";
import CryptoJS from "crypto-js";
import {
  assertPublicOutboundUrl,
  compareCustomSourceVersions,
  isLikelyCustomSourceRemoteUrl,
  normalizeCustomSourceRemoteUrl,
  normalizeCustomSourceScript,
  normalizeCustomSourceVersion,
} from "@lx/core";
import type { CustomSourceItem, CustomSourceSourceInfo } from "@/stores/customSourceStore";
import {
  sendToWebView,
  setLxBridgeHandlers,
  waitForBridge,
} from "@/services/customSourceWebViewBridge";
import { disposeRuntimePendingRequests } from "@/services/customSourceRuntimeLifecycleModel";
import { fetchWithTimeout } from "@/utils/fetchWithTimeout";

/** 远端音源脚本拉取超时：脚本通常几十 KB，弱网 15s 足够；不再无限挂起更新检查。 */
const REMOTE_SCRIPT_FETCH_TIMEOUT_MS = 15_000;

// 桥消息处理：WebView→RN 的 inited/updateAlert/error/http/request-response 分发。
// 各 runtime 实例用 rid（runtime id）路由，见 createRuntime 内 bridgeRoutes。
interface BridgeRoute {
  inited?: (sources: unknown, updateAlert: unknown) => void;
  updateAlert?: (alert: unknown) => void;
  error?: (message: string) => void;
  http?: (id: string, url: string, options: Record<string, unknown>) => void;
  requestResponse?: (ok: boolean, value: unknown) => void;
}
const bridgeRoutes = new Map<string, BridgeRoute>();
// request-response 消息按全局消息 id 路由（跨 runtime 唯一）：rid → pendingById
const ensureRequestIdRoutes = new Map<string, Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>>();
let bridgeHandlersInstalled = false;
let runtimeSeq = 0;

function ensureBridgeHandlers(): void {
  if (bridgeHandlersInstalled) return;
  bridgeHandlersInstalled = true;
  setLxBridgeHandlers({
    onMessage(msg) {
      if (msg.rid) {
        const route = bridgeRoutes.get(msg.rid);
        if (route) {
          if (msg.type === "inited") route.inited?.(msg.sources, msg.updateAlert);
          else if (msg.type === "updateAlert") route.updateAlert?.(msg.alert);
          else if (msg.type === "error") route.error?.(msg.message ?? "未知错误");
          else if (msg.type === "http") {
            if (msg.id && msg.url) route.http?.(msg.id, msg.url, msg.options ?? {});
          } else if (msg.type === "request-response") {
            // 按消息 id 跨 runtime 路由（req-{rid}-{seq}）
            const ownerRid = msg.rid ?? "";
            const table = ensureRequestIdRoutes.get(ownerRid);
            const pending = msg.id ? table?.get(msg.id) : undefined;
            if (pending) {
              table!.delete(msg.id!);
              if (msg.error == null) pending.resolve(msg.result);
              else pending.reject(new Error(msg.error));
            }
          }
          return;
        }
      }
      if (msg.type === "http") {
        // 无 rid 的 http（脚本直接调 lx.request 且 runtime 尚未注册）：忽略
      }
    },
    onError(message) {
      // 桥级错误广播给所有在册 runtime，让挂起的 init 尽快失败
      for (const route of bridgeRoutes.values()) route.error?.(message);
    },
  });
}

/** RN 侧 http 代理：供 WebView 里脚本发起的 lx.request 走 RN fetch（出站校验+超时） */
function bridgeProxyFetch(
  id: string,
  url: string,
  options: Record<string, unknown>,
  rid: string,
): void {
  const finish = (response: unknown, body: unknown, error?: string) => {
    sendToWebView({ type: "http-response", id, response, body, error, rid });
  };
  void (async () => {
    const controller = new AbortController();
    const timeoutMs =
      typeof options.timeout === "number" && options.timeout > 0
        ? Math.min(options.timeout, 60_000)
        : 60_000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // 出站校验规则见 @lx/core/outbound-host，与桌面端 Rust 侧同源。
      assertPublicOutboundUrl(url, "自定义音源请求");
      const headers: Record<string, string> = { ...(options.headers as Record<string, string>) };
      let body: BodyInit_ | undefined;
      const rawBody = options.body;
      if (rawBody != null) {
        body = typeof rawBody === "string" ? rawBody : JSON.stringify(rawBody);
      } else if (options.form) {
        body = new URLSearchParams(options.form as Record<string, string>).toString();
        if (!headers["Content-Type"] && !headers["content-type"]) {
          headers["Content-Type"] = "application/x-www-form-urlencoded";
        }
      } else if (options.formData != null) {
        // formData 二进制不过 JSON 桥：WebView 侧已转为 base64，这里解码为二进制
        const b64 = (options.formData as { __lxBase64?: string }).__lxBase64;
        if (typeof b64 === "string") {
          const bin = globalThis.atob(b64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          body = bytes;
        }
      }
      const response = await fetch(url, {
        method: (options.method as string) ?? "GET",
        headers,
        body,
        signal: controller.signal as unknown as RequestInit["signal"],
      });
      // 不要加 redirect: "manual"：RN 的 fetch 是 whatwg-fetch over XHR，
      // Request 构造函数根本不读这个字段，Android 侧 OkHttp 始终 followRedirects(true)。
      // 写上去不会报错，只会让人误以为已经防住了 302 到内网。
      //
      // 这里改为校验最终落地 URL。边界（显式声明）：内网请求此时已经发出，
      // 本校验只阻断响应数据回流到脚本，不能阻止盲打点与端口探测。
      // 彻底修复需要原生侧 followRedirects(false) 并逐跳校验，对齐桌面端
      // desktop/src-tauri/src/outbound.rs 的 guarded_redirect_policy。
      const finalUrl = response.url;
      if (finalUrl && finalUrl !== url) {
        assertPublicOutboundUrl(finalUrl, "自定义音源重定向目标");
      }
      const text = await response.text();
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
      finish(
        createRequestResponse(parsed, response.status, response.statusText, headersToRecord(response.headers)),
        parsed,
      );
    } catch (error) {
      finish(null, null, error instanceof Error ? error.message : String(error));
    } finally {
      clearTimeout(timer);
    }
  })();
}

/**
 * React Native 版自定义音源运行时。
 *
 * 与桌面端 src/services/customSourceRuntime.ts 行为对齐，差异点：
 * - 网络请求：桌面端用 @tauri-apps/plugin-http 的 tauriFetch，RN 用全局 fetch。
 * - 定时器：桌面端用 window.setTimeout/clearTimeout，RN 用全局 setTimeout/clearTimeout。
 * - zlib：桌面端用 CompressionStream + Tauri 原生 zlib，RN 用 pako（见 utils/compression.ts）。
 * - crypto / RSA：crypto-js 与 node-forge 两端共用，已在 mobile package.json 中声明依赖。
 * - RN 没有 window / globalThis 上的部分 API，脚本执行时注入一个最小化的 window / globalThis 兼容对象。
 *
 * 注意：`new Function(...)` 在 Hermes debug 模式可用，生产 release 构建若禁用动态 eval
 * 将无法执行用户脚本（这是 RN 平台限制，非本运行时问题）。
 */

export interface DesktopUserApiHeaderInfo {
  name: string;
  description: string;
  author: string;
  homepage: string;
  version: string;
}

export interface CustomSourceUpdateAlert {
  log: string;
  updateUrl?: string;
}

export interface RuntimeInitResult {
  sources?: Record<string, CustomSourceSourceInfo>;
  updateAlert?: CustomSourceUpdateAlert;
}

interface RuntimeRequestResult {
  source: string;
  action: string;
  data: {
    type?: string;
    url?: string;
  } | string;
}

interface RuntimeInstance {
  init: Promise<RuntimeInitResult>;
  request: (data: RuntimeRequestPayload) => Promise<RuntimeRequestResult>;
  getUpdateAlert: () => CustomSourceUpdateAlert | undefined;
  waitForUpdateAlert: (timeoutMs: number) => Promise<CustomSourceUpdateAlert | undefined>;
  setUpdateAlertHandler: (handler: ((alert: CustomSourceUpdateAlert) => void) | null) => void;
  dispose: () => void;
}

interface RuntimeRequestPayload {
  source: string;
  action: "musicUrl" | "lyric" | "pic";
  info: Record<string, unknown>;
}

const INFO_LIMITS: Record<keyof DesktopUserApiHeaderInfo, number> = {
  name: 24,
  description: 36,
  author: 56,
  homepage: 1024,
  version: 36,
};

function normalizeHeaderValue(key: keyof DesktopUserApiHeaderInfo, value: string): string {
  const trimmed = value.trim();
  if (key === "version") {
    const version = trimmed.match(/v?\d+(?:\.\d+){1,3}(?:[-+][\w.-]+)?/)?.[0];
    if (version) return version;
  }
  const limit = INFO_LIMITS[key];
  return trimmed.length > limit ? `${trimmed.slice(0, limit)}...` : trimmed;
}

const EVENT_NAMES = {
  request: "request",
  inited: "inited",
  updateAlert: "updateAlert",
} as const;

const INIT_TIMEOUT_MS = 30_000;
const TEST_UPDATE_ALERT_WAIT_MS = 800;
const CHECK_UPDATE_ALERT_WAIT_MS = 5_000;

const ALL_SOURCES = ["kg", "tx", "wy", "local"];
const SUPPORT_QUALITIES: Record<string, string[]> = {
  kg: ["128k", "320k", "flac", "flac24bit"],
  tx: ["128k", "320k", "flac", "flac24bit"],
  wy: ["128k", "320k", "flac", "flac24bit"],
  local: [],
};
const SUPPORT_ACTIONS: Record<string, string[]> = {
  kg: ["musicUrl"],
  tx: ["musicUrl"],
  wy: ["musicUrl"],
  local: ["musicUrl", "lyric", "pic"],
};

export function parseDesktopUserApiInfo(script: string): DesktopUserApiHeaderInfo {
  const block = /^\/\*[\s\S]+?\*\//.exec(script)?.[0];
  if (!block) throw new Error("无效的自定义源文件：缺少 LX Music 头部注释");

  const result: DesktopUserApiHeaderInfo = {
    name: "",
    description: "",
    author: "",
    homepage: "",
    version: "",
  };
  const rxp = /^\s?\*\s?@(\w+)\s(.+)$/;
  for (const line of block.split(/\r?\n/)) {
    const match = rxp.exec(line);
    if (!match) continue;
    const key = match[1] as keyof DesktopUserApiHeaderInfo;
    if (!(key in INFO_LIMITS)) continue;
    result[key] = normalizeHeaderValue(key, match[2]);
  }
  result.name ||= `user_api_${new Date().toLocaleString()}`;
  return result;
}

function normalizeInitSources(info: unknown): Record<string, CustomSourceSourceInfo> {
  const input = info as { sources?: Record<string, CustomSourceSourceInfo> } | null;
  const sources: Record<string, CustomSourceSourceInfo> = {};
  for (const source of ALL_SOURCES) {
    const userSource = input?.sources?.[source];
    if (!userSource || userSource.type !== "music") continue;
    sources[source] = {
      type: "music",
      actions: SUPPORT_ACTIONS[source].filter((action) => userSource.actions?.includes(action)),
      qualitys: SUPPORT_QUALITIES[source].filter((quality) => userSource.qualitys?.includes(quality)),
    };
  }
  return sources;
}

function normalizeUpdateAlert(data: unknown): CustomSourceUpdateAlert | undefined {
  if (!data || typeof data !== "object") return undefined;
  const input = data as { log?: unknown; updateUrl?: unknown };
  if (typeof input.log !== "string" || !input.log.trim()) return undefined;

  const updateUrl =
    typeof input.updateUrl === "string" &&
    /^https?:\/\//.test(input.updateUrl) &&
    input.updateUrl.length <= 1024
      ? input.updateUrl
      : undefined;

  return {
    log: input.log.length > 1024 ? `${input.log.slice(0, 1024)}...` : input.log,
    updateUrl,
  };
}

function getRemoteScriptUrl(api: CustomSourceItem): string | null {
  const candidate = api.homepage?.trim();
  if (!candidate || !/^https?:\/\//.test(candidate)) return null;
  try {
    const normalized = normalizeCustomSourceRemoteUrl(candidate);
    return isLikelyCustomSourceRemoteUrl(normalized) ? normalized : null;
  } catch {
    return null;
  }
}

async function fetchRemoteScript(url: string): Promise<string> {
  // 更新检查同样走出站校验：homepage 来自音源脚本本体，WebView 内请求都过
  // assertPublicOutboundUrl，这条裸 fetch 不能成为打内网的后门；
  // isLikelyCustomSourceRemoteUrl 只识别「像脚本链接」，不含内网判定。
  assertPublicOutboundUrl(url, "自定义音源更新检查");
  const response = await fetchWithTimeout(
    url,
    {
      method: "GET",
      headers: {
        Accept: "text/plain,application/javascript,*/*",
      },
    },
    REMOTE_SCRIPT_FETCH_TIMEOUT_MS,
  );
  if (!response.ok) {
    throw new Error(`远端音源请求失败：HTTP ${response.status} ${response.statusText}`);
  }
  const text = await response.text();
  if (!text.trim()) throw new Error("远端音源脚本为空");
  return text;
}

export async function checkCustomSourceRemoteUpdate(
  api: CustomSourceItem,
): Promise<CustomSourceUpdateAlert | undefined> {
  const updateUrl = getRemoteScriptUrl(api);
  if (!updateUrl) return undefined;

  const remoteScript = await fetchRemoteScript(updateUrl);
  const localInfo = parseDesktopUserApiInfo(api.script);
  const remoteInfo = parseDesktopUserApiInfo(remoteScript);
  const localVersion = normalizeCustomSourceVersion(api.version || localInfo.version);
  const remoteVersion = normalizeCustomSourceVersion(remoteInfo.version);
  const hasScriptChanged = normalizeCustomSourceScript(remoteScript) !== normalizeCustomSourceScript(api.script);

  if (remoteVersion && localVersion) {
    if (compareCustomSourceVersions(remoteVersion, localVersion) <= 0) return undefined;
    return {
      log: `发现新版本：v${localVersion} -> v${remoteVersion}`,
      updateUrl,
    };
  }
  if (!remoteVersion && !hasScriptChanged) return undefined;
  if (hasScriptChanged) {
    return {
      log: remoteVersion
        ? `远端脚本内容已更新，当前版本 v${localVersion || "未知"}，远端版本 v${remoteVersion}`
        : "远端脚本内容已更新",
      updateUrl,
    };
  }
  return undefined;
}

/**
 * 转换为 lx-music 协议的 musicInfo。
 *
 * tx 取链依赖 strMediaMid（脚本用它拼 M500{mid}.mp3 / F000{mid}.flac），
 * albumId 在 lx 的 tx musicInfo 里存的也是专辑 mid 而非数字 id；
 * songmid 与 songId 对 tx 是两个不同的值，不能都填 music.id。
 */
function toOldMusicInfo(music: MusicInfo): Record<string, unknown> {
  const tx = music.txMeta;
  return {
    name: music.name,
    singer: music.singer,
    source: music.source,
    songmid: music.id,
    songId: tx?.songId || music.id,
    interval: music.interval,
    albumName: music.albumName,
    albumId: tx?.albumMid ?? "",
    albumMid: tx?.albumMid ?? "",
    strMediaMid: tx?.strMediaMid ?? "",
    img: music.picUrl ?? music.img ?? "",
    types: [],
    _types: {},
    typeUrl: {},
  };
}

interface SimpleResponse {
  statusCode: number;
  statusMessage: string;
  headers: Record<string, string>;
  bytes: number;
  raw: string;
  body: unknown;
}

function createRequestResponse(
  rawBody: unknown,
  status: number,
  statusText: string,
  headers: Record<string, string>,
): SimpleResponse {
  return {
    statusCode: status,
    statusMessage: statusText,
    headers,
    bytes: 0,
    raw: typeof rawBody === "string" ? rawBody : JSON.stringify(rawBody),
    body: rawBody,
  };
}

function headersToRecord(headers: Headers): Record<string, string> {
  const headerObject: Record<string, string> = {};
  try {
    headers.forEach((value: string, key: string) => {
      headerObject[key] = value;
    });
  } catch {
    // RN 部分实现 headers.forEach 不可用，退化为空对象
  }
  return headerObject;
}

function createRuntime(api: CustomSourceItem): RuntimeInstance {
  let requestHandler: ((payload: RuntimeRequestPayload) => Promise<unknown>) | null = null;
  let finishInit: (value: RuntimeInitResult) => void = () => undefined;
  let failInit: (error: Error) => void = () => undefined;
  let initSettled = false;
  let disposed = false;
  let initTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let updateAlert: CustomSourceUpdateAlert | undefined;
  const updateAlertWaiters = new Set<(alert: CustomSourceUpdateAlert | undefined) => void>();
  // 正常播放/下载取链时脚本主动 send(updateAlert) 的透传回调；
  // 仅在没有任何 waiter 等待时触发，避免与测试/更新检查流程的等待重复上报
  let updateAlertHandler: ((alert: CustomSourceUpdateAlert) => void) | null = null;
  const init = new Promise<RuntimeInitResult>((resolve, reject) => {
    finishInit = resolve;
    failInit = reject;
  });

  // —— WebView 桥路由（Hermes 不支持 new Function，脚本在隐藏 WebView 内执行） ——
  const rid = `rt-${++runtimeSeq}`;
  let requestSeq = 0;

  ensureBridgeHandlers();
  bridgeRoutes.set(rid, {
    inited(sources, alert) {
      if (disposed || initSettled) return;
      initSettled = true;
      if (initTimeoutId) clearTimeout(initTimeoutId);
      if (alert) updateAlert = normalizeUpdateAlert(alert) ?? updateAlert;
      try {
        finishInit({ sources: normalizeInitSources(sources), updateAlert });
      } catch (error) {
        failInit(error instanceof Error ? error : new Error(String(error)));
      }
    },
    updateAlert(alert) {
      if (disposed) return;
      updateAlert = normalizeUpdateAlert(alert) ?? updateAlert;
      if (updateAlert) {
        if (updateAlertWaiters.size > 0) {
          for (const waiter of updateAlertWaiters) waiter(updateAlert);
          updateAlertWaiters.clear();
        } else {
          updateAlertHandler?.(updateAlert);
        }
      }
    },
    error(message) {
      if (!disposed && !initSettled) {
        initSettled = true;
        if (initTimeoutId) clearTimeout(initTimeoutId);
        failInit(new Error(message));
      }
    },
    http(id, url, options) {
      if (disposed) return;
      // 脚本发起的 lx.request → RN 侧 fetch 代理（出站校验+超时），结果回传 WebView
      bridgeProxyFetch(id, url, options, rid);
    },
    requestResponse(ok, value) {
      // 占位：request-response 按消息 id 路由（见 inflightById），不按 rid
      void ok; void value;
    },
  });

  // request-response 统一按 id 路由（createRuntime 之外的模块级表）
  const pendingById = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  // lx 环境在 WebView 桥内构造（见 lx_bridge/index.html）；RN 侧仅保留
  // 请求路由/初始化状态机/缓存。runHttpRequest/createUtils 等已随桥迁移。
  ensureRequestIdRoutes.set(rid, pendingById);

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (initTimeoutId) {
      clearTimeout(initTimeoutId);
      initTimeoutId = null;
    }
    const error = new Error("自定义音源运行时已释放");
    if (!initSettled) {
      initSettled = true;
      failInit(error);
    }
    for (const waiter of updateAlertWaiters) waiter(undefined);
    updateAlertWaiters.clear();
    updateAlertHandler = null;
    requestHandler = null;
    bridgeRoutes.delete(rid);
    disposeRuntimePendingRequests(ensureRequestIdRoutes, rid, error);
    sendToWebView({ type: "dispose", rid });
  };

  // 取链请求：发 WebView 内脚本的 lx.on(request) handler，按消息 id 配对应答
  requestHandler = (payload) =>
    new Promise<unknown>((resolve, reject) => {
      if (disposed) {
        reject(new Error("自定义音源运行时已释放"));
        return;
      }
      const id = `req-${rid}-${++requestSeq}`;
      pendingById.set(id, { resolve, reject });
      setTimeout(() => {
        const pending = pendingById.get(id);
        if (pending) {
          pendingById.delete(id);
          pending.reject(new Error("自定义音源取链超时"));
        }
      }, 30_000);
      sendToWebView({ type: "request", rid, id, payload });
    });

  // WebView 内执行（Hermes 不支持 new Function）：把脚本发送给桥，
  // 桥内以与桌面同构的参数遮蔽沙箱执行，init 结果经 inited/error 消息回传。
  try {
    // 静态扫描（与桌面一致）：拒绝明显的动态代码执行手法，双层防御
    if (
      /constructor\s*\.\s*constructor|\.constructor\s*\(|\beval\s*\(|\bFunction\s*\(/.test(
        api.script
      )
    ) {
      throw new Error("自定义音源脚本包含不允许的动态代码执行");
    }
    void waitForBridge().then(
      () => {
        if (disposed) return;
        sendToWebView({
          type: "run",
          rid,
          script: api.script,
          scriptInfo: {
            name: api.name,
            description: api.description,
            version: api.version,
            author: api.author,
            homepage: api.homepage,
          },
        });
      },
      (error) => {
        // 桥不可用（加载失败/超时）：立即让 init 失败，不再等 30s 总超时
        if (!disposed && !initSettled) {
          initSettled = true;
          if (initTimeoutId) clearTimeout(initTimeoutId);
          failInit(
            error instanceof Error
              ? error
              : new Error("自定义音源 WebView 桥不可用"),
          );
        }
      },
    );
  } catch (error) {
    initSettled = true;
    failInit(error instanceof Error ? error : new Error(String(error)));
  }

  initTimeoutId = setTimeout(() => {
    if (!disposed && !initSettled) {
      initSettled = true;
      failInit(
        new Error("自定义音源初始化超时，脚本没有调用 lx.send(lx.EVENT_NAMES.inited, ...)"),
      );
    }
  }, INIT_TIMEOUT_MS);

  return {
    init,
    getUpdateAlert() {
      return updateAlert;
    },
    waitForUpdateAlert(timeoutMs) {
      if (disposed) return Promise.resolve(undefined);
      if (updateAlert) return Promise.resolve(updateAlert);
      return new Promise((resolve) => {
        let settled = false;
        const finish = (alert: CustomSourceUpdateAlert | undefined) => {
          if (settled) return;
          settled = true;
          updateAlertWaiters.delete(finish);
          clearTimeout(timer);
          resolve(alert);
        };
        const timer = setTimeout(() => finish(undefined), Math.max(0, timeoutMs));
        updateAlertWaiters.add(finish);
      });
    },
    setUpdateAlertHandler(handler) {
      if (!disposed) updateAlertHandler = handler;
    },
    async request(data) {
      if (disposed) throw new Error("自定义音源运行时已释放");
      await init;
      if (!requestHandler) throw new Error("Request event is not defined");
      const response = await requestHandler({
        source: data.source,
        action: data.action,
        info: data.info,
      });
      if (data.action === "musicUrl") {
        if (typeof response !== "string" || response.length > 2048 || !/^https?:/.test(response)) {
          throw new Error("自定义音源没有返回可播放 URL");
        }
        // 在脚本返回值入口收口：这个 URL 下游会流向 probeStreamUrl、
        // RNFS.downloadFile 与 TrackPlayer，三处都不做出站校验。
        assertPublicOutboundUrl(response, "自定义音源播放地址");
        return {
          source: data.source,
          action: data.action,
          data: {
            type: data.info.type as string,
            url: response,
          },
        };
      }
      return { source: data.source, action: data.action, data: response as string };
    },
    dispose,
  };
}

// ─── Runtime 缓存 ────────────────────────────────────────────
// 按 api.id + api.script 的 hash 缓存已初始化的 RuntimeInstance，避免每次播放
// 都重新执行脚本（createRuntime 内含 new Function + 网络初始化，耗时且有超时风险）。

const runtimeCache = new Map<string, RuntimeInstance>();

function getCacheKey(api: CustomSourceItem): string {
  const scriptHash = CryptoJS.SHA256(normalizeCustomSourceScript(api.script)).toString();
  return `${api.id}::${scriptHash}`;
}

function getCachedRuntime(api: CustomSourceItem): RuntimeInstance {
  const key = getCacheKey(api);
  const cached = runtimeCache.get(key);
  if (cached) return cached;
  const runtime = createRuntime(api);
  runtimeCache.set(key, runtime);
  // 初始化失败时从缓存中移除并释放，下次重试。
  runtime.init.catch(() => {
    if (runtimeCache.get(key) === runtime) runtimeCache.delete(key);
    runtime.dispose();
  });
  return runtime;
}

/** 清除某个音源的 Runtime 缓存（重新导入脚本时调用） */
export function invalidateRuntimeCache(apiId: string): void {
  for (const [key, runtime] of runtimeCache.entries()) {
    if (!key.startsWith(`${apiId}::`)) continue;
    runtimeCache.delete(key);
    runtime.dispose();
  }
}

/** 把已初始化的 Runtime 放回缓存（深度测试复用，避免重复执行脚本） */
function primeRuntimeCache(api: CustomSourceItem, runtime: RuntimeInstance): void {
  const key = getCacheKey(api);
  const previous = runtimeCache.get(key);
  if (previous && previous !== runtime) previous.dispose();
  runtimeCache.set(key, runtime);
}

export async function testCustomSource(
  api: CustomSourceItem,
  updateAlertWaitMs = TEST_UPDATE_ALERT_WAIT_MS,
): Promise<RuntimeInitResult> {
  // 测试时强制重建，不走缓存
  invalidateRuntimeCache(api.id);
  const runtime = createRuntime(api);
  try {
    const result = await runtime.init;
    const updateAlert = result.updateAlert ?? (await runtime.waitForUpdateAlert(updateAlertWaitMs));
    return { ...result, updateAlert };
  } finally {
    runtime.dispose();
  }
}

// ─── 深度测试：真实取链 ────────────────────────────────────────
// 初始化通过不代表脚本真的能取到播放地址（假阳性），这里用内置固定测试曲走一次真实
// musicUrl 请求验证端到端可用性。超时 20s，与现有播放解析预期对齐。

const DEEP_TEST_TIMEOUT_MS = 20_000;
const DEEP_TEST_QUALITY = "128k";

/** 内置固定测试曲（id 均为公开常驻曲目，可按需替换）：
 *  - wy：2034742057 林俊杰-江南（备选 1492167768）
 *  - tx：songmid 0039MnYb0qxYhV
 */
const DEEP_TEST_TRACKS: Record<"wy" | "tx", { id: string; name: string; singer: string; albumName: string }> = {
  wy: { id: "2034742057", name: "江南", singer: "林俊杰", albumName: "第二天堂" },
  tx: { id: "0039MnYb0qxYhV", name: "江南", singer: "林俊杰", albumName: "第二天堂" },
};

/** 取链测试结果，结构兼容现有 testCustomSource 返回，ok 表示两阶段全部通过 */
export interface DeepTestResult {
  ok: boolean;
  message: string;
  sources?: Record<string, CustomSourceSourceInfo>;
  updateAlert?: CustomSourceUpdateAlert;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function testCustomSourceDeep(
  api: CustomSourceItem,
  updateAlertWaitMs = TEST_UPDATE_ALERT_WAIT_MS,
): Promise<DeepTestResult> {
  // 阶段一：复用现有 init 流程
  invalidateRuntimeCache(api.id);
  const runtime = createRuntime(api);
  let initResult: RuntimeInitResult;
  try {
    initResult = await runtime.init;
    initResult = { ...initResult, updateAlert: initResult.updateAlert ?? (await runtime.waitForUpdateAlert(updateAlertWaitMs)) };
  } catch (error) {
    runtime.dispose();
    return {
      ok: false,
      message: `初始化失败：${error instanceof Error ? error.message : String(error)}`,
      sources: undefined,
      updateAlert: undefined,
    };
  }

  primeRuntimeCache(api, runtime);

  // 阶段二：选平台与测试曲（声明 musicUrl 能力的平台中优先 wy），走真实取链
  const sources = initResult.sources ?? {};
  const pickSource = (["wy", "tx"] as const).find((name) => sources[name]?.actions.includes("musicUrl"));
  if (!pickSource) {
    return { ok: true, message: "初始化正常；未声明 musicUrl，仅验证初始化", sources, updateAlert: initResult.updateAlert };
  }

  const track = DEEP_TEST_TRACKS[pickSource];
  const music: MusicInfo = {
    id: track.id,
    name: track.name,
    singer: track.singer,
    albumName: track.albumName,
    source: pickSource,
  };

  // quality 兼容：128k 不在脚本声明白名单时退回声明的最低音质
  const declared = sources[pickSource]?.qualitys ?? [];
  const quality = declared.includes(DEEP_TEST_QUALITY) ? DEEP_TEST_QUALITY : declared[0] ?? DEEP_TEST_QUALITY;

  // 深度测试重建的 Runtime 已放回缓存，取链走现有 requestCustomSourceMusicUrl。
  try {
    const result = await withTimeout(
      requestCustomSourceMusicUrl(api, music, quality),
      DEEP_TEST_TIMEOUT_MS,
      `取链测试超时（超过 ${DEEP_TEST_TIMEOUT_MS / 1000}s 未返回播放地址）`,
    );
    if (!/^https?:\/\//.test(result.url)) {
      throw new Error(`未返回可播放 URL：${result.url.slice(0, 128)}`);
    }
    return {
      ok: true,
      message: `初始化正常；取链测试通过（${pickSource} ${result.quality || quality}）`,
      sources: result.sources ?? sources,
      updateAlert: initResult.updateAlert,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `初始化正常；取链测试失败：${reason}`, sources, updateAlert: initResult.updateAlert };
  }
}

export async function checkCustomSourceUpdate(api: CustomSourceItem): Promise<RuntimeInitResult> {
  const result = await testCustomSource(api, CHECK_UPDATE_ALERT_WAIT_MS);
  if (result.updateAlert) return result;
  const remoteAlert = await checkCustomSourceRemoteUpdate(api);
  return { ...result, updateAlert: remoteAlert };
}

export async function requestCustomSourceMusicUrl(
  api: CustomSourceItem,
  music: MusicInfo,
  quality: string,
  onUpdateAlert?: (alert: CustomSourceUpdateAlert) => void,
): Promise<{ url: string; quality: string; sources?: Record<string, CustomSourceSourceInfo> }> {
  const runtime = getCachedRuntime(api);
  // 注入回调后，取链期间脚本 send(updateAlert) 且无 waiter 等待时会透传给消费方；
  // 传 null 可清掉历史回调。runtime 不感知 store，由消费方决定如何消费
  runtime.setUpdateAlertHandler(onUpdateAlert ?? null);
  const initResult = await runtime.init;
  const sourceInfo = initResult.sources?.[music.source];
  if (!sourceInfo?.actions.includes("musicUrl")) {
    throw new Error(`音源不支持 ${music.source} 的播放链接解析`);
  }
  if (sourceInfo.qualitys.length && !sourceInfo.qualitys.includes(quality)) {
    throw new Error(`音源不支持 ${quality} 音质`);
  }

  const result = await runtime.request({
    source: music.source,
    action: "musicUrl",
    info: {
      type: quality,
      musicInfo: toOldMusicInfo(music),
    },
  });
  const data = result.data as { url?: string; type?: string };
  if (!data.url) throw new Error("自定义音源没有返回可播放 URL");
  return { url: data.url, quality: data.type || quality, sources: initResult.sources };
}
