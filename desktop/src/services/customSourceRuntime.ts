import CryptoJS from 'crypto-js';
import forge from 'node-forge';
import {
  compareCustomSourceVersions,
  isLikelyCustomSourceRemoteUrl,
  normalizeCustomSourceRemoteUrl,
  normalizeCustomSourceScript,
  normalizeCustomSourceVersion,
  type MusicInfo,
} from '@lx/core';
import type { CustomSourceItem, CustomSourceSourceInfo } from '@/stores/customSourceStore';
import { outboundRequest } from '@/services/outboundHttp';
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

const ALL_SOURCES = ['kg', 'tx', 'wy', 'local'];
const SUPPORT_QUALITIES: Record<string, string[]> = {
  kg: ['128k', '320k', 'flac', 'flac24bit'],
  tx: ['128k', '320k', 'flac', 'flac24bit'],
  wy: ['128k', '320k', 'flac', 'flac24bit'],
  local: [],
};
const SUPPORT_ACTIONS: Record<string, string[]> = {
  kg: ['musicUrl'],
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

async function fetchRemoteScript(url: string): Promise<string> {
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

export async function checkCustomSourceRemoteUpdate(api: CustomSourceItem): Promise<CustomSourceUpdateAlert | undefined> {
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
        ? `远端脚本内容已更新，当前版本 v${localVersion || '未知'}，远端版本 v${remoteVersion}`
        : '远端脚本内容已更新',
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
    albumId: tx?.albumMid ?? '',
    albumMid: tx?.albumMid ?? '',
    strMediaMid: tx?.strMediaMid ?? '',
    img: music.picUrl ?? music.img ?? '',
    types: [],
    _types: {},
    typeUrl: {},
  };
}

function createRequestResponse(rawBody: unknown, status: number, statusText: string, headers: Record<string, string>) {
  return {
    statusCode: status,
    statusMessage: statusText,
    headers: { ...headers },
    bytes: 0,
    raw: typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody),
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

function runHttpRequest(
  url: string,
  options: { method?: string; timeout?: number; headers?: Record<string, string>; body?: unknown; form?: Record<string, string>; formData?: Record<string, string> },
  callback: (error: Error | null, response: unknown, body: unknown) => void,
): () => void {
  // 出站校验（含 SSRF 与重定向逐跳）在 Rust 侧 outbound.rs 统一完成，这里不再重复判定。
  // 代价：请求发出后无法真正中止，cancel 只丢弃回调。
  let cancelled = false;
  const timeoutMs = typeof options.timeout === 'number' && options.timeout > 0 ? Math.min(options.timeout, 60_000) : 60_000;

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

      const response = await outboundRequest(url, {
        method: options.method ?? 'GET',
        headers: options.headers,
        body,
        timeoutMs,
      });
      if (cancelled) return;
      const text = await response.text();
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
      callback(null, createRequestResponse(parsed, response.status, response.statusText, response.headers), parsed);
    } catch (error) {
      if (cancelled) return;
      callback(error instanceof Error ? error : new Error(String(error)), null, null);
    }
  })();

  return () => {
    cancelled = true;
  };
}

