import CryptoJS from "crypto-js";
import {
  CUSTOM_SOURCE_CHECK_UPDATE_ALERT_WAIT_MS,
  CUSTOM_SOURCE_INIT_TIMEOUT_MS,
  CUSTOM_SOURCE_REMOTE_SCRIPT_ACCEPT,
  CUSTOM_SOURCE_TEST_UPDATE_ALERT_WAIT_MS,
  MAX_INFLIGHT_CUSTOM_SOURCE_REQUESTS,
  createRequestLimiter,
  assertPublicOutboundUrl,
  buildCustomSourceDeepTestInitFailure,
  buildCustomSourceMusicUrlRequest,
  checkCustomSourceRemoteUpdate,
  normalizeCustomSourceInitSources,
  normalizeCustomSourceScript,
  normalizeCustomSourceUpdateAlert,
  planCustomSourceDeepTest,
  readCustomSourceMusicUrlResult,
  readCustomSourceRemoteScript,
  runCustomSourceDeepTestPlatforms,
  toCustomSourceRuntimeRequestResult,
  type CustomSourceDeepTestResult,
  type CustomSourceItem,
  type CustomSourcePlatformRequest,
  type CustomSourceRuntimeInitResult,
  type CustomSourceRuntimeRequestPayload,
  type CustomSourceRuntimeRequestResult,
  type CustomSourceSourceInfo,
  type CustomSourceUpdateAlert,
  type MusicInfo,
} from "@lx/core";
import {
  sendToWebView,
  setLxBridgeHandlers,
  waitForBridge,
} from "@/services/customSourceWebViewBridge";
import { disposeRuntimePendingRequests } from "@/services/customSourceRuntimeLifecycleModel";
import { fetchWithTimeout } from "@/utils/fetchWithTimeout";
import { hiddenSourceSearchers } from "./hiddenSourceSearchers";
import { probeStreamUrl } from "./streamProbe";
import { buildStreamHeaders } from "./streamHeaders";
import { cancellationError, createCancellationScope, throwIfAborted, waitWithSignal } from "@/utils/cancellation";

/** 远端音源脚本拉取超时：脚本通常几十 KB，弱网 15s 足够；不再无限挂起更新检查。 */
const REMOTE_SCRIPT_FETCH_TIMEOUT_MS = 15_000;

