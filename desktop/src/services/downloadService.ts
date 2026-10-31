import type { MusicInfo } from '@lx/core';
import { buildSongKey, cloudFileExtension, cloudQualityLabel, getPlaybackQualityRank, orderPlaybackCandidates } from '@lx/core';
import {
  cancelDownload,
  downloadFile,
  setAudioCover,
  setAudioLyrics,
  setAudioMetadata,
  writeDownloadTextFile,
} from '@lx/tauri-bridge';
import { outboundRequest } from '@/services/outboundHttp';
import { buildStreamHeaders, resolvePlaybackUrl } from '@/services/playback/playbackResolver';
import { isLocalCachedPlaybackUrl } from '@/services/persistentCache';
import { getSource } from '@/services/sources/sourceService';
import { useVariantPinStore } from '@/stores/variantPinStore';
import { logger } from '@/services/logger';

export interface PreparedDownload {
  url: string;
  fileName: string;
  quality: string;
  /** 防盗链请求头，交给 Rust download_file（白名单过滤后附加）。 */
  headers?: Record<string, string>;
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
  if (!/^image\/(jpeg|png|gif|bmp|webp)$/i.test(contentType)) return null;

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

  // 云盘曲不做转码：任何档位请求返回的都是同一份上传文件，音质选择没有意义。
  // 因此忽略调用方传来的档位（不发「更高档位」的无效请求），也不做档位下限校验；
  // 文件名扩展名取上传文件的真实扩展名，避免「.mp3 里装着 FLAC」。
  const isCloudSong = music.wyCloud === true;
  const requestedQuality = isCloudSong ? undefined : quality;

  // 下载与播放共用候选链语义：搜索变体（pin 首选置顶）均可作为下载目标。
  //
  // 但必须 cacheMedia: false：播放解析默认会把命中磁盘的整曲缓存换成本地
  // `asset.localhost` 地址（见 cacheResolvedPlaybackMedia），而下载落盘走
  // Rust download_file，出站校验会拒绝 localhost；即使不拒绝，也会变成
  // 「为了下载再缓存一遍整首歌」的重复下载。
  const variants = orderPlaybackCandidates(
    music,
    useVariantPinStore.getState().getPinnedVariantKey(buildSongKey(music)),
  );
  // 下载必须拿到「用户选的那一档」：exactQuality 关掉逐档下调，
  // 否则选 flac 会静默下成 320k，而文件名与库里的音质标签还写着 flac。
  // 只有用户显式选过音质才收紧；批量下载/未选音质时仍按默认音质的完整降级链，
  // 否则「下载全部」会有一堆歌直接失败。云盘曲本身没有档位概念，不参与收紧。
  const exactQuality = !isCloudSong && quality != null;
  let resolved = await resolvePlaybackUrl(music, variants, requestedQuality, {
    cacheMedia: false,
    exactQuality,
  });
  // 持久化缓存里可能已经存着本地 media 地址（此前播放时写入）。下载必须拿到
  // 远端直链，命中本地条目就绕过缓存重新解析一次，而不是把死路交给 Rust。
  if (isLocalCachedPlaybackUrl(resolved.url)) {
    resolved = await resolvePlaybackUrl(music, variants, requestedQuality, {
      bypassCache: true,
      cacheMedia: false,
      exactQuality,
    });
  }

  if (!resolved?.url) {
    throw new Error('无法解析下载地址，可能受版权、登录或音质限制');
  }
  if (isLocalCachedPlaybackUrl(resolved.url)) {
    throw new Error('解析结果只有本地缓存地址，无法作为下载源，请稍后重试');
  }
  // 精确音质下仍可能拿到更低档（音源只给了低码率）。宁可报错让用户换档，
  // 也不要把 320k 文件命名成 .flac 混进音乐库。
  // 云盘曲跳过：它没有「请求档位」这回事，文件是什么就是什么。
  if (!isCloudSong && quality && getPlaybackQualityRank(resolved.quality) < getPlaybackQualityRank(quality)) {
    throw new Error(
      `该歌曲没有 ${quality} 音质的下载源（实际只解析到 ${resolved.quality}），请换一个音质重试`,
    );
  }

