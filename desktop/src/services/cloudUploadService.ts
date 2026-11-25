import { open } from '@tauri-apps/plugin-dialog';
import {
  CLOUD_UPLOAD_BUCKET,
  buildCloudUploadCheckPayload,
  buildCloudUploadCompletePayload,
  buildCloudUploadTokenPayload,
  buildCloudUploadUrl,
  buildNeteasePcCookie,
  WyAuthExpiredError,
} from '@lx/core';
import {
  cloudFileMd5,
  cloudUploadFile,
  cloudUploadLbs,
  getAudioInfo,
} from '@lx/tauri-bridge';
import { getWyCookie } from '@/services/wyAccountService';
import { assertWyOk, sendWyWeapi } from '@/services/wyRequest';

export interface DesktopCloudAudioFile {
  path: string;
  fileName: string;
  size: number;
  title: string;
  artist: string;
  album: string;
  mimeType: string;
}

export type CloudUploadPhase = 'hashing' | 'checking' | 'uploading' | 'completing';

export interface CloudUploadCallbacks {
  taskId: string;
  onPhase: (phase: CloudUploadPhase) => void;
  isCancelled: () => boolean;
}

export interface CloudUploadOutcome {
  songId: string;
  needUpload: boolean;
}

export class CloudUploadCancelledError extends Error {
  constructor() {
    super('上传已取消');
    this.name = 'CloudUploadCancelledError';
  }
}

const AUDIO_EXTENSIONS = ['mp3', 'flac', 'wav', 'aac', 'm4a', 'ogg', 'opus', 'ape', 'aiff'];

const MIME_BY_EXTENSION: Record<string, string> = {
  mp3: 'audio/mpeg',
  flac: 'audio/flac',
  wav: 'audio/wav',
  aac: 'audio/aac',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  ape: 'audio/ape',
  aiff: 'audio/aiff',
};

interface WyCloudCheckResponse {
  code?: number;
  msg?: string;
  message?: string;
  needUpload?: boolean;
  songId?: number | string;
}

interface WyNosTokenResponse {
  code?: number;
  message?: string;
  result?: { token?: string; objectKey?: string; resourceId?: string };
}

interface WyCloudInfoResponse {
  code?: number;
  message?: string;
  songId?: number | string;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function fileNameOf(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function extensionOf(fileName: string): string {
  const match = /\.([^.]+)$/.exec(fileName);
  return match ? match[1].toLowerCase() : '';
}

async function cloudWeapi(path: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const rawCookie = await getWyCookie();
  if (!rawCookie || !/MUSIC_U=/.test(rawCookie)) {
    throw new WyAuthExpiredError('未登录网易云账号，无法操作云盘');
  }
  return sendWyWeapi(path, payload, buildNeteasePcCookie(rawCookie));
}

function throwIfCancelled(callbacks: CloudUploadCallbacks): void {
  if (callbacks.isCancelled()) throw new CloudUploadCancelledError();
}

/** 打开系统文件选择器并读取音频标签；取消时返回空数组。 */
export async function pickCloudAudioFiles(): Promise<DesktopCloudAudioFile[]> {
  const selected = await open({
    multiple: true,
    directory: false,
    filters: [{ name: '音频文件', extensions: AUDIO_EXTENSIONS }],
  });
  const paths = Array.isArray(selected) ? selected : selected ? [selected] : [];
  const files: DesktopCloudAudioFile[] = [];
  for (const path of paths) {
    const info = await getAudioInfo(path);
    const fileName = fileNameOf(path);
    const extension = extensionOf(fileName) || info.format.toLowerCase();
    files.push({
      path,
      fileName,
      size: info.size,
      title: info.title || fileName.replace(/\.[^.]+$/, ''),
      artist: info.artist,
      album: info.album,
      mimeType: MIME_BY_EXTENSION[extension] ?? 'application/octet-stream',
    });
  }
  return files;
}

/**
 * 上传一首音频到网易云云盘。
 *
 * weapi 参数由 shared core 构造；MD5、LBS 解析与 NOS 直传由 Rust 命令完成，
 * 文件内容不经过 WebView 内存。
 */
export async function uploadCloudAudio(
  file: DesktopCloudAudioFile,
  callbacks: CloudUploadCallbacks,
): Promise<CloudUploadOutcome> {
  throwIfCancelled(callbacks);
  callbacks.onPhase('hashing');
  const digest = await cloudFileMd5(file.path);
  if (!/^[a-f0-9]{32}$/i.test(digest.md5)) throw new Error('计算文件 MD5 失败');
  const fileSize = digest.size;
  throwIfCancelled(callbacks);

  callbacks.onPhase('checking');
  const check = await cloudWeapi('/cloud/upload/check', buildCloudUploadCheckPayload(fileSize, digest.md5));
  assertWyOk(check);
  const checked = check as WyCloudCheckResponse;
  const songId = asText(checked.songId) || String(checked.songId ?? '');
  if (!songId) throw new Error('云盘上传检查未返回歌曲 ID');

  const tokenBody = await cloudWeapi('/nos/token/alloc', buildCloudUploadTokenPayload(file.fileName, digest.md5));
  assertWyOk(tokenBody);
  const token = tokenBody as WyNosTokenResponse;
  const tokenResult = token.result;
  if (!tokenResult?.token || !tokenResult.objectKey || !tokenResult.resourceId) {
    throw new Error('获取云盘上传凭证失败');
  }
  throwIfCancelled(callbacks);

  // 服务端明确说 true 才传文件；字段缺失时按无需上传处理。
  const needUpload = checked.needUpload === true;
  if (needUpload) {
    const uploadBase = await cloudUploadLbs(CLOUD_UPLOAD_BUCKET);
    throwIfCancelled(callbacks);
    callbacks.onPhase('uploading');
    await cloudUploadFile(
      callbacks.taskId,
      file.path,
      buildCloudUploadUrl(uploadBase, tokenResult.objectKey),
      tokenResult.token,
      digest.md5,
      file.mimeType,
      fileSize,
    );
    throwIfCancelled(callbacks);
  }

  callbacks.onPhase('completing');
  const infoBody = await cloudWeapi(
    '/upload/cloud/info/v2',
    buildCloudUploadCompletePayload({
      md5: digest.md5,
      songId,
      fileName: file.fileName,
      title: file.title,
      artist: file.artist || '未知艺术家',
      album: file.album || '未知专辑',
      resourceId: tokenResult.resourceId,
    }),
  );
  assertWyOk(infoBody);
  const info = infoBody as WyCloudInfoResponse;
  const finalSongId = asText(info.songId) || songId;
  const published = await cloudWeapi('/cloud/pub/v2', { songid: finalSongId });
  assertWyOk(published);

  return { songId: finalSongId, needUpload };
}

/** 从云盘删除一首歌；只删云端记录，不动本地下载。 */
export async function deleteCloudSong(songId: string): Promise<void> {
  const id = songId.trim();
  if (!id) throw new Error('缺少云盘歌曲 ID');
  const body = await cloudWeapi('/cloud/del', { songIds: [id] });
  assertWyOk(body);
}
