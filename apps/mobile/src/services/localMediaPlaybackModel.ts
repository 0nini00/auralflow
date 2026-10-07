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
