import CryptoJS from 'crypto-js';
import forge from 'node-forge';
import {
  createRequestLimiter,
  MAX_INFLIGHT_CUSTOM_SOURCE_REQUESTS,
  CUSTOM_SOURCE_CHECK_UPDATE_ALERT_WAIT_MS,
  CUSTOM_SOURCE_INIT_TIMEOUT_MS,
  CUSTOM_SOURCE_REMOTE_SCRIPT_ACCEPT,
  CUSTOM_SOURCE_TEST_UPDATE_ALERT_WAIT_MS,
  buildCustomSourceDeepTestInitFailure,
  buildCustomSourceMusicUrlRequest,
  checkCustomSourceRemoteUpdate,
  normalizeCustomSourceInitSources,
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
} from '@lx/core';
import { outboundRequest } from '@/services/outboundHttp';
import { hiddenSourceSearchers } from '@/services/sources/hidden/hiddenSearchers';
import { awaitCustomSourceOperation, CustomSourceDisabledError, type CustomSourceOperation } from '@/services/customSourceAccess';
import { deflateBytes, inflateBytes, zlibFormatFromOptions } from '@/utils/compression';
import { withTimeout } from '@/utils/withTimeout';
import { createCancellationScope, throwIfAborted, waitWithSignal } from './playback/cancellation';
import { createPlaybackRequestScheduler } from './playback/requestScheduler';

// 脚本协议（头部解析、能力归一化、取链请求、更新比对、深度测试编排）在 @lx/core 的
// custom-source 模块里，两端共用；本文件只保留桌面端宿主：new Function 执行环境、
// lx.request 出站代理、运行时缓存与取消令牌。
//
// 平台取链请求的类型随 requestCustomSourceMusicUrl 的签名一起从这里给出。
export type { CustomSourcePlatformRequest };

interface RuntimeInstance {
  operation: CustomSourceOperation;
  dispose: () => void;
  drain: () => Promise<void>;
  hasPendingRequests: () => boolean;
  init: Promise<CustomSourceRuntimeInitResult>;
  request: (data: CustomSourceRuntimeRequestPayload) => Promise<CustomSourceRuntimeRequestResult>;
  getUpdateAlert: () => CustomSourceUpdateAlert | undefined;
  waitForUpdateAlert: (timeoutMs: number) => Promise<CustomSourceUpdateAlert | undefined>;
  /** 消费方随时可更新监听器，命中缓存的旧 Runtime 也能接上运行时上浮 */
  setUpdateAlertListener: (listener?: UpdateAlertListener) => void;
}

/** 运行时收到合法 updateAlert 且无 waiter 等待时回调（由消费方注入，用于写 store 上浮全局更新弹窗） */
type UpdateAlertListener = (alert: CustomSourceUpdateAlert) => void;

interface CreateRuntimeOptions {
  onUpdateAlert?: UpdateAlertListener;
}

const EVENT_NAMES = {
  request: 'request',
  inited: 'inited',
  updateAlert: 'updateAlert',
} as const;

async function fetchRemoteScript(url: string, operation: CustomSourceOperation): Promise<string> {
  operation.assertActive();
  const response = await outboundRequest(url, {
    method: 'GET',
    headers: {
      Accept: CUSTOM_SOURCE_REMOTE_SCRIPT_ACCEPT,
    },
  });
  return readCustomSourceRemoteScript(response);
}

function responseRawBody(rawBody: unknown): string {
  // 二进制响应必须给 base64：JSON.stringify(Uint8Array) 会变成 {"0":137,"1":80,...}
  if (rawBody instanceof Uint8Array) return bytesToString(rawBody, 'base64');
  if (typeof rawBody === 'string') return rawBody;
  return JSON.stringify(rawBody);
}

function createRequestResponse(rawBody: unknown, status: number, statusText: string, headers: Record<string, string>) {
  const bodyBytes = rawBody instanceof Uint8Array ? rawBody : undefined;
  return {
    statusCode: status,
    statusMessage: statusText,
    headers: { ...headers },
    // 响应体字节数：二进制取真实长度，文本保持原有语义
    bytes: bodyBytes ? bodyBytes.byteLength : 0,
    raw: responseRawBody(rawBody),
    body: rawBody,
  };
}