// 桥消息处理：WebView→RN 的 inited/updateAlert/error/http/request-response 分发。
// 各 runtime 实例用 rid（runtime id）路由，见 createRuntime 内 bridgeRoutes。
interface BridgeRoute {
  inited?: (sources: unknown, updateAlert: unknown) => void;
  updateAlert?: (alert: unknown) => void;
  error?: (message: string) => void;
  http?: (id: string, url: string, options: Record<string, unknown>, ownerId?: string) => void;
  requestSettled?: (reusable?: boolean) => void;
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
            if (msg.id && msg.url) route.http?.(msg.id, msg.url, msg.options ?? {}, msg.ownerId);
          } else if (msg.type === "request-response") {
            // 按消息 id 跨 runtime 路由（req-{rid}-{seq}）
            const ownerRid = msg.rid ?? "";
            const table = ensureRequestIdRoutes.get(ownerRid);
            const pending = msg.id ? table?.get(msg.id) : undefined;
            if (pending) {
              table!.delete(msg.id!);
              route.requestSettled?.(msg.reusable);
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
const httpLimiter = createRequestLimiter({ limit: MAX_INFLIGHT_CUSTOM_SOURCE_REQUESTS });

async function bridgeProxyFetch(
  id: string,
  url: string,
  options: Record<string, unknown>,
  rid: string,
  controller: AbortController,
): Promise<void> {
  const finish = (response: unknown, body: unknown, error?: string) => {
    sendToWebView({ type: "http-response", id, response, body, error, rid });
  };
  let release: (() => void) | undefined;
  const timeoutMs =
    typeof options.timeout === "number" && options.timeout > 0
      ? Math.min(options.timeout, 60_000)
      : 60_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    release = await httpLimiter.acquire(controller.signal);
    throwIfAborted(controller.signal);
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
      // SAFETY: RN 的全局 AbortSignal 与 DOM lib 的 AbortSignal 是不同声明，运行时同一对象，
      // fetch 可直接消费；该断言仅跳过类型声明差异，无运行时转换。
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
    release?.();
  }
}

/**
 * React Native 版自定义音源运行时。
 *
 * 与桌面端 src/services/customSourceRuntime.ts 行为对齐，差异点：
 * - 网络请求：桌面端用 @tauri-apps/plugin-http 的 tauriFetch，RN 用全局 fetch。
 * - 定时器：桌面端用 window.setTimeout/clearTimeout，RN 用全局 setTimeout/clearTimeout。
 * - zlib：桌面端用 CompressionStream + Tauri 原生 zlib，RN 用 pako（见 utils/compression.ts）。
 * - crypto / RSA：crypto-js 与 node-forge 两端共用，已在 mobile package.json 中声明依赖。
 * - RN 没有 window / globalThis 上的部分 API；脚本也不在 RN JS 线程内执行，而是发给隐藏 WebView
 *   （android/app/src/main/assets/lx_bridge/index.html），在 WebView 内核里以与本模块同构的
 *   SES Compartment 中运行（见 createRuntime 与 services/customSourceWebViewBridge.tsx）。
 *   原因：Hermes release 构建不支持 new Function/eval，LX 脚本无法在 RN 线程内执行。
 */

// 脚本协议（头部解析、能力归一化、取链请求、更新比对、深度测试编排）在 @lx/core 的
// custom-source 模块里，两端共用；本文件只保留移动端宿主：WebView 桥路由、
// lx.request 的 RN 侧代理与运行时缓存。
//
// 平台取链请求的类型随 requestCustomSourceMusicUrl 的签名一起从这里给出。
export type { CustomSourcePlatformRequest };

interface RuntimeInstance {
  readonly disposed: boolean;
  init: Promise<CustomSourceRuntimeInitResult>;
  request: (data: CustomSourceRuntimeRequestPayload, signal?: AbortSignal) => Promise<CustomSourceRuntimeRequestResult>;
  getUpdateAlert: () => CustomSourceUpdateAlert | undefined;
  waitForUpdateAlert: (timeoutMs: number) => Promise<CustomSourceUpdateAlert | undefined>;
  setUpdateAlertHandler: (handler: ((alert: CustomSourceUpdateAlert) => void) | null) => void;
  dispose: () => void;
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
        Accept: CUSTOM_SOURCE_REMOTE_SCRIPT_ACCEPT,
      },
    },
    REMOTE_SCRIPT_FETCH_TIMEOUT_MS,
  );
  return readCustomSourceRemoteScript(response);
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
  let requestHandler: ((payload: CustomSourceRuntimeRequestPayload, signal?: AbortSignal) => Promise<unknown>) | null = null;
  let finishInit: (value: CustomSourceRuntimeInitResult) => void = () => undefined;
  let failInit: (error: Error) => void = () => undefined;
  let initSettled = false;
  let disposed = false;
  let initTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let updateAlert: CustomSourceUpdateAlert | undefined;
  // 一个 runtime 只接受第一次合法的 updateAlert（含 inited 携带的那一条）。
  // 脚本在重试 / 取链循环里重复 send(updateAlert) 是常见写法，若每次都上浮，
  // 用户会看到同一个「音源有新版本」弹窗连续弹出。后续调用静默忽略，不抛错——
  // 抛错会让脚本的 await send(...) 变成拒绝，打断它自己的流程。
  let updateAlertSeen = false;
  const updateAlertWaiters = new Set<(alert: CustomSourceUpdateAlert | undefined) => void>();
  // 正常播放/下载取链时脚本主动 send(updateAlert) 的透传回调；
  // 仅在没有任何 waiter 等待时触发，避免与测试/更新检查流程的等待重复上报
  let updateAlertHandler: ((alert: CustomSourceUpdateAlert) => void) | null = null;
  const init = new Promise<CustomSourceRuntimeInitResult>((resolve, reject) => {
    finishInit = resolve;
    failInit = reject;
  });

  // —— WebView 桥路由（Hermes 不支持 new Function，脚本在隐藏 WebView 内执行） ——
  const rid = `rt-${++runtimeSeq}`;
  let requestSeq = 0;
  const httpRequests = new Map<string, { ownerId?: string; controller: AbortController }>();
  const cancelHttp = (ownerId?: string) => {
    for (const request of httpRequests.values()) {
      if (ownerId === undefined || request.ownerId === ownerId) request.controller.abort();
    }
  };

  ensureBridgeHandlers();
  bridgeRoutes.set(rid, {
    inited(sources, alert) {
      if (disposed || initSettled) return;
      initSettled = true;
      if (initTimeoutId) clearTimeout(initTimeoutId);
      const normalizedAlert = alert ? normalizeCustomSourceUpdateAlert(alert) : undefined;
      if (normalizedAlert && !updateAlertSeen) {
        updateAlertSeen = true;
        updateAlert = normalizedAlert;
      }
      try {
        finishInit({ sources: normalizeCustomSourceInitSources(sources), updateAlert });
      } catch (error) {
        failInit(error instanceof Error ? error : new Error(String(error)));
      }
    },
    updateAlert(alert) {
      if (disposed) return;
      const normalized = normalizeCustomSourceUpdateAlert(alert);
      if (!normalized || updateAlertSeen) return;
      updateAlertSeen = true;
      updateAlert = normalized;
      if (updateAlertWaiters.size > 0) {
        for (const waiter of updateAlertWaiters) waiter(normalized);
        updateAlertWaiters.clear();
      } else {
        updateAlertHandler?.(normalized);
      }
    },
    error(message) {
      if (!disposed && !initSettled) {
        initSettled = true;
        if (initTimeoutId) clearTimeout(initTimeoutId);
        failInit(new Error(message));
      }
    },
    http(id, url, options, ownerId) {
      if (disposed) return;
      if (ownerId && !pendingById.has(ownerId)) return;
      // 脚本发起的 lx.request → RN 侧 fetch 代理（出站校验+超时），结果回传 WebView
      const controller = new AbortController();
      httpRequests.set(id, { ownerId, controller });
      void bridgeProxyFetch(id, url, options, rid, controller).finally(() => httpRequests.delete(id));
    },
    requestSettled(reusable) {
      if (reusable === false) dispose();
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
    cancelHttp();
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
  requestHandler = (payload, signal) =>
    new Promise<unknown>((resolve, reject) => {
      throwIfAborted(signal);
      if (disposed) {
        reject(new Error("自定义音源运行时已释放"));
        return;
      }
      const id = `req-${rid}-${++requestSeq}`;
      const cancelRequest = (error: Error) => {
        const pending = pendingById.get(id);
        if (!pending) return;
        pendingById.delete(id);
        cancelHttp(id);
        sendToWebView({ type: "request-cancel", rid, id });
        pending.reject(error);
        // 用户脚本的 await continuation 无法撤销；取消后退休实例，禁止旧代码复用新请求。
        dispose();
      };
      const abort = () => cancelRequest(cancellationError());
      const timer = setTimeout(() => {
        cancelRequest(new Error("自定义音源取链超时"));
      }, 30_000);
      // 包一层 settle 前先清定时器：成功/失败（含上层中断）都不留下 30s 的悬挂定时器
      pendingById.set(id, {
        resolve: (value: unknown) => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", abort);
          cancelHttp(id);
          resolve(value);
        },
        reject: (error: unknown) => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", abort);
          cancelHttp(id);
          reject(error);
        },
      });
      signal?.addEventListener("abort", abort, { once: true });
      sendToWebView({ type: "request", rid, id, payload });
    });

  // WebView 内独立 SES Compartment 执行，init 结果经 inited/error 消息回传。
  try {
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
  }, CUSTOM_SOURCE_INIT_TIMEOUT_MS);

  return {
    get disposed() { return disposed; },
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
    async request(data, signal) {
      if (disposed) throw new Error("自定义音源运行时已释放");
      await waitWithSignal(init, signal);
      throwIfAborted(signal);
      if (!requestHandler) throw new Error("Request event is not defined");
      const response = await requestHandler({
        source: data.source,
        action: data.action,
        info: data.info,
      }, signal);
      const result = toCustomSourceRuntimeRequestResult(data, response);
      if (data.action === "musicUrl") {
        // 在脚本返回值入口收口：这个 URL 下游会流向 probeStreamUrl、
        // RNFS.downloadFile 与 TrackPlayer，三处都不做出站校验。
        // 上一步已确认 musicUrl 的返回值是 http(s) 字符串。
        assertPublicOutboundUrl(response as string, "自定义音源播放地址");
      }
      return result;
    },
    dispose,
  };
}

