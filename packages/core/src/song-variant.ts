import type { MusicInfo } from "./sources/types";

/**
 * 跨源歌曲匹配与变体编排。
 *
 * 两端（桌面/移动）的「同名歌曲去重、跨源变体分组、降级候选排序、补源搜索
 * 关键词、解析候选排序」共用本模块，避免规则漂移：历史上桌面与移动各持一份
 * 拷贝，时长容差已经漂移成 5s/6s 两套。
 */

/** 歌曲的跨源变体：与主条目判定为同一首歌的其它来源条目。 */
export interface MusicInfoWithVariants extends MusicInfo {
  variants?: MusicInfo[];
}

/** 搜索结果里一组同名同歌手的歌曲与它的跨源变体。 */
export interface SongVariantGroup {
  /** 分组键：规整歌名 + 规整歌手 + 时长，用于 UI 列表 key。 */
  key: string;
  /** 展示与播放的主条目：按 sourceRank 取最优来源。 */
  primary: MusicInfo;
  /** 含 primary 自身的全部变体（按 sourceRank 排序）。 */
  variants: MusicInfo[];
}

/** 判定为同一首歌时允许的时长差异（秒）。 */
export const SONG_MATCH_INTERVAL_TOLERANCE = 5;

/** 补源候选上限：避免长列表里捞出边缘同名的曲目。 */
export const MAX_VARIANT_CANDIDATES = 12;

/**
 * 规整歌名：NFKC 规范化、统一小写、去除括号及其内容、去除空白与常见标点。
 */