function toBytes(value: string | ArrayBuffer | ArrayBufferView, encoding?: string): Uint8Array {
  if (typeof value === 'string') {
    if (encoding === 'hex') {
      const bytes = new Uint8Array(Math.floor(value.length / 2));
      for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
      }
      return bytes;
    }
    if (encoding === 'base64') {
      const binary = atob(value);
      return Uint8Array.from(binary, (char) => char.charCodeAt(0));
    }
    return new TextEncoder().encode(value);
  }
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  return new Uint8Array(value);
}

function bytesToWordArray(bytes: Uint8Array) {
  const words: number[] = [];
  for (let index = 0; index < bytes.length; index += 1) {
    words[index >>> 2] |= bytes[index] << (24 - (index % 4) * 8);
  }
  return CryptoJS.lib.WordArray.create(words, bytes.length);
}

function wordArrayToBytes(wordArray: CryptoJS.lib.WordArray): Uint8Array {
  const { words, sigBytes } = wordArray;
  const bytes = new Uint8Array(sigBytes);
  for (let index = 0; index < sigBytes; index += 1) {
    bytes[index] = (words[index >>> 2] >>> (24 - (index % 4) * 8)) & 0xff;
  }
  return bytes;
}

function bytesToBinaryString(bytes: Uint8Array): string {
  let result = '';
  for (const byte of bytes) result += String.fromCharCode(byte);
  return result;
}

function bytesToString(bytes: Uint8Array, format?: string): string {
  if (format === 'hex') return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  if (format === 'base64') return btoa(bytesToBinaryString(bytes));
  if (format === 'binary') return bytesToBinaryString(bytes);
  return new TextDecoder().decode(bytes);
}

function getAesMode(mode: string) {
  return mode.toLowerCase().includes('ecb') ? CryptoJS.mode.ECB : CryptoJS.mode.CBC;
}

function createUtils() {
  return {
    crypto: {
      aesEncrypt(
        buffer: string | ArrayBuffer | ArrayBufferView,
        mode: string,
        key: string | ArrayBuffer | ArrayBufferView,
        iv?: string | ArrayBuffer | ArrayBufferView,
      ) {
        const encrypted = CryptoJS.AES.encrypt(bytesToWordArray(toBytes(buffer)), bytesToWordArray(toBytes(key)), {
          iv: iv == null ? undefined : bytesToWordArray(toBytes(iv)),
          mode: getAesMode(mode),
          padding: CryptoJS.pad.Pkcs7,
        });
        return wordArrayToBytes(encrypted.ciphertext);
      },
      rsaEncrypt(buffer: string | ArrayBuffer | ArrayBufferView, key: string) {
        const source = toBytes(buffer);
        const padded = new Uint8Array(Math.max(128, source.length));
        padded.set(source, padded.length - source.length);
        const publicKey = forge.pki.publicKeyFromPem(key);
        const encrypted = publicKey.encrypt(bytesToBinaryString(padded), 'RAW');
        return Uint8Array.from(encrypted, (char) => char.charCodeAt(0));
      },
      md5(value: string) {
        return CryptoJS.MD5(value).toString();
      },
      randomBytes(size: number) {
        const bytes = new Uint8Array(size);
        crypto.getRandomValues(bytes);
        return bytes;
      },
    },
    buffer: {
      from(value: string | ArrayBuffer | ArrayBufferView, encoding?: string) {
        return toBytes(value, encoding);
      },
      bufToString(buf: ArrayBuffer | ArrayBufferView, format?: string) {
        return bytesToString(toBytes(buf), format);
      },
    },
    zlib: {
      async inflate(value: string | ArrayBuffer | ArrayBufferView, options?: unknown) {
        return inflateBytes(toBytes(value), zlibFormatFromOptions(options));
      },
      async deflate(value: string | ArrayBuffer | ArrayBufferView, options?: unknown) {
        return deflateBytes(toBytes(value), zlibFormatFromOptions(options));
      },
    },
  };
}

interface HttpRequestOptions {
  method?: string;
  timeout?: number;
  headers?: Record<string, string>;
  body?: unknown;
  form?: Record<string, string>;
  formData?: Record<string, string>;
  /** LX 兼容：'arraybuffer' / 'stream' 时回传二进制而不是文本 */
  responseType?: string;
}

