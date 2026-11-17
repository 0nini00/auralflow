import type { MusicInfo } from "../sources/types";
import type { CustomSourceSourceInfo, CustomSourceUpdateAlert } from "./model";

/**
 * LX 自定义源脚本协议里与宿主无关的部分：能力声明归一化、更新提示校验、
 * musicInfo 映射、取链请求的构造与应答校验。
 *
 * 脚本怎么执行是两端各自的事（桌面 `new Function`，移动端隐藏 WebView 桥），
 * 这里只回答「脚本说了什么、该回它什么」——两端对同一份脚本必须给出相同答案。
 */

/** 脚本必须在此时限内调用 `lx.send(lx.EVENT_NAMES.inited, ...)`。 */
export const CUSTOM_SOURCE_INIT_TIMEOUT_MS = 30_000;
/** 手动测试时，初始化完成后再等这么久收集脚本异步发出的 updateAlert。 */
export const CUSTOM_SOURCE_TEST_UPDATE_ALERT_WAIT_MS = 800;
/** 更新检查专用的等待窗口：比测试更长，给脚本自检更新留足时间。 */
export const CUSTOM_SOURCE_CHECK_UPDATE_ALERT_WAIT_MS = 5_000;

export interface CustomSourceRuntimeInitResult {
  sources?: Record<string, CustomSourceSourceInfo>;
  updateAlert?: CustomSourceUpdateAlert;
}

export interface CustomSourceRuntimeRequestPayload {
  source: string;
  action: "musicUrl" | "lyric" | "pic";
  info: Record<string, unknown>;
}

export interface CustomSourceRuntimeRequestResult {
  source: string;
  action: string;
  data: {
    type?: string;
    url?: string;
  } | string;
}

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

/** 把脚本 `inited` 上报的能力清单收敛到本应用支持的平台 / 动作 / 音质白名单。 */
export function normalizeCustomSourceInitSources(
  info: unknown,
): Record<string, CustomSourceSourceInfo> {
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

/** 校验脚本上报的 updateAlert：日志必填并截断，更新地址只接受不超长的 http(s)。 */
export function normalizeCustomSourceUpdateAlert(data: unknown): CustomSourceUpdateAlert | undefined {
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
export function toLxMusicInfo(
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

/**
 * 构造 musicUrl 取链请求。脚本没有声明该平台或该音质时直接抛错，
 * 不把明知不支持的请求发给脚本。未声明任何音质视为不限制。
 */
export function buildCustomSourceMusicUrlRequest(
  sources: Record<string, CustomSourceSourceInfo> | undefined,
  music: MusicInfo,
  quality: string,
  platformRequest?: CustomSourcePlatformRequest,
): CustomSourceRuntimeRequestPayload {
  const sourceId = platformRequest?.source ?? music.source;
  const sourceInfo = sources?.[sourceId];
  if (!sourceInfo?.actions.includes("musicUrl")) {
    throw new Error(`音源不支持 ${sourceId} 的播放链接解析`);
  }
  if (sourceInfo.qualitys.length && !sourceInfo.qualitys.includes(quality)) {
    throw new Error(`音源不支持 ${quality} 音质`);
  }
  return {
    source: sourceId,
    action: "musicUrl",
    info: {
      type: quality,
      musicInfo: toLxMusicInfo(music, platformRequest),
    },
  };
}

/**
 * 校验脚本 request handler 的返回值并包装成运行时应答。
 * musicUrl 只接受长度受限的 http(s) 字符串；其余动作原样透传。
 */
export function toCustomSourceRuntimeRequestResult(
  payload: CustomSourceRuntimeRequestPayload,
  response: unknown,
): CustomSourceRuntimeRequestResult {
  if (payload.action !== "musicUrl") {
    return { source: payload.source, action: payload.action, data: response as string };
  }
  if (typeof response !== "string" || response.length > 2048 || !/^https?:/.test(response)) {
    throw new Error("自定义音源没有返回可播放 URL");
  }
  return {
    source: payload.source,
    action: payload.action,
    data: {
      type: payload.info.type as string,
      url: response,
    },
  };
}

/** 从 musicUrl 应答里取出播放地址；脚本未回报实际音质时沿用请求的音质。 */
export function readCustomSourceMusicUrlResult(
  result: CustomSourceRuntimeRequestResult,
  requestedQuality: string,
): { url: string; quality: string } {
  const data = result.data as { url?: string; type?: string };
  if (!data.url) throw new Error("自定义音源没有返回可播放 URL");
  return { url: data.url, quality: data.type || requestedQuality };
}
