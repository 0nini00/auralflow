/**
 * 网易云「音乐云盘」条目 → MusicInfo 的共享映射。
 *
 * 为什么放在 core：两端都要把同一个 `/v1/cloud/get` 响应转成可播放条目，
 * 而映射里全是容易各写一份然后漂移的细节——id 取 `songId` 还是 `simpleSong.id`、
 * 时长是毫秒还是秒、封面在 `al.picUrl` 还是 `cover`、`matchType` 怎么归一到
 * `matchStatus`。按仓库既定原则（两端必须给出相同答案的规则收敛进 core），
 * 这里做成纯函数，双端共同消费。
 *
 * 响应形状按 2026-10 实测（账号内 161 条）确定：
 *
 * ```jsonc
 * {
 *   "privateCloud": { "songId": 27694142, "bitrate": 1681, "fileName": "他和她 - 回音哥.flac",
 *                     "fileSize": 48781208, "originalAudioSongId": 3364659151, "matchType": ... },
 *   "simpleSong": { "id": 27694142, "name": "他和她", "dt": 229067, "fee": 1,
 *                   "ar": [{ "name": "回音哥" }],
 *                   "al": { "name": "重定义", "picUrl": "http://p2.music.126.net/..." } },
 *   "songId": 27694142, "songName": "他和她", "bitrate": 1681, "fileSize": 48781208,
 *   "fileName": "...", "matchType": "matched" | "unmatched"
 * }
 * ```
 */
import type { MusicCloudMeta, MusicInfo } from "./types";

/** 云盘列表接口（weapi `/v1/cloud/get`）返回的单条记录。字段全部可选：以实测为准。 */
export interface WyCloudItem {
  /** 条目对应的歌曲 id（同时也是 simpleSong.id），播放取链就用它 */
  songId?: number | string;
  songName?: string;
  /** 上传文件真实码率，单位 kbps */
  bitrate?: number;
  /** 上传文件字节数 */
  fileSize?: number;
  /** 上传时的原始文件名 */
  fileName?: string;
  /** "matched" 表示这条上传被网易云匹配到了在线曲目 */
  matchType?: string;
  simpleSong?: {
    id?: number | string;
    name?: string;
    /** 时长，毫秒 */
    dt?: number;
    fee?: number;
    ar?: { name?: string }[];
    artists?: { name?: string }[];
    al?: { name?: string; picUrl?: string };
    album?: { name?: string; picUrl?: string };
  };
  privateCloud?: {
    songId?: number;
    bitrate?: number;
    fileSize?: number;
    fileName?: string;
    originalAudioSongId?: number;
  };
  album?: { name?: string; picUrl?: string } | string;
  artist?: string;
  cover?: string | number;
}

function pickText(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function pickNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  }
  return undefined;
}

function pickId(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return String(value);
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function toMatchStatus(matchType: unknown): MusicCloudMeta["matchStatus"] {
  if (matchType === "matched") return "matched";
  if (matchType === "unmatched") return "unmatched";
  return undefined;
}

/**
 * 把一条云盘记录转成可播放的 `MusicInfo`；缺少 id 或歌名时返回 `null`
 * （这类记录无法取链，也不该在列表里冒充可播放项）。
 *
 * 产出的条目固定 `source: "wy"` 且 `wyCloud: true`——后者是两端播放链路
 * 「跳过网关/自定义源 + 跳过试听判定」的开关，不要丢。
 */
export function toCloudMusicInfo(item: WyCloudItem | null | undefined): MusicInfo | null {
  if (!item || typeof item !== "object") return null;

  const simple = item.simpleSong ?? {};
  const privateCloud = item.privateCloud ?? {};

  const id = pickId(item.songId, simple.id, privateCloud.songId);
  if (!id) return null;

  const name = pickText(item.songName, simple.name, privateCloud.fileName);
  if (!name) return null;

  const singers = (simple.ar ?? simple.artists ?? [])
    .map((artist) => pickText(artist?.name))
    .filter((value): value is string => Boolean(value));

  const albumObject = typeof item.album === "object" && item.album !== null ? item.album : undefined;
  const albumName = pickText(simple.al?.name, simple.album?.name, albumObject?.name) ?? "";

  // 封面只认 simpleSong.al.picUrl：云盘条目的 cover / coverId 在实测里是数字 id，
  // 不是可以直接渲染的地址；拿不到就让 UI 显示占位图。
  const picUrl = pickText(simple.al?.picUrl, simple.album?.picUrl, albumObject?.picUrl);

  const dt = pickNumber(simple.dt);
  const cloudMeta: MusicCloudMeta = {
    bitrate: pickNumber(item.bitrate, privateCloud.bitrate),
    fileName: pickText(item.fileName, privateCloud.fileName),
    size: pickNumber(item.fileSize, privateCloud.fileSize),
    matchStatus: toMatchStatus(item.matchType),
  };

  return {
    id,
    name,
    singer: singers.length > 0 ? singers.join("/") : pickText(item.artist) ?? "未知歌手",
    albumName,
    source: "wy",
    interval: dt != null ? Math.round(dt / 1000) : undefined,
    picUrl,
    wyCloud: true,
    cloudMeta,
  };
}

/** 批量映射，顺手丢掉无法取链的记录。 */
export function toCloudMusicInfos(items: readonly WyCloudItem[] | null | undefined): MusicInfo[] {
  if (!Array.isArray(items)) return [];
  const result: MusicInfo[] = [];
  for (const item of items) {
    const mapped = toCloudMusicInfo(item);
    if (mapped) result.push(mapped);
  }
  return result;
}

/** 云盘原始文件名里认可的音频扩展名（决定下载落盘的文件名）。 */
const CLOUD_AUDIO_EXTENSIONS = new Set([
  "mp3",
  "flac",
  "m4a",
  "aac",
  "wav",
  "ogg",
  "opus",
  "ape",
  "wma",
]);

/**
 * 云盘上传文件的真实扩展名，取自上传时的原始文件名。
 *
 * 下载云盘曲必须用它而不是「请求音质」推扩展名：云盘不做转码，请求 320k 也可能
 * 拿到用户上传的 FLAC；按请求档位命名会得到 `歌曲.mp3` 里装着 FLAC 字节。
 */
export function cloudFileExtension(
  music: Pick<MusicInfo, "wyCloud" | "cloudMeta">,
): string | undefined {
  if (music.wyCloud !== true) return undefined;
  const fileName = music.cloudMeta?.fileName;
  if (!fileName) return undefined;
  const ext = fileName.split(".").pop()?.toLowerCase();
  return ext && CLOUD_AUDIO_EXTENSIONS.has(ext) ? ext : undefined;
}

/**
 * 云盘条目的「诚实音质标签」——由上传文件真实码率换算，只用于 UI 展示。
 *
 * 不要拿它去决定请求档位：云盘不做转码，请求哪档都返回原文件。
 */
export function cloudQualityLabel(bitrateKbps: number | undefined | null): string | undefined {
  if (typeof bitrateKbps !== "number" || !Number.isFinite(bitrateKbps) || bitrateKbps <= 0) {
    return undefined;
  }
  if (bitrateKbps > 1500) return "Hi-Res";
  if (bitrateKbps > 320) return "无损";
  return `${Math.round(bitrateKbps)}k`;
}