function wantsBinaryResponse(responseType: string | undefined): boolean {
  const normalized = (responseType ?? '').toLowerCase();
  return normalized === 'arraybuffer' || normalized === 'stream' || normalized === 'blob';
}

type CustomSourceTaggedError = Error & { customSourceName?: string };

/** 给脚本收到的请求错误打上来源标签，全局 unhandledrejection 才能指认是哪个音源。 */
function tagCustomSourceError(error: unknown, sourceName: string): Error {
  const normalized = error instanceof Error ? error : new Error(String(error));
  (normalized as CustomSourceTaggedError).customSourceName = sourceName;
  return normalized;
}

const httpLimiter = createRequestLimiter({ limit: MAX_INFLIGHT_CUSTOM_SOURCE_REQUESTS });

function runHttpRequest(
  url: string,
  options: HttpRequestOptions,
  callback: (error: Error | null, response: unknown, body: unknown) => void,
  operation: CustomSourceOperation,
  sourceName: string,
  requests: Set<Promise<void>>,
): () => void {
  operation.assertActive();
  // 脚本调用 lx.request 时漏传回调：异步 IIFE 会在错误分支里以 TypeError 结束，
  // 变成一条无法归因的未处理拒绝。这里提前放弃并留下来源，不伪造成功响应。
  if (typeof callback !== 'function') {
    console.warn(`[自定义音源: ${sourceName}] lx.request 缺少回调`, url);
    return () => {};
  }
  // 出站校验（含 SSRF 与重定向逐跳）在 Rust 侧 outbound.rs 统一完成，这里不再重复判定。
  const scope = createCancellationScope(operation.signal);
  const timeoutMs = typeof options.timeout === 'number' && options.timeout > 0 ? Math.min(options.timeout, 60_000) : 60_000;
  // 脚本回调自己抛错时不能再走一次 callback —— 那会把回调错误变成新的未处理拒绝。
  const deliver = (error: Error | null, response: unknown, body: unknown) => {
    try {
      callback(error, response, body);
    } catch (callbackError) {
      console.warn(`[自定义音源: ${sourceName}] lx.request 回调抛错`, callbackError);
    }
  };

  const task = (async () => {
    let release: (() => void) | undefined;
    try {
      release = await httpLimiter.acquire(scope.signal);
      throwIfAborted(scope.signal);
      let body: string | undefined;
      if (options.body != null) {
        body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
      } else if (options.form) {
        body = new URLSearchParams(options.form).toString();
      } else if (options.formData) {
        body = new URLSearchParams(options.formData).toString();
      }

      const binary = wantsBinaryResponse(options.responseType);
      const response = await outboundRequest(url, {
        signal: scope.signal,
        method: options.method ?? 'GET',
        headers: options.headers,
        body,
        timeoutMs,
        // 二进制响应必须让 Rust 侧回 base64：按 UTF-8 lossy 转文本会把字节改掉
        responseType: binary ? 'base64' : 'text',
      });
      if (scope.signal.aborted || !operation.isActive()) return;
      if (binary) {
        // 脚本按 Buffer 使用（length / 下标 / utils.buffer.bufToString），Uint8Array 都满足
        const bytes = toBytes(response.base64(), 'base64');
        deliver(null, createRequestResponse(bytes, response.status, response.statusText, response.headers), bytes);
        return;
      }
      const text = await response.text();
      if (scope.signal.aborted || !operation.isActive()) return;
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
      deliver(null, createRequestResponse(parsed, response.status, response.statusText, response.headers), parsed);
    } catch (error) {
      if (scope.signal.aborted || !operation.isActive()) return;
      deliver(tagCustomSourceError(error, sourceName), null, null);
    } finally {
      scope.dispose();
      release?.();
    }
  })();
  requests.add(task);
  void task.finally(() => requests.delete(task));
  return () => scope.dispose();
}

