/**
 * B站 DASH 音频流的音质映射 —— 双端共用的唯一真相源。
 *
 * B站 playurl 返回的 DASH 音频流用 `id`(codec 档位)区分音质,官方约定:
 *   30232 = 64k   30216 = 64k(旧)
 *   30280 = 192k
 *   30250 = 320k
 *   30251 = Hi-Res(需大会员 / 特定视频)
 *   dash.flac.audio = 真无损 FLAC
 * bandwidth(码率)只是参考值,不同视频同一档的 bandwidth 会波动,
 * 拿它做「≥300k 即 320k」这类判断会错位。要以 id 为准。
 *
 * 桌面端/移动端 provider 取链时调用本模块,避免各写一份映射漂移。
 */

import {
  type PlaybackQuality,
  normalizePlaybackQuality,
} from "./playback-quality";

/** 320k 档对应的 DASH audio id(30250),另有 30280=192k 等。 */
export const BILI_DASH_ID_320K = 30250;
/** Hi-Res 档对应的 DASH audio id。 */
export const BILI_DASH_ID_HIRES = 30251;
/** 192k 档对应的 DASH audio id。 */
export const BILI_DASH_ID_192K = 30280;
/** 128k/64k 档对应的 DASH audio id。 */
export const BILI_DASH_ID_128K = 30232;

export interface BiliDashAudioLike {
  id?: number | string;
  bandwidth?: number | string;
  /** FLAC 流(playurl.dash.flac.audio) */
  baseUrl?: string;
  base_url?: string;
  url?: string;
  backupUrl?: string[];
  backup_url?: string[];
}

/** 从 playurl 的 dash 段提取某个 audio 的实际取流 URL。 */
export function getBiliAudioUrl(audio: BiliDashAudioLike | null | undefined): string {
  if (!audio) return "";
  return (
    audio.baseUrl ||
    audio.base_url ||
    audio.url ||
    audio.backupUrl?.[0] ||
    audio.backup_url?.[0] ||
    ""
  );
}

function toIdNumber(audio: BiliDashAudioLike): number | null {
  const id = audio.id;
  if (id == null) return null;
  const numeric = Number(id);
  return Number.isFinite(numeric) ? numeric : null;
}

/**
 * 把单条 DASH audio 归类到统一音质档。
 * 返回 null 表示缺少 id(无法识别,不应被选中)。
 */
export function classifyBiliDashAudio(
  audio: BiliDashAudioLike,
): PlaybackQuality | null {
  const id = toIdNumber(audio);
  if (id == null) return null;
  if (id === BILI_DASH_ID_HIRES) return "flac24bit";
  if (id === BILI_DASH_ID_320K) return "320k";
  if (id === BILI_DASH_ID_192K) return "192k";
  if (id === BILI_DASH_ID_128K) return "128k";
  // 其他 id(如 30216 旧 64k、30280 之外的码流)归到最低档兜底
  return "128k";
}

/**
 * 从 playurl 的 DASH audio 列表里,选出与目标音质匹配的最佳流。
 *
 * 规则:
 *  - 目标是 flac24bit → 优先 id=30251;没有则退到最高的常规档(flac24bit 是增强档,不强求)。
 *  - 目标是 flac → B站没有独立 flac 档(FLAC 只作为 30251 之上的增强),退回最高常规档。
 *  - 其他目标 → 精确匹配该档 id;没有精确匹配时退到**不高于目标**的最高可用流,
 *    避免「要 128k 却给 320k」这种越档。
 *  - 全部常规流都不可用时返回 null。
 */
export function pickBiliDashAudioByQuality(
  audioList: BiliDashAudioLike[],
  targetQuality: PlaybackQuality,
): BiliDashAudioLike | null {
  if (!audioList.length) return null;
  const usable = audioList
    .map((audio) => ({ audio, url: getBiliAudioUrl(audio) }))
    .filter((item) => item.url)
    .map((item) => ({ ...item, quality: classifyBiliDashAudio(item.audio) }));
  if (!usable.length) return null;

  const targetRank = qualityRank(targetQuality);

  // 目标为 flac24bit/flac:找 id=30251,找不到就退最高常规
  if (targetQuality === "flac24bit" || targetQuality === "flac") {
    const hires = usable.find((item) => item.quality === "flac24bit");
    if (hires) return hires.audio;
    const bestRegular = usable
      .filter((item) => item.quality && item.quality !== "flac24bit")
      .sort((a, b) => qualityRank(b.quality!) - qualityRank(a.quality!))[0];
    return bestRegular?.audio ?? null;
  }

  // 常规档:精确匹配,匹配不到退到不高于目标档的最高流
  const exact = usable.find((item) => item.quality === targetQuality);
  if (exact) return exact.audio;
  const below = usable
    .filter((item) => item.quality && qualityRank(item.quality) <= targetRank)
    .sort((a, b) => qualityRank(b.quality!) - qualityRank(a.quality!))[0];
  return below?.audio ?? null;
}

/** FLAC 流(playurl.dash.flac.audio)的容器。 */
export interface BiliFlacLike {
  audio?: BiliDashAudioLike;
}

/**
 * 是否包含 Hi-Res(30251)或 FLAC 流 —— 用于 UI 展示「该曲支持无损」。
 */
export function hasBiliLossless(playInfo: {
  dash?: { flac?: BiliFlacLike; audio?: BiliDashAudioLike[] };
}): boolean {
  const flacAudio = playInfo?.dash?.flac?.audio;
  if (flacAudio && getBiliAudioUrl(flacAudio)) return true;
  return (playInfo?.dash?.audio ?? []).some(
    (audio) => toIdNumber(audio) === BILI_DASH_ID_HIRES,
  );
}

function qualityRank(quality: PlaybackQuality | null): number {
  if (!quality) return -1;
  const ladder = ["128k", "192k", "320k", "flac", "flac24bit"];
  return ladder.indexOf(normalizePlaybackQuality(quality));
}