function createRuntime(api: CustomSourceItem, options?: CreateRuntimeOptions): RuntimeInstance {
  let requestHandler: ((payload: RuntimeRequestPayload) => Promise<unknown>) | null = null;
  let finishInit: (value: RuntimeInitResult) => void = () => undefined;
  let failInit: (error: Error) => void = () => undefined;
  let initSettled = false;
  let updateAlert: CustomSourceUpdateAlert | undefined;
  let updateAlertListener: UpdateAlertListener | undefined = options?.onUpdateAlert;
  const updateAlertWaiters = new Set<(alert: CustomSourceUpdateAlert | undefined) => void>();
  const init = new Promise<RuntimeInitResult>((resolve, reject) => {
    finishInit = resolve;
    failInit = reject;
  });

  const lx = {
    EVENT_NAMES,
    request(url: string, options: any = {}, callback: (error: Error | null, response: unknown, body: unknown) => void) {
      return runHttpRequest(url, options, callback);
    },
    send(eventName: string, data?: unknown) {
      return new Promise<void>((resolve, reject) => {
        if (eventName === EVENT_NAMES.inited) {
          if (initSettled) {
            reject(new Error('Script is inited'));
            return;
          }
          initSettled = true;
          try {
            finishInit({ sources: normalizeInitSources(data), updateAlert });
            resolve();
          } catch (error) {
            reject(error);
          }
          return;
        }
        if (eventName === EVENT_NAMES.updateAlert) {
          const normalized = normalizeUpdateAlert(data);
          if (normalized) {
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
    // L1 沙箱（尽力而为，非强隔离）：自定义音源脚本与用户主动安装的浏览器扩展同权，
    // 请勿放入不受信任的第三方脚本。以下为多层缓解：
    // 1. 静态扫描拒绝明显的动态代码执行手法（constructor 链 / eval / Function）；
    // 2. 以严格模式执行，函数体内 this 为 undefined，`this.__TAURI_INTERNALS__` 这类
    //    经全局对象直达 IPC 的逃逸直接抛错；
    // 3. 注入的 window / globalThis 为无原型对象，constructor 属性链不可达；
    // 4. 遮蔽 self / top / parent 等同样指向真实全局对象的别名。
    if (/constructor\s*\.\s*constructor|\.constructor\s*\(|\beval\s*\(|\bFunction\s*\(/.test(api.script)) {
      throw new Error('自定义音源脚本包含不允许的动态代码执行');
    }
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

  window.setTimeout(() => {
    if (!initSettled) {
      initSettled = true;
      failInit(new Error('自定义音源初始化超时，脚本没有调用 lx.send(lx.EVENT_NAMES.inited, ...)'));
    }
  }, INIT_TIMEOUT_MS);

  return {
    init,
    getUpdateAlert() {
      return updateAlert;
    },
    waitForUpdateAlert(timeoutMs) {
      if (updateAlert) return Promise.resolve(updateAlert);
      return new Promise((resolve) => {
        let settled = false;
        const finish = (alert: CustomSourceUpdateAlert | undefined) => {
          if (settled) return;
          settled = true;
          updateAlertWaiters.delete(finish);
          window.clearTimeout(timer);
          resolve(alert);
        };
        const timer = window.setTimeout(() => finish(undefined), Math.max(0, timeoutMs));
        updateAlertWaiters.add(finish);
      });
    },
    setUpdateAlertListener(listener) {
      updateAlertListener = listener;
    },
    async request(data) {
      await init;
      if (!requestHandler) throw new Error('Request event is not defined');
      const response = await requestHandler({ source: data.source, action: data.action, info: data.info });
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

function getCachedRuntime(api: CustomSourceItem, onUpdateAlert?: UpdateAlertListener): RuntimeInstance {
  const key = getCacheKey(api);
  const cached = runtimeCache.get(key);
  if (cached) {
    // 命中缓存也接上本次传入的监听器：深度测试 prime 进来的 Runtime 没有监听器，
    // 后续取链期间的运行时 updateAlert 才不会继续被丢弃
    if (onUpdateAlert) cached.setUpdateAlertListener(onUpdateAlert);
    return cached;
  }
  if (runtimeCache.size >= RUNTIME_CACHE_MAX) {
    const oldest = runtimeCache.keys().next().value;
    if (oldest !== undefined) runtimeCache.delete(oldest);
  }
  const runtime = createRuntime(api, { onUpdateAlert });
  runtimeCache.set(key, runtime);
  // 初始化失败时从缓存中移除，下次重试
  runtime.init.catch(() => runtimeCache.delete(key));
  return runtime;
}

/** 清除某个音源的 Runtime 缓存（重新导入脚本时调用） */
export function invalidateRuntimeCache(apiId: string): void {
  for (const key of runtimeCache.keys()) {
    if (key.startsWith(`${apiId}::`)) {
      runtimeCache.delete(key);
    }
  }
}

/** 把已初始化的 Runtime 放回缓存（深度测试复用，避免重复执行脚本） */
function primeRuntimeCache(api: CustomSourceItem, runtime: RuntimeInstance): void {
  const key = getCacheKey(api);
  if (runtimeCache.size >= RUNTIME_CACHE_MAX) {
    const oldest = runtimeCache.keys().next().value;
    if (oldest !== undefined) runtimeCache.delete(oldest);
  }
  runtimeCache.set(key, runtime);
}

export async function testCustomSource(api: CustomSourceItem, updateAlertWaitMs = TEST_UPDATE_ALERT_WAIT_MS): Promise<RuntimeInitResult> {
  // 测试时强制重建，不走缓存
  invalidateRuntimeCache(api.id);
  const runtime = createRuntime(api);
  const result = await runtime.init;
  const updateAlert = result.updateAlert ?? await runtime.waitForUpdateAlert(updateAlertWaitMs);
  return { ...result, updateAlert };
}

// ─── 深度测试：真实取链 ────────────────────────────────────────
// 初始化通过不代表脚本真的能取到播放地址（假阳性），这里用内置固定测试曲走一次真实
// musicUrl 请求验证端到端可用性。超时 20s，与现有播放解析预期对齐。

const DEEP_TEST_TIMEOUT_MS = 20_000;
const DEEP_TEST_QUALITY = '128k';

/** 内置固定测试曲（id 均为公开常驻曲目，可按需替换）：
 *  - wy：2034742057 林俊杰-江南（备选 1492167768）
 *  - tx：songmid 0039MnYb0qxYhV
 */
const DEEP_TEST_TRACKS: Record<'wy' | 'tx', { id: string; name: string; singer: string; albumName: string }> = {
  wy: { id: '2034742057', name: '江南', singer: '林俊杰', albumName: '第二天堂' },
  tx: { id: '0039MnYb0qxYhV', name: '江南', singer: '林俊杰', albumName: '第二天堂' },
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

export async function testCustomSourceDeep(api: CustomSourceItem, updateAlertWaitMs = TEST_UPDATE_ALERT_WAIT_MS): Promise<DeepTestResult> {
  // 阶段一：复用现有 init 流程
  invalidateRuntimeCache(api.id);
  const runtime = createRuntime(api);
  let initResult: RuntimeInitResult;
  try {
    initResult = await runtime.init;
    initResult = { ...initResult, updateAlert: initResult.updateAlert ?? await runtime.waitForUpdateAlert(updateAlertWaitMs) };
  } catch (error) {
    return { ok: false, message: `初始化失败：${error instanceof Error ? error.message : String(error)}`, sources: undefined, updateAlert: undefined };
  }

  // 阶段二：选平台与测试曲（声明 musicUrl 能力的平台中优先 wy），走真实取链
  const sources = initResult.sources ?? {};
  const pickSource = (['wy', 'tx'] as const).find((name) => sources[name]?.actions.includes('musicUrl'));
  if (!pickSource) {
    return { ok: true, message: '初始化正常；未声明 musicUrl，仅验证初始化', sources, updateAlert: initResult.updateAlert };
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

  // 深度测试重建的 Runtime 复用缓存，取链走现有 requestCustomSourceMusicUrl
  primeRuntimeCache(api, runtime);
  try {
    const result = await withTimeout(
      requestCustomSourceMusicUrl(api, music, quality),
      DEEP_TEST_TIMEOUT_MS,
      `取链测试超时（超过 ${DEEP_TEST_TIMEOUT_MS / 1000}s 未返回播放地址）`,
    );
    if (!/^https?:\/\//.test(result.url)) throw new Error(`未返回可播放 URL：${result.url.slice(0, 128)}`);
    return { ok: true, message: `初始化正常；取链测试通过（${pickSource} ${result.quality || quality}）`, sources: result.sources ?? sources, updateAlert: initResult.updateAlert };
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
  onUpdateAlert?: UpdateAlertListener,
): Promise<{ url: string; quality: string; sources?: Record<string, CustomSourceSourceInfo> }> {
  const runtime = getCachedRuntime(api, onUpdateAlert);
  const initResult = await runtime.init;
  const sourceInfo = initResult.sources?.[music.source];
  if (!sourceInfo?.actions.includes('musicUrl')) throw new Error(`音源不支持 ${music.source} 的播放链接解析`);
  if (sourceInfo.qualitys.length && !sourceInfo.qualitys.includes(quality)) throw new Error(`音源不支持 ${quality} 音质`);

  const result = await runtime.request({
    source: music.source,
    action: 'musicUrl',
    info: {
      type: quality,
      musicInfo: toOldMusicInfo(music),
    },
  });
  const data = result.data as { url?: string; type?: string };
  if (!data.url) throw new Error('自定义音源没有返回可播放 URL');
  return { url: data.url, quality: data.type || quality, sources: initResult.sources };
}
