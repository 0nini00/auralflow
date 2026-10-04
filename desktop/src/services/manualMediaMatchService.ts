import { mergeTranslation, mergeRomanization, parseLyricSource, type LyricLine, type MusicInfo } from '@lx/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { readFile, stat } from '@tauri-apps/plugin-fs';
import { saveManualCover, setAudioCover, setAudioLyrics, setAudioMetadata } from '@lx/tauri-bridge';
import { getSource } from './sources/sourceService';
import { outboundRequest } from './outboundHttp';
import type { LocalSong } from './localMusicService';
import { buildManualMediaPatch, manualMediaError, type LocalCoverSelection, type ManualMediaDraft } from './manualMediaMatchModel';

export type ManualMediaSource = 'wy' | 'tx';
export interface ManualLyricPreview { raw: string; lines: LyricLine[]; translation?: string; romanization?: string }
export interface ManualCoverPreview { remoteUrl: string; previewUrl: string }
const MAX_COVER_BYTES = 10 * 1024 * 1024;

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

function remoteImageUrl(value: string | undefined): string {
  if (!value) throw new Error('该候选没有封面');
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('封面必须是无凭据的 HTTP(S) 地址');
  }
  return url.href;
}

function imageMime(bytes: Uint8Array): string {
  const starts = (...prefix: number[]) => prefix.every((byte, index) => bytes[index] === byte);
  if (starts(137, 80, 78, 71, 13, 10, 26, 10)) return 'image/png';
  if (starts(255, 216, 255)) return 'image/jpeg';
  if (starts(71, 73, 70, 56)) return 'image/gif';
  if (starts(66, 77)) return 'image/bmp';
  if (starts(82, 73, 70, 70) && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  throw new Error('封面不是受支持的 PNG/JPEG/GIF/BMP/WebP 图片');
}

export async function getManualCover(candidate: MusicInfo): Promise<ManualCoverPreview> {
  const detail = await builtinSource(candidate.source).getMusicDetail(candidate);
  const remoteUrl = remoteImageUrl(detail.picUrl || detail.img);
  const response = await outboundRequest(remoteUrl, { method: 'GET', responseType: 'base64', maxBytes: MAX_COVER_BYTES });
  if (!response.ok) throw new Error(`封面下载失败：HTTP ${response.status}`);
  const base64 = response.base64();
  if (base64.length > Math.ceil(MAX_COVER_BYTES / 3) * 4) throw new Error('封面文件过大（上限 10 MB）');
  const binary = atob(base64);
  if (binary.length > MAX_COVER_BYTES) throw new Error('封面文件过大（上限 10 MB）');
  const mime = imageMime(Uint8Array.from(binary.slice(0, 12), (char) => char.charCodeAt(0)));
  return { remoteUrl, previewUrl: `data:${mime};base64,${base64}` };
}

function localCover(path: string): LocalCoverSelection {
  if (!/^(?:[a-z]:[\\/]|\\\\|\/)/i.test(path) || /[\0\r\n]/.test(path)) {
    throw new Error('封面缓存未返回有效本机路径');
  }
  return { path, assetUrl: convertFileSrc(path) };
}

export async function cacheManualCover(preview: ManualCoverPreview): Promise<LocalCoverSelection> {
  // 保存已预览的原始字节，不二次下载会变化的URL，也不放入自动淘汰目录。
  remoteImageUrl(preview.remoteUrl);
  return localCover(await saveManualCover(preview.previewUrl));
}

async function readCoverBytes(path: string): Promise<Uint8Array> {
  localCover(path);
  const info = await stat(path);
  if (info.size > MAX_COVER_BYTES) throw new Error('封面文件过大（上限 10 MB）');
  const bytes = await readFile(path);
  if (bytes.length > MAX_COVER_BYTES) throw new Error('封面文件过大（上限 10 MB）');
  imageMime(bytes);
  return bytes;
}

export async function pickManualCover(): Promise<LocalCoverSelection | null> {
  const path = await open({
    title: '选择封面图片', directory: false, multiple: false,
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'] }],
  });
  if (path === null) return null;
  if (typeof path !== 'string') throw new Error('请选择一张本机封面图片');
  const dataUrl = await coverDataUrl(localCover(path));
  return localCover(await saveManualCover(dataUrl));
}

async function coverDataUrl(cover: LocalCoverSelection): Promise<string> {
  const bytes = await readCoverBytes(cover.path);
  let binary = '';
  const chunkSize = 8192;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return `data:${imageMime(bytes)};base64,${btoa(binary)}`;
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
  if (draft.cover && localCover(draft.cover.path).assetUrl !== draft.cover.assetUrl) {
    throw new Error('封面必须使用本机短路径');
  }
  const patch = buildManualMediaPatch(song, draft);
  const assertCurrent = () => { if (!isCurrent()) throw new Error('编辑已关闭或已切换歌曲，后续写入已停止'); };
  assertCurrent();
  if (!writeToFile) return patch;
  const appliedPatch: Partial<LocalSong> = {};
  const completed: string[] = [];
  let step = '读取封面';
  try {
    const coverData = draft.cover ? await coverDataUrl(draft.cover) : undefined;
    assertCurrent();
    const tags = Object.fromEntries(['title', 'artist', 'album'].filter((field) => field in patch).map((field) => [field, patch[field as keyof LocalSong]]));
    if (Object.keys(tags).length) {
      step = '标题/歌手/专辑';
      await setAudioMetadata(song.path, tags);
      Object.assign(appliedPatch, tags);
      completed.push(step);
      assertCurrent();
    }
    if (draft.cover && coverData) {
      step = '封面';
      await setAudioCover(song.path, coverData);
      appliedPatch.coverOverride = draft.cover.assetUrl;
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
