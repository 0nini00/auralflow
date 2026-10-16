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

/**
 * 标注的停留时长。同曲异唱是「你听到的可能是别人的词」这种知情提示，停留久一点；
 * 「来自 LRCLIB」只是出处，扫一眼就够。两者都不常驻——常驻会变成遮住歌词的视觉噪音，
 * 而标注在歌词刚出现的那一刻最有意义。
 */
export const LYRIC_ORIGIN_NOTE_HOLD_MS = { otherPerformer: 10_000, source: 4_000 } as const;

export interface LyricOriginNote {
  text: string;
  holdMs: number;
}

export function buildLyricOriginNote(origin: LocalMediaResult["lyricOrigin"]): LyricOriginNote | undefined {
  const text = formatLyricOriginLabel(origin);
  if (!text || !origin) return undefined;
  return {
    text,
    holdMs: origin.tier === "other-performer"
      ? LYRIC_ORIGIN_NOTE_HOLD_MS.otherPerformer
      : LYRIC_ORIGIN_NOTE_HOLD_MS.source,
  };
}

/**
 * 同一份来源必须返回**同一个对象**。
 *
 * zustand v5 的 `useStore` 内部就是 `useSyncExternalStore`，没有 equalityFn：选择器每次新建
 * 对象，React 就认为「快照一直在变」，于是无限重渲染并抛出 Maximum update depth exceeded
 * （实测：播放带来源标注的本地曲时整屏崩在错误边界上）。按来源对象的身份缓存即可——来源对象
 * 来自补全结果或磁盘缓存，同一份匹配期间引用不变，换一份匹配自然得到新对象。
 * 用 WeakMap 是为了不拖住已作废的来源对象，也不随补全次数无限增长。
 *
 * 返回 `undefined`（没有来源）同样是稳定值，React 的比较不会因此触发重渲染。
 */
const noteCache = new WeakMap<object, LyricOriginNote>();

export function selectLocalMediaLyricOriginNote(state: ArtworkState): LyricOriginNote | undefined {
  const origin = selectLocalMediaLyricOrigin(state);
  if (!origin) return undefined;
  const cached = noteCache.get(origin);
  if (cached) return cached;
  const note = buildLyricOriginNote(origin);
  if (!note) return undefined;
  noteCache.set(origin, note);
  return note;
}
