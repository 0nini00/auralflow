import type { MusicInfo } from "@lx/core";

/**
 * 移动端歌曲元数据合并（跨源去重）。
 *
 * 参考桌面端 src/services/search/songMetadataMerge.ts 的实现思路，
 * 适配移动端 MusicInfo 数据结构：按「歌名 + 歌手 + 时长差」判定同一首歌，
 * 将来自不同来源（网易云 / QQ音乐 / B站 等）的同一首歌合并为一条，
 * 并在 `variants` 中保留所有来源变体，便于 UI 展示多来源标签与回退解析。
 */

/** 合并后的歌曲信息；在 MusicInfo 基础上附加跨源变体列表。 */
export interface MergedMusicInfo extends MusicInfo {
  /** 与本条判定为同一首歌的其它来源变体（不含 primary 自身）。 */
  variants?: MusicInfo[];
}

/** 判定为同一首歌时允许的时长差异（秒）。 */
const INTERVAL_TOLERANCE = 5;

/**
 * 规整歌名：NFKC 规范化、统一小写、去除括号及其内容、去除空白与常见标点。
 */
export function normalizeSongName(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[（(【\[「『].*?[）)】\]」』]/g, "") // 去除各种括号及其内容
    .replace(/[\s\-—_·.,，。:：'"《》<>]/g, "")
    .trim();
}

/**
 * 规整歌手名：NFKC 规范化、统一小写、去除分隔符与空白。
 * 注意：这里不拆分多歌手，仅做整体规整，用于跨源匹配时的整体比较。
 */
export function normalizeArtist(artist: string): string {
  return artist
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[、/,，&＋+]/g, "") // 去除多歌手分隔符
    .replace(/[\s\-—_·.,，。:：'"《》<>]/g, "")
    .trim();
}

/** 按分隔符拆分歌手 token，用于「至少一位歌手重合」的判定。 */
function splitSingerTokens(singer: string): string[] {
  return singer
    .split(/[、/,，&＋+]/)
    .map(normalizeArtist)
    .filter(Boolean);
}

/** 两首歌是否至少有一位歌手重合。 */
function hasSingerOverlap(a: MusicInfo, b: MusicInfo): boolean {
  const tokensA = splitSingerTokens(a.singer);
  const tokensB = splitSingerTokens(b.singer);
  if (tokensA.length === 0 || tokensB.length === 0) return false;
  return tokensA.some((ta) => tokensB.some((tb) => ta === tb));
}

/**
 * 判定两首歌是否为同一首：歌名规整后相等、至少一位歌手重合、
 * 且双方时长均存在时时长差不超过 {@link INTERVAL_TOLERANCE} 秒。
 */
export function isSameSong(a: MusicInfo, b: MusicInfo): boolean {
  if (normalizeSongName(a.name) !== normalizeSongName(b.name)) return false;
  if (!hasSingerOverlap(a, b)) return false;
  if (a.interval && b.interval) {
    return Math.abs(a.interval - b.interval) <= INTERVAL_TOLERANCE;
  }
  return true;
}

/**
 * 将一条元数据合并到 primary 上，补全缺失字段（专辑、时长、音质、封面）。
 * primary 的来源与 gateway 保持不变，确保解析回退仍走原始来源。
 */
function mergeMetadata(primary: MusicInfo, metadata: MusicInfo): MusicInfo {
  const cover = primary.picUrl || primary.img || metadata.picUrl || metadata.img;
  const mvId = primary.source === "wy"
    ? primary.mvId || (metadata.source === "wy" ? metadata.mvId : undefined)
    : undefined;
  return {
    ...primary,
    albumName: primary.albumName || metadata.albumName,
    interval: primary.interval || metadata.interval,
    quality: primary.quality || metadata.quality,
    picUrl: primary.picUrl || cover,
    img: primary.img || cover,
    mvId,
  };
}

/**
 * 对跨源搜索结果去重合并。
 *
 * 算法：按输入顺序遍历，将每首歌归入第一个判定为「同一首歌」的分组；
 * 每组取首条为 primary，合并其余变体的元数据，并把所有不同来源的变体
 * 收集到 `variants` 中（同一来源的重复只保留第一条）。保留输入顺序。
 */
export function mergeDuplicateSongs(songs: MusicInfo[]): MergedMusicInfo[] {
  const groups: Array<{
    primary: MusicInfo;
    variants: MusicInfo[];
    seenSources: Set<string>;
  }> = [];

  for (const song of songs) {
    const groupIndex = groups.findIndex((group) => isSameSong(group.primary, song));
    if (groupIndex < 0) {
      groups.push({
        primary: song,
        variants: [],
        seenSources: new Set<string>([song.source]),
      });
      continue;
    }

    const group = groups[groupIndex];
    // 合并元数据（补全 primary 缺失字段）
    group.primary = mergeMetadata(group.primary, song);

    // 仅保留不同来源的变体，避免同一来源重复条目
    if (!group.seenSources.has(song.source)) {
      group.seenSources.add(song.source);
      group.variants.push(song);
    }
  }

  return groups.map((group) => {
    const merged: MergedMusicInfo = { ...group.primary };
    if (group.variants.length > 0) {
      merged.variants = group.variants;
    }
    return merged;
  });
}

/**
 * 获取一首（可能已合并的）歌曲涉及的所有来源标签 key，按出现顺序去重。
 * 用于 UI 展示「网易云/QQ音乐」等多来源标签。
 */
export function collectSongSources(song: MusicInfo): string[] {
  const sources: string[] = [];
  const seen = new Set<string>();
  const push = (src?: string) => {
    if (src && !seen.has(src)) {
      seen.add(src);
      sources.push(src);
    }
  };
  push(song.source);
  const variants = (song as MergedMusicInfo).variants;
  if (variants) {
    for (const variant of variants) push(variant.source);
  }
  return sources;
}
