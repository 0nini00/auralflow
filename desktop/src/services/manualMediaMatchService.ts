import { mergeTranslation, mergeRomanization, parseLyricSource, type LyricLine, type MusicInfo } from '@lx/core';
import { setAudioLyrics, setAudioMetadata } from '@lx/tauri-bridge';
import { getSource } from './sources/sourceService';
import type { LocalSong } from './localMusicService';
import { buildManualMediaPatch, manualMediaError, type ManualMediaDraft } from './manualMediaMatchModel';

/**
 * 手动匹配平台候选：只取候选的**歌词**（标题/歌手/专辑另在编辑器里手输）。
 *
 * 这里刻意不再碰封面：本地曲封面只能来自音频文件自己（内嵌标签 / 同目录旁挂图），
 * 所以没有「预览平台封面并落盘成用户资料」这条路，也就没有对应的目录与 IO。
 */
export type ManualMediaSource = 'wy' | 'tx';
export interface ManualLyricPreview { raw: string; lines: LyricLine[]; translation?: string; romanization?: string }

function builtinSource(id: string) {
  if (id !== 'wy' && id !== 'tx') throw new Error('手动匹配仅支持网易云和 QQ 音乐');
  const source = getSource(id);
  if (!source) throw new Error(`内置音源未注册：${id}`);
  return source;
}

export async function searchManualMedia(source: ManualMediaSource, query: string): Promise<MusicInfo[]> {
  if (!query.trim()) throw new Error('请输入搜索关键词');
  const result = await builtinSource(source).search(query.trim(), 'song', 1);
  if (!Array.isArray(result.songs)) throw new Error('音源未返回有效歌曲列表');
  if (result.songs.some((song) => song.source !== source || !song.id || typeof song.name !== 'string')) {
    throw new Error('音源返回了无效候选歌曲');
  }
  return result.songs;
}

export async function getManualLyrics(candidate: MusicInfo): Promise<ManualLyricPreview> {
  const result = await builtinSource(candidate.source).getLyric(candidate);
  const raw = result.yrc?.trim() ? result.yrc : result.lyric;
  if (!raw?.trim()) throw new Error('该候选没有可用歌词');
  const lines = mergeRomanization(mergeTranslation(parseLyricSource({ content: raw, type: result.yrc?.trim() ? 'yrc' : 'auto' }), result.tlyric), result.romaLyric);
  if (!lines.some((line) => line.text.trim())) throw new Error('该候选歌词无法解析或内容为空');
  return { raw, lines, translation: result.tlyric, romanization: result.romaLyric };
}

export class ManualMediaSaveError extends Error {
  constructor(message: string, readonly appliedPatch: Partial<LocalSong>) {
    super(message);
    this.name = 'ManualMediaSaveError';
  }
}

/** 逐步记录真实成功的写入；后续失败不可回滚，调用方必须显示部分成功状态。 */
export async function saveManualMediaEdits(
  song: LocalSong, draft: ManualMediaDraft, writeToFile: boolean, isCurrent: () => boolean,
): Promise<Partial<LocalSong>> {
  if (!song.isLocal || !song.path) throw new Error('只能编辑本地歌曲');
  if (!draft.title.trim()) throw new Error('标题不能为空');
  const patch = buildManualMediaPatch(song, draft);
  const assertCurrent = () => { if (!isCurrent()) throw new Error('编辑已关闭或已切换歌曲，后续写入已停止'); };
  assertCurrent();
  if (!writeToFile) return patch;
  const appliedPatch: Partial<LocalSong> = {};
  const completed: string[] = [];
  let step = '标题/歌手/专辑';
  try {
    const tags = Object.fromEntries(['title', 'artist', 'album'].filter((field) => field in patch).map((field) => [field, patch[field as keyof LocalSong]]));
    if (Object.keys(tags).length) {
      await setAudioMetadata(song.path, tags);
      Object.assign(appliedPatch, tags);
      completed.push(step);
      assertCurrent();
    }
    if (draft.lyrics !== undefined) {
      step = '歌词';
      await setAudioLyrics(song.path, draft.lyrics);
      appliedPatch.lyricsOverride = draft.lyrics;
      appliedPatch.embeddedLyrics = draft.lyrics;
      if (draft.translation !== undefined) appliedPatch.lyricsTranslationOverride = draft.translation;
      if (draft.romanization !== undefined) appliedPatch.lyricsRomanizationOverride = draft.romanization;
      completed.push(step);
      assertCurrent();
    }
    return appliedPatch;
  } catch (error) {
    throw new ManualMediaSaveError(
      `${step}失败：${manualMediaError(error)}。已完成：${completed.join('、') || '无'}。文件写入可能已部分生效，不能撤回；未完成项未应用到本机曲库。`,
      appliedPatch,
    );
  }
}
