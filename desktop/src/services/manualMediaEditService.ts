import { setAudioLyrics, setAudioMetadata } from '@lx/tauri-bridge';
import type { LocalSong } from './localMusicService';
import { buildManualMediaPatch, manualMediaError, type ManualMediaDraft } from './manualMediaEditModel';

/**
 * 手动编辑本地曲的保存路径。
 *
 * 原来这个文件叫 `manualMediaMatchService`，一半是「搜平台候选并取它的歌词」
 * （`searchManualMedia` / `getManualLyrics`），另一半就是这里的保存。匹配链路删除后
 * 只剩保存：歌词由用户自己写进表单，或来自文件内嵌标签与同目录旁挂 `.lrc`。
 *
 * 写文件仍然逐字段推进并记录真实成功的部分——写入不可撤回，调用方必须能显示
 * 「已完成哪几项、哪些没做」。
 */

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
      // 辅助轨以补丁为准：清空歌词时补丁里是空串，必须把这些清空也如实记进 appliedPatch。
      if (patch.lyricsTranslationOverride !== undefined) appliedPatch.lyricsTranslationOverride = patch.lyricsTranslationOverride;
      if (patch.lyricsRomanizationOverride !== undefined) appliedPatch.lyricsRomanizationOverride = patch.lyricsRomanizationOverride;
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
