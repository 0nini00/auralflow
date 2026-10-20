import type { LocalSong } from './localMusicService';

/**
 * 手动编辑本地曲的草稿模型。
 *
 * 这个文件原来叫 `manualMediaMatchModel`：本地曲缺歌词时会「搜平台候选、挑一条套上去」，
 * 所以需要候选预览、时长差、请求令牌这些配套。匹配整条链路删除后，它只剩三件事——
 * 把草稿算成补丁、给异步通道发令牌、把错误转成人话。名字跟着去掉 Match，
 * 免得后来的人以为这里还藏着一条联网路径。
 */

export interface ManualLyricExtras {
  translation?: string;
  romanization?: string;
}

export interface ManualMediaDraft extends ManualLyricExtras {
  title: string;
  artist: string;
  album: string;
  /** undefined 表示未编辑，空串表示用户明确清除。 */
  lyrics?: string;
}

export function buildManualMediaPatch(song: LocalSong, draft: ManualMediaDraft): Partial<LocalSong> {
  const patch: Partial<LocalSong> = {};
  for (const field of ['title', 'artist', 'album'] as const) {
    if (draft[field] !== song[field]) patch[field] = draft[field];
  }
  if (draft.lyrics !== undefined) {
    patch.lyricsOverride = draft.lyrics;
    if (!draft.lyrics.trim()) {
      // 清空歌词时连带清掉辅助轨：留着上一份词的翻译/罗马音，下一份词会误用它们。
      patch.lyricsTranslationOverride = "";
      patch.lyricsRomanizationOverride = "";
    } else {
      if (draft.translation !== undefined) patch.lyricsTranslationOverride = draft.translation;
      if (draft.romanization !== undefined) patch.lyricsRomanizationOverride = draft.romanization;
    }
  }
  return patch;
}

/** 每个异步通道独立发令牌；关闭、切歌、改查询时立即作废。 */
export class ManualMediaRequestToken {
  private generation = 0;
  next(): () => boolean {
    const generation = ++this.generation;
    return () => generation === this.generation;
  }
  invalidate(): void { this.generation += 1; }
}

export function manualMediaError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
