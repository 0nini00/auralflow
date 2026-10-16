import type { MusicInfo } from "@lx/core";
import { localSongToMusicInfo, type LocalMusicInfo, type LocalSong } from "./localMusicService";

/**
 * 只是 localSongs 的派生索引：播放期间按曲库记录重建本地曲元信息
 * （引擎逐帧推送的 currentMusic 会覆盖 store，所以重建必须回到曲库），不保存第二份曲库。
 *
 * 封面不再是这里的兜底项：它只来自曲库记录本身（内嵌标签 / 同目录旁挂图），
 * 记录里有就有、没有就没有，绝不再触发任何网络补图。
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
    // 歌词选择三字段必须参与比较：用户改了 mode / 指纹 / 来源标注之后，播放中重建的元信息
    // 要立刻带上新结论（否则歌词服务看到的还是上一次的 auto 或旧选择）。
    const fields: readonly (keyof LocalMusicInfo)[] = ["name", "singer", "albumName", "interval", "picUrl", "img", "localLyrics", "localLyricsTranslation", "localLyricsRomanization", "localPath", "lyricsMode", "lyricsFingerprint", "lyricsSourceLabel"];
    // 引擎逐帧回写的 music 可能不带本地扩展字段（MusicInfo 不认识它们），读之前统一按 LocalMusicInfo 看待。
    const previous = music as LocalMusicInfo;
    if (fields.every((key) => next[key] === previous[key])) return music;
    // 正在播放的流地址必须保留；标签变化不触发取链或重载音频。
    return { ...music, ...next, url: music.url };
  };
}

export function synchronizeLocalQueue(queue: MusicInfo[], lookup: (song: MusicInfo) => MusicInfo): MusicInfo[] {
  const next = queue.map(lookup);
  return next.every((song, index) => song === queue[index]) ? queue : next;
}
