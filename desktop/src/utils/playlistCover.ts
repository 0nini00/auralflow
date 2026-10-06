import type { MusicInfo } from '@lx/core';

interface PlaylistArtwork {
  cover?: string;
  /** 兼容旧版导入的歌单封面字段。 */
  picUrl?: string;
  songs: readonly Pick<MusicInfo, 'img' | 'picUrl'>[];
}

/** 持久化时只保留独立封面，旧字段在导入导出边界归一化。 */
export function getPlaylistOwnCover(playlist: Pick<PlaylistArtwork, 'cover' | 'picUrl'>): string | undefined {
  return playlist.cover?.trim() || playlist.picUrl?.trim() || undefined;
}

/** 没有独立封面时从歌曲派生；不写回 store，避免歌曲变化后封面陈旧。 */
export function getPlaylistCover(playlist: PlaylistArtwork): string {
  const ownCover = getPlaylistOwnCover(playlist);
  if (ownCover) return ownCover;
  for (const song of playlist.songs) {
    const cover = song.img?.trim() || song.picUrl?.trim();
    if (cover) return cover;
  }
  return '';
}
