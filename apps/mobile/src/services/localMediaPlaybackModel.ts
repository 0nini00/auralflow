import type { MusicInfo } from "@lx/core";
import type { LocalMediaResult } from "./localMediaAssetsService";

export interface LocalMediaPlaybackState extends Omit<LocalMediaResult, "lyrics"> {
  songKey: string;
  requestId: number;
}
export function isLocalMediaSong(song: MusicInfo | null): boolean {
  return Boolean(song && (song.source === "local" || song.isLocal));
}
export function localMediaSongKey(song: MusicInfo | null): string {
  return song ? JSON.stringify([song.source, song.id, song.url]) : "";
}
interface ArtworkState { currentSong: MusicInfo | null; localMedia: LocalMediaPlaybackState | null }
/**
 * 播放器封面。
 *
 * 本地曲封面只来自音频文件自己（内嵌标签 / 同目录旁挂图），扫描与下载元数据已经把它写进记录的
 * picUrl / img；平台匹配与「补全得到的封面」这一路已删除，因此这里直接取记录值，不再有补充来源。
 */
export function selectPlaybackArtwork(state: ArtworkState): string | undefined {
  return state.currentSong?.picUrl || state.currentSong?.img;
}
export function selectLocalMediaMessage(state: ArtworkState): string | undefined {
  return isLocalMediaSong(state.currentSong) && state.localMedia?.songKey === localMediaSongKey(state.currentSong)
    ? state.localMedia?.message || undefined : undefined;
}