// ─── Runtime 缓存 ────────────────────────────────────────────
// 按 api.id + api.script 的 hash 缓存已初始化的 RuntimeInstance，避免每次播放
// 都重新执行脚本（createRuntime 内含 new Function + 网络初始化，耗时且有超时风险）。

const runtimeCache = new Map<string, RuntimeInstance[]>();
const busyRuntimes = new Set<RuntimeInstance>();
// 执行期限由播放候选调度器持有；运行时只限制真实并发，不重复抢占慢请求。
const runtimeLimiter = createRequestLimiter({ limit: MAX_INFLIGHT_CUSTOM_SOURCE_REQUESTS });

function removeRuntime(runtime: RuntimeInstance): void {
  for (const [key, entries] of runtimeCache) {
    const remaining = entries.filter(entry => entry !== runtime);
    if (remaining.length === entries.length) continue;
    if (remaining.length) runtimeCache.set(key, remaining);
    else runtimeCache.delete(key);
  }
  runtime.dispose();
}

/** 活跃租用最多三个；空闲池也最多三个，按插入顺序淘汰旧脚本。 */
function trimRuntimeCache(): void {
  const idle = [...runtimeCache.values()].flat().filter(runtime => !busyRuntimes.has(runtime));
  for (const runtime of idle.slice(0, Math.max(0, idle.length - MAX_INFLIGHT_CUSTOM_SOURCE_REQUESTS))) {
    removeRuntime(runtime);
  }
}

