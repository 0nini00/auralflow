import type { LocalSong } from './localMusicService';

export interface LocalCoverSelection {
  path: string;
  assetUrl: string;
}

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
  cover?: LocalCoverSelection;
}

export function buildManualMediaPatch(song: LocalSong, draft: ManualMediaDraft): Partial<LocalSong> {
  const patch: Partial<LocalSong> = {};
  for (const field of ['title', 'artist', 'album'] as const) {
    if (draft[field] !== song[field]) patch[field] = draft[field];
  }
  if (draft.lyrics !== undefined) {
    patch.lyricsOverride = draft.lyrics;
    if (draft.translation !== undefined) patch.lyricsTranslationOverride = draft.translation;
    if (draft.romanization !== undefined) patch.lyricsRomanizationOverride = draft.romanization;
  }
  if (draft.cover) patch.coverOverride = draft.cover.assetUrl;
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

export function formatManualDuration(seconds?: number): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return '时长未知';
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
