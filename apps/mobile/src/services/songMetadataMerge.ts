import type { MusicInfo, MusicInfoWithVariants } from "@lx/core";
import { isSameSong } from "@lx/core";

/**
 * 移动端歌曲元数据合并（跨源去重）。
 *
 * 匹配规则统一由 @lx/core（song-variant）提供：按「歌名 + 歌手 + 时长差」判定
 * 同一首歌，将来自不同来源（网易云 / QQ音乐 等）的同一首歌合并为一条，
 * 并在 `variants` 中保留所有来源变体，便于 UI 展示多来源标签与回退解析。
 * 本模块只负责合并编排与元数据补全，不再持有匹配规则副本。
 */

/** 合并后的歌曲信息；在 MusicInfo 基础上附加跨源变体列表。 */
export type MergedMusicInfo = MusicInfoWithVariants;

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