function createRuntime(api: CustomSourceItem, parentOperation: CustomSourceOperation, options?: CreateRuntimeOptions): RuntimeInstance {
  parentOperation.assertActive();
  const controller = new AbortController();
  const requests = new Set<Promise<void>>();
  const operation: CustomSourceOperation = {
    signal: controller.signal,
    isActive: () => !controller.signal.aborted && parentOperation.isActive(),
    assertActive: () => {
      if (controller.signal.aborted) throw new CustomSourceDisabledError();
      parentOperation.assertActive();
    },
  };
  let initTimer: number | undefined;
  let requestHandler: ((payload: CustomSourceRuntimeRequestPayload) => Promise<unknown>) | null = null;
  let finishInit: (value: CustomSourceRuntimeInitResult) => void = () => undefined;
  let failInit: (error: Error) => void = () => undefined;
  let initSettled = false;
  let updateAlert: CustomSourceUpdateAlert | undefined;
  // 一个 runtime 只接受第一次合法的 updateAlert。
  //
  // 脚本在初始化失败重试、取链循环里重复 send(updateAlert) 是常见写法，若每次
  // 都上浮，用户会看到同一个「音源有新版本」弹窗连续弹出。这里静默忽略后续调用
  // （不抛错——抛错会让脚本的 await send(...) 变成拒绝，打断它自己的流程）。
  let updateAlertSeen = false;
  let updateAlertListener: UpdateAlertListener | undefined = options?.onUpdateAlert;
  const updateAlertWaiters = new Set<(alert: CustomSourceUpdateAlert | undefined) => void>();
  const init = new Promise<CustomSourceRuntimeInitResult>((resolve, reject) => {
    finishInit = resolve;
    failInit = reject;
  });

  const dispose = () => {
    if (controller.signal.aborted) return;
    controller.abort();
    parentOperation.signal.removeEventListener('abort', dispose);
    if (initTimer !== undefined) window.clearTimeout(initTimer);
    requestHandler = null;
    updateAlertListener = undefined;
    if (!initSettled) {
      initSettled = true;
      failInit(new CustomSourceDisabledError());
    }
  };
  parentOperation.signal.addEventListener('abort', dispose, { once: true });

  const lx = {
    EVENT_NAMES,
    request(url: string, options: any = {}, callback: (error: Error | null, response: unknown, body: unknown) => void) {
      return runHttpRequest(url, options, callback, operation, api.name, requests);
    },
    send(eventName: string, data?: unknown) {
      return new Promise<void>((resolve, reject) => {
        if (!operation.isActive()) { reject(new CustomSourceDisabledError()); return; }
        if (eventName === EVENT_NAMES.inited) {
          if (initSettled) {
            reject(new Error('Script is inited'));
            return;
          }
          initSettled = true;
          if (initTimer !== undefined) window.clearTimeout(initTimer);
          try {
            finishInit({ sources: normalizeCustomSourceInitSources(data), updateAlert });
            resolve();
          } catch (error) {
            failInit(error instanceof Error ? error : new Error(String(error)));
            reject(error);
          }
          return;
        }
        if (eventName === EVENT_NAMES.updateAlert) {
          const normalized = normalizeCustomSourceUpdateAlert(data);
          if (normalized && !updateAlertSeen) {
            updateAlertSeen = true;
            updateAlert = normalized;
            // 运行时上浮：仅当没有 waiter 在等时才回调消费方。test/check 流程通过
            // waitForUpdateAlert 消费同一事件并自行写 store，这里再回调会造成同一 alert 双份写入
            if (updateAlertWaiters.size === 0) updateAlertListener?.(normalized);
            for (const waiter of updateAlertWaiters) waiter(normalized);
            updateAlertWaiters.clear();
          }
          resolve();
          return;
        }
        reject(new Error(`The event is not supported: ${eventName}`));
      });
    },
    on(eventName: string, handler: (payload: CustomSourceRuntimeRequestPayload) => Promise<unknown>) {
      if (!operation.isActive()) return Promise.reject(new CustomSourceDisabledError());
      if (eventName !== EVENT_NAMES.request) return Promise.reject(new Error(`The event is not supported: ${eventName}`));
      requestHandler = handler;
      return Promise.resolve();
    },
    utils: createUtils(),
    currentScriptInfo: {
      name: api.name,
      description: api.description,
      version: api.version,
      author: api.author,
      homepage: api.homepage,
      rawScript: api.script,
    },
    version: '2.0.0',
    env: 'desktop',
  };

  // WebView 里没有 DOM 隔离，注入无原型对象承载 window / globalThis：
  // window.constructor 为 undefined，切断经属性链拿到 Function 构造器的逃逸路径。
  const fakeWindow = Object.create(null) as { lx: typeof lx };
  fakeWindow.lx = lx;
  const fakeGlobalThis = Object.create(null) as { lx: typeof lx };
  fakeGlobalThis.lx = lx;

  try {
    // 非沙箱：自定义音源脚本在本 WebView 内以完全权限执行，与用户主动安装的浏览器扩展
    // 同权。请勿放入不受信任的第三方脚本。
    //
    // 下方的参数遮蔽只为「脚本按预期通过注入的 lx 对象工作」提供便利，不构成安全边界：
    // 任意脚本都可用 ({})['cons'+'tructor']['cons'+'tructor']('return this')() 取回真实
    // globalThis，进而经 __TAURI_INTERNALS__ 直达 IPC，读取 load_settings 中的明文凭证。
    // 字符串拼接、Unicode 转义、async 函数的 constructor 等写法都无法用静态扫描穷尽，
    // 因此这里不做正则黑名单——它只能挡住朴素写法，却让人误以为存在隔离。
    //
    // 真正的隔离需要独立 WebView 或 Worker 且不暴露 IPC，属于架构变更，尚未实施。
    // LX 兼容音源脚本必须在运行时可执行，new Function 是这条路径的唯一实现；
    // 沙箱取舍已在上方注释中明确。
    // pi-lens-ignore: ts-function-constructor
    const runner = new Function(
      'lx',
      'window',
      'globalThis',
      'self',
      'top',
      'parent',
      'frames',
      'fetch',
      'WebSocket',
      'XMLHttpRequest',
      'document',
      'location',
      'navigator',
      'require',
      'process',
      'Buffer',
      // 严格模式：this 不再指向真实全局对象
      `"use strict";\n${api.script}`,
    );
    runner(
      lx,
      fakeWindow,
      fakeGlobalThis,
      fakeGlobalThis,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );
  } catch (error) {
    initSettled = true;
    failInit(error instanceof Error ? error : new Error(String(error)));
  }

  if (!initSettled) initTimer = window.setTimeout(() => {
    if (!initSettled) {
      initSettled = true;
      failInit(new Error('自定义音源初始化超时，脚本没有调用 lx.send(lx.EVENT_NAMES.inited, ...)'));
    }
  }, CUSTOM_SOURCE_INIT_TIMEOUT_MS);

  return {
    operation,
    dispose,
    drain: async () => { await Promise.all([...requests]); },
    hasPendingRequests: () => requests.size > 0,
    init,
    getUpdateAlert() {
      return updateAlert;
    },
    waitForUpdateAlert(timeoutMs) {
      operation.assertActive();
      if (updateAlert) return Promise.resolve(updateAlert);
      const pending = new Promise<CustomSourceUpdateAlert | undefined>((resolve) => {
        let settled = false;
        const finish = (alert: CustomSourceUpdateAlert | undefined) => {
          if (settled) return;
          settled = true;
          updateAlertWaiters.delete(finish);
          operation.signal.removeEventListener('abort', onAbort);
          window.clearTimeout(timer);
          resolve(alert);
        };
        const onAbort = () => finish(undefined);
        const timer = window.setTimeout(() => finish(undefined), Math.max(0, timeoutMs));
        updateAlertWaiters.add(finish);
        operation.signal.addEventListener('abort', onAbort, { once: true });
      });
      return awaitCustomSourceOperation(operation, pending);
    },
    setUpdateAlertListener(listener) {
      updateAlertListener = listener;
    },
    async request(data) {
      await awaitCustomSourceOperation(operation, init);
      if (!requestHandler) throw new Error('Request event is not defined');
      const response = await awaitCustomSourceOperation(operation, requestHandler({ source: data.source, action: data.action, info: data.info }));
      return toCustomSourceRuntimeRequestResult(data, response);
    },
  };
}

