import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import CryptoJS from 'crypto-js';
import forge from 'node-forge';
import type { MusicInfo } from '@lx/core';
import type { CustomSourceItem, CustomSourceSourceInfo } from '@/stores/customSourceStore';

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
}

interface RuntimeRequestPayload {
  source: string;
  action: 'musicUrl' | 'lyric' | 'pic';
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

function toOldMusicInfo(music: MusicInfo): Record<string, unknown> {
  return {
    name: music.name,
    singer: music.singer,
    source: music.source,
    songmid: music.id,
    songId: music.id,
    interval: music.interval,
    albumName: music.albumName,
    albumId: '',
    img: music.picUrl ?? music.img ?? '',
    types: [],
    _types: {},
    typeUrl: {},
  };
}

function createRequestResponse(rawBody: unknown, status: number, statusText: string, headers: Headers) {
  const headerObject: Record<string, string> = {};
  headers.forEach((value, key) => {
    headerObject[key] = value;
  });
  return {
    statusCode: status,
    statusMessage: statusText,
    headers: headerObject,
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
      async inflate() {
        throw new Error('自定义音源脚本调用了 lx.utils.zlib.inflate，但 AuralFlow 运行时没有提供 zlib 能力');
      },
      async deflate() {
        throw new Error('自定义音源脚本调用了 lx.utils.zlib.deflate，但 AuralFlow 运行时没有提供 zlib 能力');
      },
    },
  };
}

function runHttpRequest(
  url: string,
  options: { method?: string; timeout?: number; headers?: Record<string, string>; body?: unknown; form?: Record<string, string>; formData?: BodyInit },
  callback: (error: Error | null, response: unknown, body: unknown) => void,
): () => void {
  const controller = new AbortController();
  const timeoutMs = typeof options.timeout === 'number' && options.timeout > 0 ? Math.min(options.timeout, 60_000) : 60_000;
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  void (async () => {
    try {
      let body: BodyInit | undefined;
      if (options.body != null) {
        body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
      } else if (options.form) {
        body = new URLSearchParams(options.form);
      } else if (options.formData) {
        body = options.formData;
      }

      const response = await tauriFetch(url, {
        method: options.method ?? 'GET',
        headers: options.headers,
        body,
        signal: controller.signal,
      });
      const text = await response.text();
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
      callback(null, createRequestResponse(parsed, response.status, response.statusText, response.headers), parsed);
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)), null, null);
    } finally {
      window.clearTimeout(timer);
    }
  })();

  return () => controller.abort();
}

function createRuntime(api: CustomSourceItem): RuntimeInstance {
  let requestHandler: ((payload: RuntimeRequestPayload) => Promise<unknown>) | null = null;
  let finishInit: (value: RuntimeInitResult) => void = () => undefined;
  let failInit: (error: Error) => void = () => undefined;
  let initSettled = false;
  let updateAlert: CustomSourceUpdateAlert | undefined;
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
          updateAlert = normalizeUpdateAlert(data) ?? updateAlert;
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

  try {
    const runner = new Function('lx', 'window', 'globalThis', api.script);
    runner(lx, { lx }, { lx });
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

const runtimeCache = new Map<string, RuntimeInstance>();

function getCacheKey(api: CustomSourceItem): string {
  // script 变化（用户重新导入）时应让缓存失效
  return `${api.id}::${api.script.length}::${api.script.slice(0, 64)}`;
}

function getCachedRuntime(api: CustomSourceItem): RuntimeInstance {
  const key = getCacheKey(api);
  const cached = runtimeCache.get(key);
  if (cached) return cached;
  const runtime = createRuntime(api);
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

export async function testCustomSource(api: CustomSourceItem): Promise<RuntimeInitResult> {
  // 测试时强制重建，不走缓存
  invalidateRuntimeCache(api.id);
  const runtime = createRuntime(api);
  const result = await runtime.init;
  // 有些 LX 脚本会先完成 init，再异步发 updateAlert；给它一个短暂窗口。
  await new Promise((resolve) => window.setTimeout(resolve, 800));
  return { ...result, updateAlert: runtime.getUpdateAlert() ?? result.updateAlert };
}

export async function requestCustomSourceMusicUrl(
  api: CustomSourceItem,
  music: MusicInfo,
  quality: string,
): Promise<{ url: string; quality: string; sources?: Record<string, CustomSourceSourceInfo> }> {
  const runtime = getCachedRuntime(api);
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
