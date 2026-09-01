import type { MusicInfo } from '@lx/core';
import {
  cancelDownload,
  downloadFile,
  setAudioCover,
  setAudioLyrics,
  setAudioMetadata,
  writeDownloadTextFile,
} from '@lx/tauri-bridge';
import { outboundRequest } from '@/services/outboundHttp';
import { resolvePlaybackUrl } from '@/services/playback/playbackResolver';
import { getSource } from '@/services/sources/sourceService';

export interface PreparedDownload {
  url: string;
  fileName: string;
  quality: string;
}

export type DownloadQuality = '128k' | '192k' | '320k' | 'flac' | 'flac24bit';

const ILLEGAL_FILENAME_RE = /[<>:"/\\|?*\x00-\x1F]/g;

export function sanitizeFileName(name: string): string {
  return name
    .replace(ILLEGAL_FILENAME_RE, '_')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 160) || '未知歌曲';
}

function inferExtFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const ext = parsed.pathname.split('.').pop()?.toLowerCase() ?? '';
    if (/^(mp3|flac|m4a|aac|wav|ogg|opus)$/.test(ext)) return ext;
  } catch {
    // Ignore malformed URLs and fall back below.
  }
  return null;
}

function inferExtFromQuality(quality: string): string | null {
  const normalized = quality.toLowerCase();
  if (normalized.includes('flac')) return 'flac';
  if (normalized.includes('m4a')) return 'm4a';
  if (normalized.includes('aac')) return 'aac';
  if (normalized.includes('ogg')) return 'ogg';
  if (normalized.includes('opus')) return 'opus';
  if (/\d+\s*k/.test(normalized)) return 'mp3';
  return null;
}

function buildLrcFileName(audioFileName: string): string {
  return audioFileName.replace(/\.[^.]+$/, '') + '.lrc';
}

function mimeFromUrl(url: string): string {
  try {
    const ext = new URL(url).pathname.split('.').pop()?.toLowerCase();
    if (ext === 'png') return 'image/png';
    if (ext === 'webp') return 'image/webp';
    if (ext === 'gif') return 'image/gif';
  } catch {
    // Ignore malformed cover URLs and default to jpeg below.
  }
  return 'image/jpeg';
}

async function fetchCoverDataUrl(music: MusicInfo): Promise<string | null> {
  const coverUrl = music.picUrl || music.img;
  if (!coverUrl || !/^https?:\/\//i.test(coverUrl)) return null;

  // 封面 CDN 域名由音源决定，属于运行时可变目标，走 Rust 出站代理而非静态白名单。
  const response = await outboundRequest(coverUrl, { method: 'GET', responseType: 'base64' });
  if (!response.ok) return null;

  const contentType = ((response.headers['content-type'] ?? '').split(';')[0]?.trim() || mimeFromUrl(coverUrl))
    .replace('image/jpg', 'image/jpeg');
  if (!/^image\/(jpeg|png|gif|bmp)$/i.test(contentType)) return null;

  return `data:${contentType};base64,${response.base64()}`;
}

async function fetchRawLyric(music: MusicInfo): Promise<string | null> {
  const source = getSource(music.source);
  if (!source) return null;

  const lyric = await source.getLyric(music);
  const raw = lyric.lyric?.trim();
  return raw || null;
}

let downloadTaskIdCounter = 0;

export function buildDownloadTaskId(music: MusicInfo): string {
  return `${music.source}_${music.id}_${Date.now()}_${downloadTaskIdCounter++}`;
}

export function buildDownloadBaseName(music: MusicInfo): string {
  return sanitizeFileName(`${music.name || '未知歌曲'} - ${music.singer || '未知歌手'}`);
}

export async function prepareDownload(
  music: MusicInfo,
  quality?: DownloadQuality,
): Promise<PreparedDownload> {
  if (music.isLocal) {
    throw new Error('本地音乐已经在设备上，无需下载');
  }

  const variants = Array.isArray((music as any).variants)
    ? ((music as any).variants as MusicInfo[])
    : undefined;
  const resolved = await resolvePlaybackUrl(music, variants, quality);

  if (!resolved?.url) {
    throw new Error('无法解析下载地址，可能受版权、登录或音质限制');
  }

  const ext = inferExtFromUrl(resolved.url) ?? inferExtFromQuality(resolved.quality) ?? 'mp3';
  const baseName = buildDownloadBaseName(music);

  return {
    url: resolved.url,
    fileName: `${baseName}.${ext}`,
    quality: resolved.quality,
  };
}

export async function runDownloadTask(
  taskId: string,
  url: string,
  directory: string,
  fileName: string,
): Promise<string> {
  return downloadFile(taskId, url, directory, fileName);
}

export async function cancelDownloadTask(taskId: string): Promise<boolean> {
  return cancelDownload(taskId);
}


export async function enhanceDownloadedFile(
  music: MusicInfo,
  savedPath: string,
  directory: string,
  fileName: string,
): Promise<void> {
  try {
    await setAudioMetadata(savedPath, {
      title: music.name || undefined,
      artist: music.singer || undefined,
      album: music.albumName || undefined,
    });
  } catch {}

  try {
    const coverData = await fetchCoverDataUrl(music);
    if (coverData) await setAudioCover(savedPath, coverData);
  } catch {}

  try {
    const lyric = await fetchRawLyric(music);
    if (!lyric) return;

    try {
      await setAudioLyrics(savedPath, lyric);
    } catch {}

    try {
      await writeDownloadTextFile(directory, buildLrcFileName(fileName), `${lyric}\n`);
    } catch {}
  } catch {}
}