function getCacheKey(api: CustomSourceItem): string {
  const scriptHash = CryptoJS.SHA256(normalizeCustomSourceScript(api.script)).toString();
  return `${api.id}::${scriptHash}`;
}

function getCachedRuntime(api: CustomSourceItem): RuntimeInstance {
  const key = getCacheKey(api);
  const entries = runtimeCache.get(key) ?? [];
  const cached = entries.find(runtime => !busyRuntimes.has(runtime));
  if (cached) {
    busyRuntimes.add(cached);
    return cached;
  }
  const runtime = createRuntime(api);
  busyRuntimes.add(runtime);
  runtimeCache.set(key, [...entries, runtime]);
  // 初始化失败时从缓存中移除并释放，下次重试。
  runtime.init.catch(() => {
    removeRuntime(runtime);
  });
  return runtime;
}

/** 清除某个音源的 Runtime 缓存（重新导入脚本时调用） */
export function invalidateRuntimeCache(apiId: string): void {
  for (const [key, runtimes] of runtimeCache.entries()) {
    if (!key.startsWith(`${apiId}::`)) continue;
    runtimeCache.delete(key);
    for (const runtime of runtimes) runtime.dispose();
  }
}

/** 把已初始化的 Runtime 放回缓存（深度测试复用，避免重复执行脚本） */
function primeRuntimeCache(api: CustomSourceItem, runtime: RuntimeInstance): void {
  const key = getCacheKey(api);
  const previous = runtimeCache.get(key);
  for (const entry of previous ?? []) if (entry !== runtime) entry.dispose();
  runtimeCache.set(key, [runtime]);
  trimRuntimeCache();
}

