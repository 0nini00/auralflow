import type { MusicInfo } from "@lx/core";
import { localSongToMusicInfo, type LocalSong } from "./localMusicService";

/**
 * 只是 localSongs 的派生索引：播放期间按曲库记录重建本地曲元信息
 * （引擎逐帧推送的 currentMusic 会覆盖 store，所以重建必须回到曲库），不保存第二份曲库。
 *
 * 封面与歌词都只来自曲库记录本身（内嵌标签 / 同目录旁挂图 / 旁挂 `.lrc`）：
 * 记录里有就有、没有就没有，这里不触发任何网络补全。
 */
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
    // 标签与歌词字段必须参与比较：编辑过元数据或歌词之后，播放中重建的元信息要立刻带上新值。
    const fields = [
      "name", "singer", "albumName", "interval", "picUrl", "img",
      "localLyrics", "localLyricsTranslation", "localLyricsRomanization", "localPath",
    ] as const satisfies readonly (keyof MusicInfo)[];
    if (fields.every((key) => next[key] === music[key])) return music;
    // 正在播放的流地址必须保留；标签变化不触发取链或重载音频。
    return { ...music, ...next, url: music.url };
  };
}

export function synchronizeLocalQueue(queue: MusicInfo[], lookup: (song: MusicInfo) => MusicInfo): MusicInfo[] {
  const next = queue.map(lookup);
  return next.every((song, index) => song === queue[index]) ? queue : next;
}
