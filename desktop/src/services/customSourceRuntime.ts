import CryptoJS from 'crypto-js';
import forge from 'node-forge';
import {
  compareCustomSourceVersions,
  isLikelyCustomSourceRemoteUrl,
  matchHiddenCandidates,
  normalizeCustomSourceRemoteUrl,
  normalizeCustomSourceScript,
  normalizeCustomSourceVersion,
  type MusicInfo,
} from '@lx/core';
import type { CustomSourceItem, CustomSourceSourceInfo } from '@/stores/customSourceStore';
import { outboundRequest } from '@/services/outboundHttp';
import { hiddenSourceSearchers } from '@/services/sources/hidden/hiddenSearchers';
import { awaitCustomSourceOperation, CustomSourceDisabledError, type CustomSourceOperation } from '@/services/customSourceAccess';
import { deflateBytes, inflateBytes, zlibFormatFromOptions } from '@/utils/compression';

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
  operation: CustomSourceOperation;
  dispose: () => void;
  init: Promise<RuntimeInitResult>;
  request: (data: RuntimeRequestPayload) => Promise<RuntimeRequestResult>;
  getUpdateAlert: () => CustomSourceUpdateAlert | undefined;
  waitForUpdateAlert: (timeoutMs: number) => Promise<CustomSourceUpdateAlert | undefined>;
  /** 消费方随时可更新监听器，命中缓存的旧 Runtime 也能接上运行时上浮 */
  setUpdateAlertListener: (listener?: UpdateAlertListener) => void;
}

interface RuntimeRequestPayload {
  source: string;
  action: 'musicUrl' | 'lyric' | 'pic';
  info: Record<string, unknown>;
}

/** 运行时收到合法 updateAlert 且无 waiter 等待时回调（由消费方注入，用于写 store 上浮全局更新弹窗） */
type UpdateAlertListener = (alert: CustomSourceUpdateAlert) => void;

interface CreateRuntimeOptions {
  onUpdateAlert?: UpdateAlertListener;
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
  if (key === 'version') {
    const version = trimmed.match(/v?\d+(?:\.\d+){1,3}(?:[-+][\w.-]+)?/)?.[0];
    if (version) return version;
  }
  const limit = INFO_LIMITS[key];
  return trimmed.length > limit ? `${trimmed.slice(0, limit)}...` : trimmed;
}

const EVENT_NAMES = {
  request: 'request',
  inited: 'inited',
  updateAlert: 'updateAlert',
} as const;

const INIT_TIMEOUT_MS = 30_000;
const TEST_UPDATE_ALERT_WAIT_MS = 800;
const CHECK_UPDATE_ALERT_WAIT_MS = 5_000;

const ALL_SOURCES = ['kg', 'kw', 'tx', 'wy', 'local'];
const SUPPORT_QUALITIES: Record<string, string[]> = {
  kg: ['128k', '320k', 'flac', 'flac24bit'],
  kw: ['128k', '320k', 'flac', 'flac24bit'],
  tx: ['128k', '320k', 'flac', 'flac24bit'],
  wy: ['128k', '320k', 'flac', 'flac24bit'],
  local: [],
};
const SUPPORT_ACTIONS: Record<string, string[]> = {
  kg: ['musicUrl'],
  kw: ['musicUrl'],
  tx: ['musicUrl'],
  wy: ['musicUrl'],
  local: ['musicUrl', 'lyric', 'pic'],
};

export function parseDesktopUserApiInfo(script: string): DesktopUserApiHeaderInfo {
  const block = /^\/\*[\s\S]+?\*\//.exec(script)?.[0];
  if (!block) throw new Error('无效的自定义源文件：缺少 LX Music 头部注释');

  const result: DesktopUserApiHeaderInfo = {
    name: '',
    description: '',
    author: '',
    homepage: '',
    version: '',
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
    if (!userSource || userSource.type !== 'music') continue;
    sources[source] = {
      type: 'music',
      actions: SUPPORT_ACTIONS[source].filter((action) => userSource.actions?.includes(action)),
      qualitys: SUPPORT_QUALITIES[source].filter((quality) => userSource.qualitys?.includes(quality)),
    };
  }
  return sources;
}

function normalizeUpdateAlert(data: unknown): CustomSourceUpdateAlert | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const input = data as { log?: unknown; updateUrl?: unknown };
  if (typeof input.log !== 'string' || !input.log.trim()) return undefined;

  const updateUrl = typeof input.updateUrl === 'string' && /^https?:\/\//.test(input.updateUrl) && input.updateUrl.length <= 1024
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

