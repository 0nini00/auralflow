import type { MusicInfo } from "@lx/core";
import CryptoJS from "crypto-js";
import {
  assertPublicOutboundUrl,
  compareCustomSourceVersions,
  isLikelyCustomSourceRemoteUrl,
  matchHiddenCandidates,
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
import { hiddenSourceSearchers } from "./hiddenSourceSearchers";

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
 * - RN 没有 window / globalThis 上的部分 API；脚本也不在 RN JS 线程内执行，而是发给隐藏 WebView
 *   （android/app/src/main/assets/lx_bridge/index.html），在 WebView 内核里以与本模块同构的
 *   参数遮蔽沙箱运行（见 createRuntime 与 services/customSourceWebViewBridge.tsx）。
 *   原因：Hermes release 构建不支持 new Function/eval，LX 脚本无法在 RN 线程内执行。
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

const INIT_TIMEOUT_MS = 30_000;
const TEST_UPDATE_ALERT_WAIT_MS = 800;
const CHECK_UPDATE_ALERT_WAIT_MS = 5_000;

const ALL_SOURCES = ["kg", "kw", "tx", "wy", "local"];
const SUPPORT_QUALITIES: Record<string, string[]> = {
  kg: ["128k", "320k", "flac", "flac24bit"],
  kw: ["128k", "320k", "flac", "flac24bit"],
  tx: ["128k", "320k", "flac", "flac24bit"],
  wy: ["128k", "320k", "flac", "flac24bit"],
  local: [],
};
const SUPPORT_ACTIONS: Record<string, string[]> = {
  kg: ["musicUrl"],
  kw: ["musicUrl"],
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
 * 隐藏兜底音源取链请求：把平台标识与平台曲目元数据显式传给脚本。
 *
 * 隐藏平台的曲目不存在于 `MusicInfo.source`（那是 UI 来源），因此不能只靠
 * music 字段推断；songmid/interval/albumName 等也来自平台搜索结果而非原曲。
 */
export interface CustomSourcePlatformRequest {
  source: string;
  songmid?: string;
  interval?: number;
  albumName?: string;
  picUrl?: string;
  extra?: Record<string, string | number>;
}

/**
 * 转换为 lx-music 协议的 musicInfo。
 *
 * tx 取链依赖 strMediaMid（脚本用它拼 M500{mid}.mp3 / F000{mid}.flac），
 * albumId 在 lx 的 tx musicInfo 里存的也是专辑 mid 而非数字 id；
 * songmid 与 songId 对 tx 是两个不同的值，不能都填 music.id。
 *
 * 隐藏兜底音源通过 platformRequest 覆盖 source/songmid/时长/专辑/封面，
 * extra 里携带酷狗 hash 等脚本必需字段。extra 展开放在最前：协议字段以显式
 * 映射为准，避免平台返回的同名字段（name/singer/songmid…）覆盖它们；
 * 只有 albumId/albumMid 例外，平台值优先于 tx 的专辑 mid。
 */
function toOldMusicInfo(
  music: MusicInfo,
  platformRequest?: CustomSourcePlatformRequest,
): Record<string, unknown> {
  const tx = music.txMeta;
  const songmid = platformRequest?.songmid ?? music.id;
  const extra = platformRequest?.extra;
  return {
    ...extra,
    name: music.name,
    singer: music.singer,
    source: platformRequest?.source ?? music.source,
    songmid,
    songId: tx?.songId || songmid,
    interval: platformRequest?.interval ?? music.interval,
    albumName: platformRequest?.albumName ?? music.albumName,
    albumId: extra?.albumId ?? tx?.albumMid ?? "",
    albumMid: extra?.albumMid ?? extra?.albumId ?? tx?.albumMid ?? "",
    strMediaMid: tx?.strMediaMid ?? "",
    img: platformRequest?.picUrl ?? music.picUrl ?? music.img ?? "",
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

// ── 静态防逃逸扫描 ─────────────────────────────────────────────
// 与 WebView 桥内的 shadowed 沙箱（13 个参数遮蔽，见 lx_bridge/index.html）构成双层防御。
// 这是 RN 侧唯一阻断脚本逃逸到真实内建（Function/fetch，→ 横向 SSRF）的检查。
// 重点：bridge 内 window/globalThis/global/self 已被遮蔽为 Object.create(null)，
// 单纯出现这些词（class 构造器 / x.constructor===Object / 字符串 "eval" /
// Function.prototype / globalThis polyfill）都不是逃逸；只有“动态调用真正到达内建
// Function/eval”（eval(...)、Function(...)、x.constructor.constructor(...)() 等调用形态）才是逃逸。
// 因此这里只匹配“调用形态”（带 ( ）的模式，不再按裸词/词边界拒绍。
const FORBIDDEN_INTRINSIC_PATTERNS: Array<RegExp> = [
  /\beval\s*\(/i, // eval( 直接调用真实 eval
  /\[\s*['"`]?\s*eval\s*['"`]?\s*\]\s*\(/i, // ['ev'+'al']( / [eval]( 拼接/下标取 eval
  /\bFunction\s*\(/, // Function( / new Function( 调用构造器
  /\[\s*['"`]?\s*Function\s*['"`]?\s*\]\s*\(/, // ['Function'](
  /\.\s*constructor\s*\.\s*constructor\s*\(/, // x.constructor.constructor( 双重原型链逃逸
  /\.\s*constructor\s*\(\s*/, // x.constructor( 动态调用
  /\[\s*['"`]?\s*constructor\s*['"`]?\s*\]\s*\.\s*constructor\s*\(/, // x['constructor'].constructor(
  /\[\s*['"`]?\s*constructor\s*['"`]?\s*\]\s*\(\s*/, // x['constructor'](
  /\]\s*\[\s*['"`]?\s*constructor\s*['"`]?\s*\]\s*\(\s*/, // x['constructor']['constructor'](
];

function normalizeScriptForStaticGuard(script: string): { collapsed: string; flat: string } {
  // 去掉块注释；行注释仅当 // 前不是冒号时才算注释（避免把 http://、https:// 里的 // 截断成注释）
  let s = script
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\r\n]*/g, "$1 ");
  // 解码常见转义：\uXXXX 与 \xXX（\u0065val → eval，\u0063onstructor → constructor）
  s = s
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  // 折叠空白
  const collapsed = s.replace(/\s+/g, "");
  // flat：再去掉引号/反引号/加号，把字面量拼接坍缩成单个标识符，
  // 打击 ['ev'+'al'] / ["con"+"structor"] / [`fun`+`ction`] 这类拼接。
  const flat = collapsed.replace(/["'`+]/g, "");
  return { collapsed, flat };
}

function assertNoDangerousIntrinsicAccess(script: string): void {
  const { collapsed, flat } = normalizeScriptForStaticGuard(script);
  for (const pattern of FORBIDDEN_INTRINSIC_PATTERNS) {
    if (pattern.test(collapsed) || pattern.test(flat)) {
      throw new Error("自定义音源包含不允许的动态代码执行");
    }
  }
}

function createRuntime(api: CustomSourceItem): RuntimeInstance {
  let requestHandler: ((payload: RuntimeRequestPayload) => Promise<unknown>) | null = null;
  let finishInit: (value: RuntimeInitResult) => void = () => undefined;
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
      const normalizedAlert = alert ? normalizeUpdateAlert(alert) : undefined;
      if (normalizedAlert && !updateAlertSeen) {
        updateAlertSeen = true;
        updateAlert = normalizedAlert;
      }
      try {
        finishInit({ sources: normalizeInitSources(sources), updateAlert });
      } catch (error) {
        failInit(error instanceof Error ? error : new Error(String(error)));
      }
    },
    updateAlert(alert) {
      if (disposed) return;
      const normalized = normalizeUpdateAlert(alert);
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
      const timer = setTimeout(() => {
        const pending = pendingById.get(id);
        if (pending) {
          pendingById.delete(id);
          pending.reject(new Error("自定义音源取链超时"));
        }
      }, 30_000);
      // 包一层 settle 前先清定时器：成功/失败（含上层中断）都不留下 30s 的悬挂定时器
      pendingById.set(id, {
        resolve: (value: unknown) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error: unknown) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      sendToWebView({ type: "request", rid, id, payload });
    });

  // WebView 内执行（Hermes 不支持 new Function）：把脚本发送给桥，
  // 桥内以与桌面同构的参数遮蔽沙箱执行，init 结果经 inited/error 消息回传。
  try {
    // 静态扫描（与桌面一致）：拒绝明显的动态调用逃逸手法，双层防御。
    // 只匹配“调用形态”（eval( / Function( / x.constructor.constructor( 等），
    // 不按裸词拒绝（class 构造器、x.constructor===Object、字符串 "eval"、globalThis polyfill 均放行）；
    // 覆盖 ['con'+'structor']、[].constructor['constructor'](...)()、\u0065val、https:// 注释误判等。
    assertNoDangerousIntrinsicAccess(api.script);
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
const DEEP_TEST_SEARCH_TIMEOUT_MS = 6_000;
const DEEP_TEST_PLATFORM_BUDGET_MS = 25_000;
const DEEP_TEST_MIN_PLATFORM_BUDGET_MS = 5_000;
const DEEP_TEST_TOTAL_BUDGET_MS = 60_000;
const DEEP_TEST_QUALITY = "128k";

/** 内置固定测试曲（id 均为公开常驻曲目，可按需替换）：
 *  - wy：2034742057 林俊杰-江南（备选 1492167768）
 *  - tx：songmid 0039MnYb0qxYhV
 *  - kw/kg：用隐藏音源搜索按名找同曲，不依赖固定 id
 */
const DEEP_TEST_TRACKS: Record<"wy" | "tx", { id: string; name: string; singer: string; albumName: string }> = {
  wy: { id: "2034742057", name: "江南", singer: "林俊杰", albumName: "第二天堂" },
  tx: { id: "0039MnYb0qxYhV", name: "江南", singer: "林俊杰", albumName: "第二天堂" },
};

/** 深度测试固定曲目：与固定 wy/tx 曲目同一首歌，用于按平台搜索。 */
const DEEP_TEST_SONG = { name: "江南", singer: "林俊杰", albumName: "第二天堂", interval: 267 };

/** 脚本声明了 musicUrl 的平台逐个测试；不在这里枚举的平台不参与。 */
const DEEP_TEST_PLATFORMS = ["wy", "tx", "kw", "kg"] as const;
type DeepTestPlatform = (typeof DEEP_TEST_PLATFORMS)[number];

interface DeepTestTarget {
  platform: DeepTestPlatform;
  music: MusicInfo;
  platformRequest?: CustomSourcePlatformRequest;
}

function compactTestDetail(value: string): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length > 160 ? `${trimmed.slice(0, 160)}...` : trimmed;
}

/** 为平台准备测试曲：wy/tx 用固定 id；kw/kg 先原生搜索同曲，再取平台元数据。 */
async function buildDeepTestTarget(
  platform: DeepTestPlatform,
  searchTimeoutMs = DEEP_TEST_SEARCH_TIMEOUT_MS,
): Promise<DeepTestTarget> {
  if (platform === "wy" || platform === "tx") {
    const track = DEEP_TEST_TRACKS[platform];
    return {
      platform,
      music: {
        id: track.id,
        name: track.name,
        singer: track.singer,
        albumName: track.albumName,
        source: platform,
      },
    };
  }

  const searcher = hiddenSourceSearchers.find((item) => item.id === platform);
  if (!searcher) throw new Error("该平台没有可用的搜索实现");
  const tracks = await withTimeout(
    searcher.search(`${DEEP_TEST_SONG.name} ${DEEP_TEST_SONG.singer}`),
    searchTimeoutMs,
    `搜索测试曲目超时（超过 ${Math.round(searchTimeoutMs / 1000)}s）`,
  );
  const track = matchHiddenCandidates(DEEP_TEST_SONG, tracks)[0];
  if (!track) throw new Error("未在平台搜到匹配的测试曲目");

  return {
    platform,
    // MusicInfo.source 是 UI 来源，这里只是占位；真正的平台来源由 platformRequest 透传。
    music: {
      id: track.id,
      name: track.name,
      singer: track.singer,
      albumName: track.albumName ?? DEEP_TEST_SONG.albumName,
      source: "tx",
      interval: track.interval,
      picUrl: track.picUrl,
    },
    platformRequest: {
      source: platform,
      songmid: track.id,
      interval: track.interval,
      albumName: track.albumName,
      picUrl: track.picUrl,
      extra: track.extra,
    },
  };
}

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

  // 阶段二：脚本声明了哪些平台就逐个测哪些（wy/tx/kw/kg），不再只测 wy。
  const sources = initResult.sources ?? {};
  const declaredPlatforms = Object.keys(sources).filter((id) => sources[id]?.actions.includes("musicUrl"));
  if (declaredPlatforms.length === 0) {
    return { ok: true, message: "初始化正常；未声明 musicUrl，仅验证初始化", sources, updateAlert: initResult.updateAlert };
  }
  const platforms = DEEP_TEST_PLATFORMS.filter((name) => declaredPlatforms.includes(name));
  if (platforms.length === 0) {
    return {
      ok: false,
      message: `初始化正常；脚本只声明了 ${declaredPlatforms.join("/")}，当前深度测试仅覆盖 wy/tx/kw/kg`,
      sources,
      updateAlert: initResult.updateAlert,
    };
  }

  const startedAt = Date.now();
  const results: Array<{ platform: DeepTestPlatform; ok: boolean; detail: string }> = [];

  for (let index = 0; index < platforms.length; index += 1) {
    const platform = platforms[index];
    const remaining = DEEP_TEST_TOTAL_BUDGET_MS - (Date.now() - startedAt);
    if (remaining <= 0) {
      results.push({ platform, ok: false, detail: "未测试（总预算耗尽）" });
      continue;
    }

    // 总预算按剩余平台均摊：慢平台不能吃掉后面所有平台的测试机会。
    const platformsLeft = platforms.length - index;
    const platformBudget = Math.min(
      remaining,
      Math.max(
        DEEP_TEST_MIN_PLATFORM_BUDGET_MS,
        Math.min(DEEP_TEST_PLATFORM_BUDGET_MS, Math.floor(remaining / platformsLeft)),
      ),
    );
    const platformStartedAt = Date.now();

    // quality 兼容：128k 不在脚本声明白名单时退回声明的最低音质
    const declared = sources[platform]?.qualitys ?? [];
    const quality = declared.includes(DEEP_TEST_QUALITY) ? DEEP_TEST_QUALITY : declared[0] ?? DEEP_TEST_QUALITY;

    let target: DeepTestTarget;
    try {
      target = await buildDeepTestTarget(platform, Math.min(DEEP_TEST_SEARCH_TIMEOUT_MS, platformBudget));
    } catch (error) {
      results.push({
        platform,
        ok: false,
        detail: `搜索测试曲目失败：${compactTestDetail(error instanceof Error ? error.message : String(error))}`,
      });
      continue;
    }

    try {
      const chainBudget = Math.min(
        DEEP_TEST_TIMEOUT_MS,
        platformBudget - (Date.now() - platformStartedAt),
      );
      if (chainBudget <= 0) throw new Error("总预算耗尽");
      const result = await withTimeout(
        requestCustomSourceMusicUrl(api, target.music, quality, undefined, target.platformRequest),
        chainBudget,
        `取链测试超时（超过 ${Math.round(chainBudget / 1000)}s 未返回播放地址）`,
      );
      if (!/^https?:\/\//.test(result.url)) {
        throw new Error(`未返回可播放 URL：${result.url.slice(0, 128)}`);
      }
      results.push({ platform, ok: true, detail: `${result.quality || quality}` });
    } catch (error) {
      results.push({
        platform,
        ok: false,
        detail: `取链失败：${compactTestDetail(error instanceof Error ? error.message : String(error))}`,
      });
    }
  }

  const passed = results.filter((item) => item.ok).length;
  const ok = passed === results.length;
  // 全部平台都失败时才丢弃这个 runtime；有任一平台通过就保留，避免下次播放重新初始化。
  // 必须走 invalidateRuntimeCache：只 dispose 会留下缓存里的已释放实例，
  // 之后命中缓存时 request() 立即失败，该音源在本会话内不可用。
  if (passed === 0) invalidateRuntimeCache(api.id);

  const summary = results
    .map((item) => `${item.platform} ${item.ok ? "通过" : "失败"}:${item.detail}`)
    .join("；");
  return {
    ok,
    message: `初始化正常；取链测试 ${passed}/${results.length} 通过（${summary}）`,
    sources: initResult.sources ?? sources,
    updateAlert: initResult.updateAlert,
  };
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
  onUpdateAlert?: ((alert: CustomSourceUpdateAlert) => void) | null,
  platformRequest?: CustomSourcePlatformRequest,
): Promise<{ url: string; quality: string; sources?: Record<string, CustomSourceSourceInfo> }> {
  const runtime = getCachedRuntime(api);
  // 注入回调后，取链期间脚本 send(updateAlert) 且无 waiter 等待时会透传给消费方。
  // undefined 表示「不改动已有监听器」——隐藏兜底与主链共享同一 runtime，
  // 传 undefined 若写成 onUpdateAlert ?? null 会把主链刚注册的回调清空。
  // 显式传 null 才清掉历史回调。
  if (onUpdateAlert !== undefined) runtime.setUpdateAlertHandler(onUpdateAlert);
  const initResult = await runtime.init;
  const sourceId = platformRequest?.source ?? music.source;
  const sourceInfo = initResult.sources?.[sourceId];
  if (!sourceInfo?.actions.includes("musicUrl")) {
    throw new Error(`音源不支持 ${sourceId} 的播放链接解析`);
  }
  if (sourceInfo.qualitys.length && !sourceInfo.qualitys.includes(quality)) {
    throw new Error(`音源不支持 ${quality} 音质`);
  }

  const result = await runtime.request({
    source: sourceId,
    action: "musicUrl",
    info: {
      type: quality,
      musicInfo: toOldMusicInfo(music, platformRequest),
    },
  });
  const data = result.data as { url?: string; type?: string };
  if (!data.url) throw new Error("自定义音源没有返回可播放 URL");
  return { url: data.url, quality: data.type || quality, sources: initResult.sources };
}