  const ext = (isCloudSong ? cloudFileExtension(music) : null)
    ?? inferExtFromUrl(resolved.url)
    ?? (isCloudSong ? 'mp3' : inferExtFromQuality(resolved.quality) ?? 'mp3');
  const baseName = buildDownloadBaseName(music);

  return {
    url: resolved.url,
    fileName: `${baseName}.${ext}`,
    // 云盘曲展示上传文件的真实码率标签，而不是本次请求的档位。
    quality: isCloudSong
      ? (cloudQualityLabel(music.cloudMeta?.bitrate) ?? '原文件')
      : resolved.quality,
    // 防盗链按「实际解析到的变体」取 Referer：主源可能解析到另一平台的变体，
    // 用主源 Referer 会被对端 CDN 判 403，与播放侧探活同一套语义。
    headers: buildStreamHeaders(resolved.music.source),
  };
}

export async function runDownloadTask(
  taskId: string,
  url: string,
  directory: string,
  fileName: string,
  headers?: Record<string, string>,
): Promise<string> {
  return downloadFile(taskId, url, directory, fileName, headers);
}

export async function cancelDownloadTask(taskId: string): Promise<boolean> {
  return cancelDownload(taskId);
}


export async function enhanceDownloadedFile(
  music: MusicInfo,
  savedPath: string,
  directory: string,
  fileName: string,
): Promise<string[]> {
  // 后处理是「尽力而为」：音频文件此时已经落盘成功，任何一步失败都不该把任务判成失败
  // （那会让用户以为整首歌没下下来）。但也不能静默吞掉——失败必须回报给调用方显示状态，
  // 这是仓库既有的不变量：异步失败要么显式抛出、要么显示状态，不做静默 fallback。
  // 云盘曲按「上传文件原样」落盘：文件可能自带封面与内嵌歌词，重写 ID3 /
  // 补封面 / 补歌词会覆盖掉这些信息，而用户的预期是「云盘里是什么就下什么」。
  if (music.wyCloud === true) return [];

  const warnings: string[] = [];
  // 同名文件被 Rust 侧重命名成 "name (1).ext" 时，旁挂歌词必须跟着实际文件名走，
  // 否则会出现音频叫 "name (1).ext"、歌词叫 "name.lrc" 的错位。
  const actualFileName = savedPath.split(/[\\/]/).pop() || fileName;
  // 后处理失败既回报给调用方显示状态（warnings），也写进运行日志：用户在设置页点
  // 「打开日志目录」就能看到原因，而不是只有界面上的一句话。
  const reportWarning = (reason: string) => {
    logger.warn(`[下载] ${reason}`);
    warnings.push(reason);
  };

  try {
    await setAudioMetadata(savedPath, {
      title: music.name || undefined,
      artist: music.singer || undefined,
      album: music.albumName || undefined,
    });
  } catch (error) {
    reportWarning(`写入音频标签失败：${formatReason(error)}`);
  }

  try {
    const coverData = await fetchCoverDataUrl(music);
    if (coverData) await setAudioCover(savedPath, coverData);
  } catch (error) {
    reportWarning(`嵌入封面失败：${formatReason(error)}`);
  }

  try {
    const lyric = await fetchRawLyric(music);
    if (lyric) {
      try {
        await setAudioLyrics(savedPath, lyric);
      } catch (error) {
        reportWarning(`写入内嵌歌词失败：${formatReason(error)}`);
      }
      try {
        await writeDownloadTextFile(directory, buildLrcFileName(actualFileName), `${lyric}\n`);
      } catch (error) {
        reportWarning(`写入歌词文件失败：${formatReason(error)}`);
      }
    }
  } catch (error) {
    reportWarning(`获取歌词失败：${formatReason(error)}`);
  }

  return warnings;
}

/** 把任意抛出物压成一行可展示的原因。 */
function formatReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