async function fetchRemoteScript(url: string, operation: CustomSourceOperation): Promise<string> {
  operation.assertActive();
  const response = await outboundRequest(url, {
    method: 'GET',
    headers: {
      Accept: 'text/plain,application/javascript,*/*',
    },
  });
  if (!response.ok) {
    throw new Error(`远端音源请求失败: HTTP ${response.status} ${response.statusText}`);
  }
  const text = await response.text();
  if (!text.trim()) throw new Error('远端音源脚本为空');
  return text;
}

export async function checkCustomSourceRemoteUpdate(api: CustomSourceItem, operation: CustomSourceOperation): Promise<CustomSourceUpdateAlert | undefined> {
  const updateUrl = getRemoteScriptUrl(api);
  if (!updateUrl) return undefined;

  operation.assertActive();
  const remoteScript = await awaitCustomSourceOperation(operation, fetchRemoteScript(updateUrl, operation));
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
        ? `远端脚本内容已更新，当前版本 v${localVersion || '未知'}，远端版本 v${remoteVersion}`
        : '远端脚本内容已更新',
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
    albumId: extra?.albumId ?? tx?.albumMid ?? '',
    albumMid: extra?.albumMid ?? extra?.albumId ?? tx?.albumMid ?? '',
    strMediaMid: tx?.strMediaMid ?? '',
    img: platformRequest?.picUrl ?? music.picUrl ?? music.img ?? '',
    types: [],
    _types: {},
    typeUrl: {},
  };
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

function runHttpRequest(
  url: string,
  options: HttpRequestOptions,
  callback: (error: Error | null, response: unknown, body: unknown) => void,
  operation: CustomSourceOperation,
  sourceName: string,
): () => void {
  operation.assertActive();
  // 脚本调用 lx.request 时漏传回调：异步 IIFE 会在错误分支里以 TypeError 结束，
  // 变成一条无法归因的未处理拒绝。这里提前放弃并留下来源，不伪造成功响应。
  if (typeof callback !== 'function') {
    console.warn(`[自定义音源: ${sourceName}] lx.request 缺少回调`, url);
    return () => {};
  }
  // 出站校验（含 SSRF 与重定向逐跳）在 Rust 侧 outbound.rs 统一完成，这里不再重复判定。
  // 代价：请求发出后无法真正中止，cancel 只丢弃回调。
  let cancelled = false;
  const timeoutMs = typeof options.timeout === 'number' && options.timeout > 0 ? Math.min(options.timeout, 60_000) : 60_000;
  // 脚本回调自己抛错时不能再走一次 callback —— 那会把回调错误变成新的未处理拒绝。
  const deliver = (error: Error | null, response: unknown, body: unknown) => {
    try {
      callback(error, response, body);
    } catch (callbackError) {
      console.warn(`[自定义音源: ${sourceName}] lx.request 回调抛错`, callbackError);
    }
  };

  void (async () => {
    try {
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
        method: options.method ?? 'GET',
        headers: options.headers,
        body,
        timeoutMs,
        // 二进制响应必须让 Rust 侧回 base64：按 UTF-8 lossy 转文本会把字节改掉
        responseType: binary ? 'base64' : 'text',
      });
      if (cancelled || !operation.isActive()) return;
      if (binary) {
        // 脚本按 Buffer 使用（length / 下标 / utils.buffer.bufToString），Uint8Array 都满足
        const bytes = toBytes(response.base64(), 'base64');
        deliver(null, createRequestResponse(bytes, response.status, response.statusText, response.headers), bytes);
        return;
      }
      const text = await response.text();
      if (cancelled || !operation.isActive()) return;
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
      deliver(null, createRequestResponse(parsed, response.status, response.statusText, response.headers), parsed);
    } catch (error) {
      if (cancelled || !operation.isActive()) return;
      deliver(tagCustomSourceError(error, sourceName), null, null);
    }
  })();

  return () => {
    cancelled = true;
  };
}