export function normalizeSongName(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[（(【\[「『].*?[）)】\]」』]/g, "")
    .replace(/[\s\-—_·.,，。:：'"《》<>]/g, "")
    .trim();
}

/**
 * 规整歌手名：NFKC 规范化、统一小写、去除分隔符与空白。
 * 不拆分多歌手，仅做整体规整，用于跨源匹配时的整体比较。
 */
export function normalizeArtist(artist: string): string {
  return artist
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[、/,，&＋+]/g, "")
    .replace(/[\s\-—_·.,，。:：'"《》<>]/g, "")
    .trim();
}

/** 按分隔符拆分歌手 token，用于「至少一位歌手重合」的判定。 */
export function splitSingerTokens(singer: string): string[] {
  return singer
    .split(/[、/,，&＋+]/)
    .map(normalizeArtist)
    .filter(Boolean);
}

/** 两首歌是否至少有一位歌手重合。 */
export function hasSingerOverlap(a: MusicInfo, b: MusicInfo): boolean {
  const tokensA = splitSingerTokens(a.singer);
  const tokensB = splitSingerTokens(b.singer);
  if (tokensA.length === 0 || tokensB.length === 0) return false;
  return tokensA.some((ta) => tokensB.some((tb) => ta === tb));
}

/**
 * 判定两首歌是否为同一首：歌名规整后相等、至少一位歌手重合，
 * 且双方时长均存在时时长差不超过 {@link SONG_MATCH_INTERVAL_TOLERANCE} 秒。
 *
 * 时长校验依赖结果携带 interval（wy/tx 直连搜索均满足）；缺 interval 时
 * 退化为「歌名 + 歌手」两重校验。
 */
export function isSameSong(a: MusicInfo, b: MusicInfo): boolean {
  if (normalizeSongName(a.name) !== normalizeSongName(b.name)) return false;
  if (!hasSingerOverlap(a, b)) return false;
  if (a.interval && b.interval) {
    return Math.abs(a.interval - b.interval) <= SONG_MATCH_INTERVAL_TOLERANCE;
  }
  return true;
}

/** 来源优先级：分组与列表优先展示网易云，其次 QQ 音乐，最后其它。 */
export function sourceRank(source: MusicInfo["source"]): number {
  if (source === "wy") return 0;
  if (source === "tx") return 1;
  return 2;
}

/** 歌曲身份键：`source:id`，用于去重、缓存与 pin 持久化。 */
export function buildSongKey(song: Pick<MusicInfo, "source" | "id">): string {
  return `${song.source}:${song.id}`;
}

/** 分组键：规整歌名 + 规整歌手 + 时长。 */
export function buildSongGroupKey(song: MusicInfo): string {
  return `${normalizeSongName(song.name)}:${normalizeArtist(song.singer)}:${song.interval ?? 0}`;
}

/**
 * 将歌曲列表按「同名同歌手」跨源合并为分组。
 *
 * 算法：按输入顺序遍历，每首歌归入第一个存在同类变体的分组；
 * 分组内按 sourceRank 排序（wy 优先），primary 取排序后的首条；
 * variants 含 primary 自身，同一来源的重复条目只保留第一条。
 */
export function groupSongResults(songs: MusicInfo[]): SongVariantGroup[] {
  const groups: SongVariantGroup[] = [];

  for (const song of songs) {
    const existing = groups.find((group) => group.variants.some((variant) => isSameSong(variant, song)));
    if (!existing) {
      groups.push({
        key: buildSongGroupKey(song),
        primary: song,
        variants: [song],
      });
      continue;
    }

    if (!existing.variants.some((variant) => variant.source === song.source && variant.id === song.id)) {
      existing.variants.push(song);
    }

    existing.variants.sort((a, b) => sourceRank(a.source) - sourceRank(b.source));
    existing.primary = existing.variants[0];
  }

  return groups;
}

/** 读取歌曲携带的变体列表（未携带时为空数组）。 */
export function getSongVariants(song: MusicInfo): MusicInfo[] {
  const variants = (song as MusicInfoWithVariants).variants;
  return Array.isArray(variants) ? variants : [];
}

/** 分组是否包含某来源（主条目或任一变体）；搜索结果按来源筛选的一端共享语义。 */
export function groupHasSource(group: SongVariantGroup, source: MusicInfo["source"]): boolean {
  return group.primary.source === source || group.variants.some((variant) => variant.source === source);
}

/** 附加变体列表；变体为空时原样返回，避免挂上空数组污染存储与同步。 */
export function withSongVariants(song: MusicInfo, variants: MusicInfo[]): MusicInfoWithVariants {
  if (variants.length === 0) return song;
  return { ...song, variants };
}

/**
 * 补源搜索关键词：歌名 + 首位歌手。
 * 只带歌名时同名不同曲过多，只带歌手时搜不出具体曲目。
 */
export function buildVariantSearchKeyword(song: MusicInfo): string {
  const primarySinger = song.singer?.split(/[、/,，&＋+]/)[0]?.trim() ?? "";
  return [song.name.trim(), primarySinger].filter(Boolean).join(" ");
}

/** 候选打分：时长差 + 歌名是否精确一致。 */
export interface RankedVariantCandidate {
  song: MusicInfo;
  durationDelta: number;
  exactName: boolean;
}

/**
 * 给候选打分排序：时长差更小者优先（Live/重录版通常与录音室版时长不同），
 * 其次是歌名规整后完全一致者，最后按原搜索顺序（补源搜索自身的相关度排序）。
 */
export function rankVariantCandidates(source: MusicInfo, candidates: MusicInfo[]): RankedVariantCandidate[] {
  const sourceName = normalizeSongName(source.name);
  return candidates
    .map((song) => ({
      song,
      durationDelta:
        source.interval && song.interval ? Math.abs(source.interval - song.interval) : Number.MAX_SAFE_INTEGER,
      exactName: normalizeSongName(song.name) === sourceName,
    }))
    .sort((a, b) => {
      if (a.durationDelta !== b.durationDelta) return a.durationDelta - b.durationDelta;
      if (a.exactName !== b.exactName) return a.exactName ? -1 : 1;
      return 0;
    });
}

/**
 * 从补源搜索结果中筛出可接管的候选：来源匹配 + isSameSong 严格校验 +
 * 按时长差排序，取前 {@link MAX_VARIANT_CANDIDATES} 条。
 */
export function matchVariantCandidates(
  source: MusicInfo,
  candidates: MusicInfo[],
  targetSource: MusicInfo["source"],
  maxCandidates = MAX_VARIANT_CANDIDATES,
): MusicInfo[] {
  const matched = candidates
    .filter((item) => item.source === targetSource && isSameSong(source, item))
    .slice(0, maxCandidates);
  return rankVariantCandidates(source, matched).map((entry) => entry.song);
}

/**
 * 解析候选顺序：pin 优先，其次主条目，再按变体列表原顺序；按身份键去重。
 * pin 未命中任何候选时等同常规顺序。
 */
export function orderPlaybackCandidates(song: MusicInfo, pinnedKey?: string | null): MusicInfo[] {
  const ordered: MusicInfo[] = [];
  const seen = new Set<string>();

  const push = (candidate: MusicInfo) => {
    const key = buildSongKey(candidate);
    if (seen.has(key)) return;
    seen.add(key);
    ordered.push(candidate);
  };

  if (pinnedKey) {
    const pinned = getSongVariants(song).find((variant) => buildSongKey(variant) === pinnedKey);
    if (pinned) push(pinned);
  }
  push(song);
  for (const variant of getSongVariants(song)) push(variant);
  return ordered;
}