export async function testCustomSource(
  api: CustomSourceItem,
  updateAlertWaitMs = CUSTOM_SOURCE_TEST_UPDATE_ALERT_WAIT_MS,
): Promise<CustomSourceRuntimeInitResult> {
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
// 测哪些平台、预算怎么分、结果怎么汇总在 @lx/core 的 deep-test 里；这里负责脚本的
// 启动与释放、运行时缓存的去留，并提供超时守卫。

/** 超时以 `${label}超时（Nms）` 拒绝，原任务的成败原样透传；文案与桌面端一致。 */
function withTimeout<T>(task: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}超时（${timeoutMs}ms）`)), timeoutMs);
    task.then(
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
  updateAlertWaitMs = CUSTOM_SOURCE_TEST_UPDATE_ALERT_WAIT_MS,
): Promise<CustomSourceDeepTestResult> {
  // 阶段一：复用现有 init 流程
  invalidateRuntimeCache(api.id);
  const runtime = createRuntime(api);
  let initResult: CustomSourceRuntimeInitResult;
  try {
    initResult = await runtime.init;
    initResult = { ...initResult, updateAlert: initResult.updateAlert ?? (await runtime.waitForUpdateAlert(updateAlertWaitMs)) };
  } catch (error) {
    runtime.dispose();
    return buildCustomSourceDeepTestInitFailure(error);
  }

  primeRuntimeCache(api, runtime);

  // 阶段二：脚本声明了哪些平台就逐个测哪些（wy/tx/kw/kg），不再只测 wy。
  const plan = planCustomSourceDeepTest(initResult);
  if (plan.verdict) return plan.verdict;

  const { passed, result } = await runCustomSourceDeepTestPlatforms(initResult, plan.platforms, {
    searchers: hiddenSourceSearchers,
    withTimeout,
    requestMusicUrl: (target, quality) =>
      requestCustomSourceMusicUrl(api, target.music, quality, undefined, target.platformRequest),
    probeStream: (url, target, timeoutMs) => probeStreamUrl(url, buildStreamHeaders(target.platform), timeoutMs),
  });
  // 全部平台都失败时才丢弃这个 runtime；有任一平台通过就保留，避免下次播放重新初始化。
  // 必须走 invalidateRuntimeCache：只 dispose 会留下缓存里的已释放实例，
  // 之后命中缓存时 request() 立即失败，该音源在本会话内不可用。
  if (passed === 0) invalidateRuntimeCache(api.id);
  return result;
}

export async function checkCustomSourceUpdate(api: CustomSourceItem): Promise<CustomSourceRuntimeInitResult> {
  const result = await testCustomSource(api, CUSTOM_SOURCE_CHECK_UPDATE_ALERT_WAIT_MS);
  if (result.updateAlert) return result;
  const remoteAlert = await checkCustomSourceRemoteUpdate(api, fetchRemoteScript);
  return { ...result, updateAlert: remoteAlert };
}

export async function requestCustomSourceMusicUrl(
  api: CustomSourceItem,
  music: MusicInfo,
  quality: string,
  onUpdateAlert?: ((alert: CustomSourceUpdateAlert) => void) | null,
  platformRequest?: CustomSourcePlatformRequest,
  signal?: AbortSignal,
): Promise<{ url: string; quality: string; sources?: Record<string, CustomSourceSourceInfo> }> {
  const release = await runtimeLimiter.acquire(signal);
  const scope = createCancellationScope(signal);
  let runtime: RuntimeInstance | undefined;
  let reusable = false;
  try {
    throwIfAborted(scope.signal);
    runtime = getCachedRuntime(api);
    // 注入回调后，取链期间脚本 send(updateAlert) 且无 waiter 等待时会透传给消费方。
    // undefined 表示「不改动已有监听器」——隐藏兜底与主链共享同一 runtime，
    // 传 undefined 若写成 onUpdateAlert ?? null 会把主链刚注册的回调清空。
    // 显式传 null 才清掉历史回调。
    if (onUpdateAlert !== undefined) runtime.setUpdateAlertHandler(onUpdateAlert);
    const initResult = await waitWithSignal(runtime.init, scope.signal);
    throwIfAborted(scope.signal);
    const result = await runtime.request(
      buildCustomSourceMusicUrlRequest(initResult.sources, music, quality, platformRequest),
      scope.signal,
    );
    reusable = true;
    return { ...readCustomSourceMusicUrlResult(result, quality), sources: initResult.sources };
  } finally {
    if (runtime) {
      busyRuntimes.delete(runtime);
      if (runtime.disposed || (!reusable && scope.signal.aborted)) removeRuntime(runtime);
    }
    scope.dispose();
    release();
    trimRuntimeCache();
  }
}
