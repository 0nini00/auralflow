import type { LyricOrigin } from "@lx/core";

/**
 * 标注停留时长。同曲异唱是「你听到的可能不是原唱版本」这种知情提示——比一闪过要好懂，
 * 但也不必常驻：常驻会一直压住歌词，而它在歌词刚出现的那一刻最有意义。
 */
export const LYRIC_ORIGIN_NOTE_HOLD_MS = 10_000;

export interface LyricOriginNote {
  text: string;
  holdMs: number;
}

/**
 * 只有同曲异唱档才产生标注：那一档用户可能在听原唱却看到别人的歌词，必须被告知。
 * 同一录音档不需要提示（取自哪个平台只是出处，不影响歌词本身对不对）。
 */
export function buildLyricOriginNote(origin: LyricOrigin | null | undefined): LyricOriginNote | undefined {
  if (!origin || origin.tier !== "other-performer") return undefined;
  const performer = origin.performer?.trim();
  if (!performer) return undefined;
  return { text: `歌词来自 ${performer} 的演唱版本`, holdMs: LYRIC_ORIGIN_NOTE_HOLD_MS };
}