// ─── Runtime 缓存 ────────────────────────────────────────────
// 按 api.id + api.script 的 hash 缓存已初始化的 RuntimeInstance，避免每次播放
// 都重新执行脚本（createRuntime 内含 new Function + 网络初始化，耗时且有超时风险）。

const runtimeCache = new Map<string, RuntimeInstance[]>();
const busyRuntimes = new Set<RuntimeInstance>();
const runtimeScheduler = createPlaybackRequestScheduler();

/** Fast non-crypto hash so script body changes always bust the runtime cache. */
function hashScript(script: string): string {
  // djb2a — good enough for cache keys, cheap for multi-KB source scripts
  let h = 5381;
  for (let i = 0; i < script.length; i++) {
    h = ((h << 5) + h) ^ script.charCodeAt(i);
    h |= 0; // force 32-bit
  }
  // include length to reduce chance of pure-hash collision across edits
  return `${script.length.toString(36)}_${(h >>> 0).toString(36)}`;
}

function getCacheKey(api: CustomSourceItem): string {
  // script 任意位置变化都应让缓存失效（旧实现只看前 64 字符，易撞）
  return `${api.id}::${hashScript(api.script)}`;
}

function removeRuntime(runtime: RuntimeInstance): void {
  for (const [key, entries] of runtimeCache) {
    const remaining = entries.filter(entry => entry !== runtime);
    if (remaining.length) runtimeCache.set(key, remaining);
    else runtimeCache.delete(key);
  }
  runtime.dispose();
}