function createRuntime(api: CustomSourceItem, parentOperation: CustomSourceOperation, options?: CreateRuntimeOptions): RuntimeInstance {
  parentOperation.assertActive();
  const controller = new AbortController();
  const operation: CustomSourceOperation = {
    signal: controller.signal,
    isActive: () => !controller.signal.aborted && parentOperation.isActive(),
    assertActive: () => {
      if (controller.signal.aborted) throw new CustomSourceDisabledError();
      parentOperation.assertActive();
    },
  };
  let initTimer: number | undefined;
  let requestHandler: ((payload: RuntimeRequestPayload) => Promise<unknown>) | null = null;
  let finishInit: (value: RuntimeInitResult) => void = () => undefined;
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
  const init = new Promise<RuntimeInitResult>((resolve, reject) => {
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
      return runHttpRequest(url, options, callback, operation, api.name);
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
            finishInit({ sources: normalizeInitSources(data), updateAlert });
            resolve();
          } catch (error) {
            failInit(error instanceof Error ? error : new Error(String(error)));
            reject(error);
          }
          return;
        }
        if (eventName === EVENT_NAMES.updateAlert) {
          const normalized = normalizeUpdateAlert(data);
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
    on(eventName: string, handler: (payload: RuntimeRequestPayload) => Promise<unknown>) {
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
  }, INIT_TIMEOUT_MS);

  return {
    operation,
    dispose,
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
      if (data.action === 'musicUrl') {
        if (typeof response !== 'string' || response.length > 2048 || !/^https?:/.test(response)) {
          throw new Error('自定义音源没有返回可播放 URL');
        }
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
  };
}

// ─── Runtime 缓存 ────────────────────────────────────────────
// 按 api.id + api.script 的 hash 缓存已初始化的 RuntimeInstance，避免每次播放
// 都重新执行脚本（createRuntime 内含 new Function + 网络初始化，耗时且有超时风险）。

const RUNTIME_CACHE_MAX = 8;
const runtimeCache = new Map<string, RuntimeInstance>();

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

function getCachedRuntime(api: CustomSourceItem, operation: CustomSourceOperation, onUpdateAlert?: UpdateAlertListener): RuntimeInstance {
  operation.assertActive();
  const key = getCacheKey(api);
  const cached = runtimeCache.get(key);
  if (cached?.operation.isActive()) {
    // 命中缓存也接上本次传入的监听器：深度测试 prime 进来的 Runtime 没有监听器，
    // 后续取链期间的运行时 updateAlert 才不会继续被丢弃
    if (onUpdateAlert) cached.setUpdateAlertListener(onUpdateAlert);
    // 命中后移到末尾：Map 的插入序就是淘汰序，不刷新的话超过 8 个音源时
    // 常用的会被冷门音源挤掉，导致反复重新执行脚本（new Function + 网络初始化）
    runtimeCache.delete(key);
    runtimeCache.set(key, cached);
    return cached;
  }
  if (runtimeCache.size >= RUNTIME_CACHE_MAX) {
    const oldest = runtimeCache.keys().next().value;
    if (oldest !== undefined) {
      // 淘汰的是仍在运行的脚本：只删 Map 会留下监听器、定时器和在途请求。
      runtimeCache.get(oldest)?.dispose();
      runtimeCache.delete(oldest);
    }
  }
  cached?.dispose();
  const runtime = createRuntime(api, operation, { onUpdateAlert });
  runtimeCache.set(key, runtime);
  // 初始化失败时从缓存中移除，下次重试
  runtime.init.catch(() => {
    if (runtimeCache.get(key) === runtime) runtimeCache.delete(key);
    runtime.dispose();
  });
  return runtime;
}

/** 清除某个音源的 Runtime 缓存（重新导入脚本时调用） */
export function invalidateRuntimeCache(apiId: string): void {
  for (const key of runtimeCache.keys()) {
    if (key.startsWith(`${apiId}::`)) {
      runtimeCache.get(key)?.dispose();
      runtimeCache.delete(key);
    }
  }
}

/** 释放应用管理的运行时；不承诺终止脚本逃逸后创建的任意副作用。 */
export function invalidateAllRuntimeCaches(): void {
  for (const runtime of runtimeCache.values()) runtime.dispose();
  runtimeCache.clear();
}

/** 把已初始化的 Runtime 放回缓存（深度测试复用，避免重复执行脚本） */
function primeRuntimeCache(api: CustomSourceItem, runtime: RuntimeInstance): void {
  runtime.operation.assertActive();
  const key = getCacheKey(api);
  if (runtimeCache.size >= RUNTIME_CACHE_MAX) {
    const oldest = runtimeCache.keys().next().value;
    if (oldest !== undefined) {
      // 淘汰的是仍在运行的脚本：只删 Map 会留下监听器、定时器和在途请求。
      runtimeCache.get(oldest)?.dispose();
      runtimeCache.delete(oldest);
    }
  }
  // 同一 key 已有运行时：优先保留正在使用的那个（可能在播放），不要用测试实例覆盖它。
  const existing = runtimeCache.get(key);
  if (existing && existing !== runtime) {
    if (existing.operation.isActive()) {
      runtime.dispose();
      return;
    }
    existing.dispose();
  }
  runtimeCache.set(key, runtime);
}

export async function testCustomSource(api: CustomSourceItem, operation: CustomSourceOperation, updateAlertWaitMs = TEST_UPDATE_ALERT_WAIT_MS): Promise<RuntimeInitResult> {
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
// 初始化通过不代表脚本真的能取到播放地址（假阳性），这里用内置固定测试曲走一次真实
// musicUrl 请求验证端到端可用性。超时 20s，与现有播放解析预期对齐。

const DEEP_TEST_TIMEOUT_MS = 20_000;
const DEEP_TEST_SEARCH_TIMEOUT_MS = 6_000;
const DEEP_TEST_PLATFORM_BUDGET_MS = 25_000;
const DEEP_TEST_MIN_PLATFORM_BUDGET_MS = 5_000;
const DEEP_TEST_TOTAL_BUDGET_MS = 60_000;
const DEEP_TEST_QUALITY = '128k';

/** 内置固定测试曲（id 均为公开常驻曲目，可按需替换）：
 *  - wy：2034742057 林俊杰-江南（备选 1492167768）
 *  - tx：songmid 0039MnYb0qxYhV
 *  - kw/kg：用隐藏音源搜索按名找同曲，不依赖固定 id
 */
const DEEP_TEST_TRACKS: Record<'wy' | 'tx', { id: string; name: string; singer: string; albumName: string }> = {
  wy: { id: '2034742057', name: '江南', singer: '林俊杰', albumName: '第二天堂' },
  tx: { id: '0039MnYb0qxYhV', name: '江南', singer: '林俊杰', albumName: '第二天堂' },
};

/** 深度测试固定曲目：与固定 wy/tx 曲目同一首歌，用于按平台搜索。 */
const DEEP_TEST_SONG = { name: '江南', singer: '林俊杰', albumName: '第二天堂', interval: 267 };

/** 脚本声明了 musicUrl 的平台逐个测试；不在这里枚举的平台不参与。 */
const DEEP_TEST_PLATFORMS = ['wy', 'tx', 'kw', 'kg'] as const;
type DeepTestPlatform = (typeof DEEP_TEST_PLATFORMS)[number];

interface DeepTestTarget {
  platform: DeepTestPlatform;
  music: MusicInfo;
  platformRequest?: CustomSourcePlatformRequest;
}

function compactTestDetail(value: string): string {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed.length > 160 ? `${trimmed.slice(0, 160)}...` : trimmed;
}

/** 为平台准备测试曲：wy/tx 用固定 id；kw/kg 先原生搜索同曲，再取平台元数据。 */
async function buildDeepTestTarget(
  platform: DeepTestPlatform,
  searchTimeoutMs = DEEP_TEST_SEARCH_TIMEOUT_MS,
): Promise<DeepTestTarget> {
  if (platform === 'wy' || platform === 'tx') {
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
  if (!searcher) throw new Error('该平台没有可用的搜索实现');
  const tracks = await withTimeout(
    searcher.search(`${DEEP_TEST_SONG.name} ${DEEP_TEST_SONG.singer}`),
    searchTimeoutMs,
    `搜索测试曲目超时（超过 ${Math.round(searchTimeoutMs / 1000)}s）`,
  );
  const track = matchHiddenCandidates(DEEP_TEST_SONG, tracks)[0];
  if (!track) throw new Error('未在平台搜到匹配的测试曲目');

  return {
    platform,
    // MusicInfo.source 是 UI 来源，这里只是占位；真正的平台来源由 platformRequest 透传。
    music: {
      id: track.id,
      name: track.name,
      singer: track.singer,
      albumName: track.albumName ?? DEEP_TEST_SONG.albumName,
      source: 'tx',
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

export async function testCustomSourceDeep(api: CustomSourceItem, operation: CustomSourceOperation, updateAlertWaitMs = TEST_UPDATE_ALERT_WAIT_MS): Promise<DeepTestResult> {
  operation.assertActive();
  // 阶段一：复用现有 init 流程；同样不碰播放缓存里的 runtime。
  const runtime = createRuntime(api, operation);
  let initResult: RuntimeInitResult;
  try {
    initResult = await awaitCustomSourceOperation(operation, runtime.init);
    initResult = { ...initResult, updateAlert: initResult.updateAlert ?? await runtime.waitForUpdateAlert(updateAlertWaitMs) };
  } catch (error) {
    runtime.dispose();
    operation.assertActive();
    return { ok: false, message: `初始化失败：${error instanceof Error ? error.message : String(error)}`, sources: undefined, updateAlert: undefined };
  }

  // 阶段二：脚本声明了哪些平台就逐个测哪些（wy/tx/kw/kg），不再只测 wy。
  const sources = initResult.sources ?? {};
  const declaredPlatforms = Object.keys(sources).filter((id) => sources[id]?.actions.includes('musicUrl'));
  if (declaredPlatforms.length === 0) {
    runtime.dispose();
    operation.assertActive();
    return { ok: true, message: '初始化正常；未声明 musicUrl，仅验证初始化', sources, updateAlert: initResult.updateAlert };
  }
  const platforms = DEEP_TEST_PLATFORMS.filter((name) => declaredPlatforms.includes(name));
  if (platforms.length === 0) {
    runtime.dispose();
    operation.assertActive();
    return {
      ok: false,
      message: `初始化正常；脚本只声明了 ${declaredPlatforms.join('/')}，当前深度测试仅覆盖 wy/tx/kw/kg`,
      sources,
      updateAlert: initResult.updateAlert,
    };
  }

  // 深度测试重建的 Runtime 复用缓存，取链走现有 requestCustomSourceMusicUrl
  primeRuntimeCache(api, runtime);
  const startedAt = Date.now();
  const results: Array<{ platform: DeepTestPlatform; ok: boolean; detail: string }> = [];

  for (let index = 0; index < platforms.length; index += 1) {
    const platform = platforms[index];
    const remaining = DEEP_TEST_TOTAL_BUDGET_MS - (Date.now() - startedAt);
    if (remaining <= 0) {
      results.push({ platform, ok: false, detail: '未测试（总预算耗尽）' });
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
      operation.assertActive();
    } catch (error) {
      operation.assertActive();
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
      if (chainBudget <= 0) throw new Error('总预算耗尽');
      const result = await withTimeout(
        requestCustomSourceMusicUrl(api, target.music, quality, operation, undefined, target.platformRequest),
        chainBudget,
        `取链测试超时（超过 ${Math.round(chainBudget / 1000)}s 未返回播放地址）`,
      );
      operation.assertActive();
      if (!/^https?:\/\//.test(result.url)) throw new Error(`未返回可播放 URL：${result.url.slice(0, 128)}`);
      results.push({ platform, ok: true, detail: `${result.quality || quality}` });
    } catch (error) {
      // 生命周期失效要抛出，而不是伪装成「测试失败」。
      operation.assertActive();
      results.push({
        platform,
        ok: false,
        detail: `取链失败：${compactTestDetail(error instanceof Error ? error.message : String(error))}`,
      });
    }
  }

  operation.assertActive();
  const passed = results.filter((item) => item.ok).length;
  const ok = passed === results.length;
  // 全部平台都失败时才丢弃这个 runtime；有任一平台通过就保留，避免下次播放重新初始化。
  // 必须走 invalidateRuntimeCache：只 dispose 会留下缓存里的已释放实例，
  // 之后命中缓存时 request() 立即失败，该音源在本会话内不可用。
  if (passed === 0) invalidateRuntimeCache(api.id);

  const summary = results
    .map((item) => `${item.platform} ${item.ok ? '通过' : '失败'}:${item.detail}`)
    .join('；');
  return {
    ok,
    message: `初始化正常；取链测试 ${passed}/${results.length} 通过（${summary}）`,
    sources: initResult.sources ?? sources,
    updateAlert: initResult.updateAlert,
  };
}

export async function checkCustomSourceUpdate(api: CustomSourceItem, operation: CustomSourceOperation): Promise<RuntimeInitResult> {
  operation.assertActive();
  const result = await testCustomSource(api, operation, CHECK_UPDATE_ALERT_WAIT_MS);
  if (result.updateAlert) return result;
  const remoteAlert = await checkCustomSourceRemoteUpdate(api, operation);
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
): Promise<{ url: string; quality: string; sources?: Record<string, CustomSourceSourceInfo> }> {
  operation.assertActive();
  const runtime = getCachedRuntime(api, operation, onUpdateAlert);
  const initResult = await awaitCustomSourceOperation(operation, runtime.init);
  const sourceId = platformRequest?.source ?? music.source;
  const sourceInfo = initResult.sources?.[sourceId];
  if (!sourceInfo?.actions.includes('musicUrl')) throw new Error(`音源不支持 ${sourceId} 的播放链接解析`);
  if (sourceInfo.qualitys.length && !sourceInfo.qualitys.includes(quality)) throw new Error(`音源不支持 ${quality} 音质`);

  const result = await runtime.request({
    source: sourceId,
    action: 'musicUrl',
    info: {
      type: quality,
      musicInfo: toOldMusicInfo(music, platformRequest),
    },
  });
  operation.assertActive();
  const data = result.data as { url?: string; type?: string };
  if (!data.url) throw new Error('自定义音源没有返回可播放 URL');
  return { url: data.url, quality: data.type || quality, sources: initResult.sources };
}
