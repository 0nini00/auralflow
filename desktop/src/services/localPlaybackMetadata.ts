import type { MusicInfo } from "@lx/core";
import { localSongToMusicInfo, type LocalSong } from "./localMusicService";

/** 只是 localSongs 的派生索引，不保存第二份曲库或用户选择。 */
export function createLocalPlaybackLookup(getSongs: () => readonly LocalSong[]) {
  let snapshot: readonly LocalSong[] | null = null;
  let index = new Map<string, LocalSong>();
  return (music: MusicInfo): MusicInfo => {
    if (music.source !== "local" || !music.isLocal) return music;
    const songs = getSongs();
    if (songs !== snapshot) {
      snapshot = songs;
      index = new Map(songs.map((song) => [song.id, song]));
    }
    const song = index.get(music.id);
    if (!song) return music;
    const next = localSongToMusicInfo(song);
    const fields = ["name", "singer", "albumName", "interval", "picUrl", "img", "localLyrics", "localLyricsTranslation", "localLyricsRomanization", "localPath"] as const;
    if (fields.every((key) => next[key] === music[key])) return music;
    // 正在播放的流地址必须保留；标签变化不触发取链或重载音频。
    return { ...music, ...next, url: music.url };
  };
}

export function synchronizeLocalQueue(queue: MusicInfo[], lookup: (song: MusicInfo) => MusicInfo): MusicInfo[] {
  const next = queue.map(lookup);
  return next.every((song, index) => song === queue[index]) ? queue : next;
}