function trimRuntimeCache(): void {
  const idle = [...runtimeCache.values()].flat().filter(runtime => !busyRuntimes.has(runtime));
  for (const runtime of idle.slice(0, Math.max(0, idle.length - MAX_INFLIGHT_CUSTOM_SOURCE_REQUESTS))) removeRuntime(runtime);
}

/** 每个运行时独占一次取链，异步 lx.request 不依赖跨请求的全局 owner。 */
function getCachedRuntime(api: CustomSourceItem, operation: CustomSourceOperation, onUpdateAlert?: UpdateAlertListener): RuntimeInstance {
  operation.assertActive();
  const key = getCacheKey(api);
  const entries = runtimeCache.get(key) ?? [];
  const cached = entries.find(runtime => runtime.operation.isActive() && !busyRuntimes.has(runtime));
  if (cached) {
    if (onUpdateAlert) cached.setUpdateAlertListener(onUpdateAlert);
    busyRuntimes.add(cached);
    return cached;
  }
  const runtime = createRuntime(api, operation, { onUpdateAlert });
  busyRuntimes.add(runtime);
  runtimeCache.set(key, [...entries, runtime]);
  void runtime.init.catch(() => removeRuntime(runtime));
  return runtime;
}

export function invalidateRuntimeCache(apiId: string): void {
  for (const [key, entries] of [...runtimeCache]) {
    if (key.startsWith(`${apiId}::`)) for (const runtime of entries) removeRuntime(runtime);
  }
}

export function invalidateAllRuntimeCaches(): void {
  for (const runtime of [...runtimeCache.values()].flat()) runtime.dispose();
  runtimeCache.clear();
}

function primeRuntimeCache(api: CustomSourceItem, runtime: RuntimeInstance): void {
  runtime.operation.assertActive();
  const key = getCacheKey(api);
  runtimeCache.set(key, [...(runtimeCache.get(key) ?? []), runtime]);
  trimRuntimeCache();
}

export async function testCustomSource(api: CustomSourceItem, operation: CustomSourceOperation, updateAlertWaitMs = CUSTOM_SOURCE_TEST_UPDATE_ALERT_WAIT_MS): Promise<CustomSourceRuntimeInitResult> {
  operation.assertActive();
  // 测试/更新检查使用独立的 runtime，不能动播放缓存里的实例：
  // 之前这里的 invalidateRuntimeCache 会在后台检查时中断正在进行的播放解析。
  const runtime = createRuntime(api, operation);
  try {
    const result = await awaitCustomSourceOperation(operation, runtime.init);
    const updateAlert = result.updateAlert ?? await runtime.waitForUpdateAlert(updateAlertWaitMs);
    operation.assertActive();
    return { ...result, updateAlert };
  } finally {
    runtime.dispose();
  }
}

// ─── 深度测试：真实取链 ────────────────────────────────────────
// 测哪些平台、预算怎么分、结果怎么汇总在 @lx/core 的 deep-test 里；这里负责脚本的
// 启动与释放、运行时缓存的去留，并把取消令牌接进每一步。

