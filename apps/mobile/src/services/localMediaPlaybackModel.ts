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
export function selectPlaybackArtwork(state: ArtworkState): string | undefined {
  const supplemental = isLocalMediaSong(state.currentSong) && state.localMedia?.songKey === localMediaSongKey(state.currentSong)
    ? state.localMedia?.coverUri : undefined;
  return supplemental || state.currentSong?.picUrl || state.currentSong?.img;
}
export function selectLocalMediaMessage(state: ArtworkState): string | undefined {
  return isLocalMediaSong(state.currentSong) && state.localMedia?.songKey === localMediaSongKey(state.currentSong)
    ? state.localMedia?.message || undefined : undefined;
}
/** 只有当前歌就是这首本地曲、且补全结果属于它时，来源标注才成立（避免过期补全串到别的歌上）。 */
export function selectLocalMediaLyricOrigin(state: ArtworkState): LocalMediaResult["lyricOrigin"] {
  return isLocalMediaSong(state.currentSong) && state.localMedia?.songKey === localMediaSongKey(state.currentSong)
    ? state.localMedia?.lyricOrigin : undefined;
}
/**
 * 来源文案：
 * - 同曲异唱必须写明「歌词来自谁的演唱版本」——这一档绝不能静默，用户可能在听原唱却看到别人的歌词；
 * - LRCLIB 是第三方歌词库，命中时同样标注来源；同曲同录音的常规补全无需提示。
 */
export function formatLyricOriginLabel(origin: LocalMediaResult["lyricOrigin"]): string | undefined {
  if (!origin) return undefined;
  const performer = origin.performer?.trim();
  if (origin.tier === "other-performer") {
    return performer ? `歌词来自 ${performer} 的演唱版本` : "歌词来自其他演唱版本";
  }
  return origin.source === "lrclib" ? "歌词来自 LRCLIB" : undefined;
}
export function selectLocalMediaLyricOriginLabel(state: ArtworkState): string | undefined {
  return formatLyricOriginLabel(selectLocalMediaLyricOrigin(state));
}
