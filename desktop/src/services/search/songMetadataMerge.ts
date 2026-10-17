import type { MusicInfo } from "@lx/core";
import { isSameSong } from "@lx/core";

/**
 * 桌面端搜索结果元数据合并。
 * 匹配规则统一由 @lx/core（song-variant）提供，本模块只负责合并编排。
 */

function mergeMetadata(primary: MusicInfo, metadata: MusicInfo): MusicInfo {
  const cover = primary.picUrl || primary.img || metadata.picUrl || metadata.img;
  return {
    ...primary,
    // 官方歌曲需要 gateway 才能走网关播放解析，缺失时透传元数据方的 gateway
    gateway: primary.gateway || metadata.gateway,
    albumName: primary.albumName || metadata.albumName,
    interval: primary.interval || metadata.interval,
    quality: primary.quality || metadata.quality,
    picUrl: primary.picUrl || cover,
    img: primary.img || cover,
  };
}

export function mergeSongSearchMetadata(
  primarySongs: MusicInfo[],
  metadataSongs: MusicInfo[],
): MusicInfo[] {
  const usedMetadataIndexes = new Set<number>();
  const merged = primarySongs.map((song) => {
    const metadataIndex = metadataSongs.findIndex((candidate, index) => {
      return !usedMetadataIndexes.has(index) && isSameSong(song, candidate);
    });
    if (metadataIndex < 0) return song;

    usedMetadataIndexes.add(metadataIndex);
    return mergeMetadata(song, metadataSongs[metadataIndex]);
  });

  for (let index = 0; index < metadataSongs.length; index += 1) {
    if (!usedMetadataIndexes.has(index)) merged.push(metadataSongs[index]);
  }

  return merged;
}