export async function testCustomSourceDeep(api: CustomSourceItem, operation: CustomSourceOperation, updateAlertWaitMs = CUSTOM_SOURCE_TEST_UPDATE_ALERT_WAIT_MS): Promise<CustomSourceDeepTestResult> {
  operation.assertActive();
  // 阶段一：复用现有 init 流程；同样不碰播放缓存里的 runtime。
  const runtime = createRuntime(api, operation);
  let initResult: CustomSourceRuntimeInitResult;
  try {
    initResult = await awaitCustomSourceOperation(operation, runtime.init);
    initResult = { ...initResult, updateAlert: initResult.updateAlert ?? await runtime.waitForUpdateAlert(updateAlertWaitMs) };
  } catch (error) {
    runtime.dispose();
    operation.assertActive();
    return buildCustomSourceDeepTestInitFailure(error);
  }

  // 阶段二：脚本声明了哪些平台就逐个测哪些（wy/tx/kw/kg），不再只测 wy。
  const plan = planCustomSourceDeepTest(initResult);
  if (plan.verdict) {
    runtime.dispose();
    operation.assertActive();
    return plan.verdict;
  }

  // 深度测试重建的 Runtime 复用缓存，取链走现有 requestCustomSourceMusicUrl
  primeRuntimeCache(api, runtime);
  const { passed, result } = await runCustomSourceDeepTestPlatforms(initResult, plan.platforms, {
    searchers: hiddenSourceSearchers,
    withTimeout,
    requestMusicUrl: (target, quality) =>
      requestCustomSourceMusicUrl(api, target.music, quality, operation, undefined, target.platformRequest),
    // 生命周期失效要抛出，而不是伪装成「测试失败」。
    assertActive: () => operation.assertActive(),
  });
  // 全部平台都失败时才丢弃这个 runtime；有任一平台通过就保留，避免下次播放重新初始化。
  // 必须走 invalidateRuntimeCache：只 dispose 会留下缓存里的已释放实例，
  // 之后命中缓存时 request() 立即失败，该音源在本会话内不可用。
  if (passed === 0) invalidateRuntimeCache(api.id);
  return result;
}

export async function checkCustomSourceUpdate(api: CustomSourceItem, operation: CustomSourceOperation): Promise<CustomSourceRuntimeInitResult> {
  operation.assertActive();
  const result = await testCustomSource(api, operation, CUSTOM_SOURCE_CHECK_UPDATE_ALERT_WAIT_MS);
  if (result.updateAlert) return result;
  const remoteAlert = await checkCustomSourceRemoteUpdate(
    api,
    (url) => awaitCustomSourceOperation(operation, fetchRemoteScript(url, operation)),
  );
  operation.assertActive();
  return { ...result, updateAlert: remoteAlert };
}

export async function requestCustomSourceMusicUrl(
  api: CustomSourceItem,
  music: MusicInfo,
  quality: string,
  operation: CustomSourceOperation,
  onUpdateAlert?: UpdateAlertListener,
  platformRequest?: CustomSourcePlatformRequest,
  signal?: AbortSignal,
): Promise<{ url: string; quality: string; sources?: Record<string, CustomSourceSourceInfo> }> {
  operation.assertActive();
  return runtimeScheduler.run(async requestSignal => {
    operation.assertActive();
    const runtime = getCachedRuntime(api, operation, onUpdateAlert);
    const abort = () => removeRuntime(runtime);
    requestSignal.addEventListener('abort', abort, { once: true });
    try {
      throwIfAborted(requestSignal);
      const initResult = await waitWithSignal(awaitCustomSourceOperation(operation, runtime.init), requestSignal);
      const result = await waitWithSignal(runtime.request(
        buildCustomSourceMusicUrlRequest(initResult.sources, music, quality, platformRequest),
      ), requestSignal);
      operation.assertActive();
      throwIfAborted(requestSignal);
      return { ...readCustomSourceMusicUrlResult(result, quality), sources: initResult.sources };
    } catch (error) {
      throwIfAborted(requestSignal);
      throw error;
    } finally {
      requestSignal.removeEventListener('abort', abort);
      // 尚有初始化或取链 HTTP 的实例不能回到空闲池，避免下一位继承旧请求。
      if (runtime.hasPendingRequests()) removeRuntime(runtime);
      if (requestSignal.aborted) {
        removeRuntime(runtime);
        await runtime.drain();
      }
      busyRuntimes.delete(runtime);
      trimRuntimeCache();
    }
  }, signal);
}
