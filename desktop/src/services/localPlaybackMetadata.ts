import type { MusicInfo } from "@lx/core";
import { localSongToMusicInfo, type LocalSong } from "./localMusicService";

/**
 * 播放期间从封面缓存读到的本地曲封面（`source:id` → asset 地址）。
 *
 * 必须留在模块级：引擎随后才加载的那份曲目对象本身没有封面，只能靠这里在每次
 * 元信息重建时把它补回去，否则「先查到封面、后装载曲目」这条时序会把封面丢掉。
 * 只记命中、不记未命中 —— 记了未命中，本次会话里之后落盘的封面就再也读不到。
 */
const cachedLocalCovers = new Map<string, string>();

/** 记住某首本地曲刚补上的封面地址（会话内有效，不落盘）。 */
export function rememberLocalCover(music: MusicInfo, coverUrl: string | undefined): void {
  if (!coverUrl) return;
  cachedLocalCovers.set(`${music.source}:${music.id}`, coverUrl);
}

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
    // 曲库记录没有封面时，用「播放期间读到的缓存封面」或曲目上已有的封面兜底：
    // coverOverride 已经写进 next，手动封面天然优先。
    if (!next.picUrl && !next.img) {
      const remembered = cachedLocalCovers.get(`${music.source}:${music.id}`);
      next.picUrl = remembered ?? music.picUrl;
      next.img = remembered ?? music.img;
    }
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
