import AsyncStorage from "@react-native-async-storage/async-storage";
import RNFS from "react-native-fs";
import type { LyricLine, MusicInfo } from "@lx/core";
import { fetchSongLyrics, resolveSongUrl } from "./musicApi";
import { resolveBiliSongUrl } from "./biliService";
import { embedId3Tag, type Id3Cover } from "./id3TagWriter";
import { base64ToBytes, bytesToBase64 } from "@/utils/base64";
export { formatDownloadSize } from "./downloadSizeFormatter";

/**
 * 下载管理服务
 *
 * 下载目录：RNFS.DocumentDirectoryPath/auralflow/downloads/
 * 文件命名：{source}-{id}-{quality}.{ext}
 * 返回本地 file:// 路径，供离线播放使用。
 */

/** 下载音质选项（与桌面端保持一致） */
export type DownloadQuality = "128k" | "192k" | "320k" | "flac" | "flac24bit";

const DOWNLOAD_ROOT_DIR = `${RNFS.DocumentDirectoryPath}/auralflow`;

const DOWNLOAD_DIR = `${DOWNLOAD_ROOT_DIR}/downloads`;

const DOWNLOAD_STORE_KEY = "auralflow.mobile.downloads";



export { formatDownloadDirectoryLabel } from "./downloadDirectoryModel";

/** 当前设备下载目录（绝对路径，供 UI 展示；系统限制下不可改）。 */
export function getDownloadDirectoryPath(): string {
  return DOWNLOAD_DIR;
}

/** 已下载条目：包含原始歌曲信息、本地路径与下载时间 */
export interface DownloadedItem {
  song: MusicInfo;
  /** 下载时选择的音质；旧记录可能缺失，调用侧按 320k 兼容。 */
  quality?: DownloadQuality;
  /** 本地 file:// 路径 */
  localPath: string;
  /** 下载文件大小，旧记录可能缺失。 */
  fileSize?: number;
  /** 下载时间戳（ms） */
  downloadDate: number;
}

/** 下载进度回调参数 */
export interface DownloadProgressInfo {
  /** 0 ~ 1 */
  progress: number;
  bytesWritten: number;
  contentLength: number;
}

/** 进行中的下载任务句柄，用于取消 */
interface ActiveJob {
  jobId: number;
}

const activeJobs = new Map<string, ActiveJob>();

function songKey(song: MusicInfo): string {
  return `${song.source}:${song.id}`;
}

function downloadJobKey(song: MusicInfo, quality: DownloadQuality): string {
  return `${songKey(song)}:${quality}`;
}

/**
 * 根据音质推断文件扩展名：无损系列为 flac，其余为 mp3。
 * B站音源为 DASH m4s/m4a，单独处理。
 */
function qualityExt(quality: DownloadQuality): string {
  if (quality === "flac" || quality === "flac24bit") return "flac";
  return "mp3";
}

/**
 * 从 URL 路径推断真实扩展名，失败返回 null。
 */
function inferExtFromUrl(url: string): string | null {
  try {
    const ext = new URL(url).pathname.split(".").pop()?.toLowerCase() ?? "";
    if (/^(mp3|flac|m4a|m4s|aac|wav|ogg|opus)$/.test(ext)) {
      // B站 DASH 流为 m4s，本地保存统一用 m4a 便于播放器识别
      return ext === "m4s" ? "m4a" : ext;
    }
  } catch {
    // 忽略非法 URL
  }
  return null;
}

function downloadFileName(song: MusicInfo, quality: DownloadQuality = "320k"): string {
  const ext = qualityExt(quality);
  return `${song.source}-${song.id}-${quality}.${ext}`;
}

function sidecarLrcPath(filePath: string): string {
  return filePath.replace(/\.[^/.]+$/, ".lrc");
}

function formatLrcTimestamp(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const wholeSeconds = Math.floor(safeSeconds % 60);
  const milliseconds = Math.round((safeSeconds - Math.floor(safeSeconds)) * 1000);
  return `${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}

function formatLyricLine(line: LyricLine): string[] {
  const text = line.text.trim();
  const translation = line.tr?.trim();
  if (!text && !translation) return [];

  const timeTag = `[${formatLrcTimestamp(line.time)}]`;
  return [
    text ? `${timeTag}${text}` : null,
    translation ? `${timeTag}${translation}` : null,
  ].filter((item): item is string => item != null);
}

export function formatLyricsAsLrc(lines: LyricLine[]): string {
  return lines.flatMap(formatLyricLine).join("\n");
}

function downloadFilePath(song: MusicInfo, quality: DownloadQuality = "320k"): string {
  return `${DOWNLOAD_DIR}/${downloadFileName(song, quality)}`;
}

function downloadFileUri(song: MusicInfo, quality: DownloadQuality = "320k"): string {
  return `file://${downloadFilePath(song, quality)}`;
}

/**
 * 确保下载目录存在
 */
export async function ensureDownloadDirectory(): Promise<string> {
  const rootExists = await RNFS.exists(DOWNLOAD_ROOT_DIR);
  if (!rootExists) {
    await RNFS.mkdir(DOWNLOAD_ROOT_DIR);
  }
  const exists = await RNFS.exists(DOWNLOAD_DIR);
  if (!exists) {
    await RNFS.mkdir(DOWNLOAD_DIR);
  }
  return DOWNLOAD_DIR;
}

/**
 * 判断歌曲是否已下载（本地文件存在）
 */
export async function isSongDownloaded(
  song: MusicInfo,
  quality: DownloadQuality = "320k",
): Promise<boolean> {
  try {
    return await RNFS.exists(downloadFilePath(song, quality));
  } catch (error) {
    console.error("Check downloaded error:", error);
    return false;
  }
}

/**
 * 获取已下载歌曲的本地 file:// 路径；若不存在返回 null
 */
export async function getDownloadedPath(
  song: MusicInfo,
  quality: DownloadQuality = "320k",
): Promise<string | null> {
  const exists = await isSongDownloaded(song, quality);
  return exists ? downloadFileUri(song, quality) : null;
}

/**
 * 下载歌曲到本地
 *
 * 1. 根据音质解析对应的播放 URL（无损/Hi-Res 走高品质解析）
 * 2. 用 RNFS.downloadFile 下载到 DOWNLOAD_DIR
 * 3. 文件命名 {source}-{id}-{quality}.{ext}
 * 4. 返回本地 file:// 路径
 *
 * @param song 歌曲信息
 * @param onProgress 下载进度回调
 * @param quality 下载音质，默认 320k
 * @returns 本地 file:// 路径
 */
export async function downloadSong(
  song: MusicInfo,
  onProgress?: (info: DownloadProgressInfo) => void,
  quality: DownloadQuality = "320k",
): Promise<string> {
  await ensureDownloadDirectory();

  const filePath = downloadFilePath(song, quality);

  // 若已存在则直接返回，避免重复下载
  if (await RNFS.exists(filePath)) {
    const stat = await RNFS.stat(filePath);
    onProgress?.({
      progress: 1,
      bytesWritten: Number(stat.size) || 0,
      contentLength: Number(stat.size) || 0,
    });
    return downloadFileUri(song, quality);
  }

  // 解析播放 URL（本地歌曲直接用其 url）
  // B站音源需要附带 Referer / User-Agent 请求头，否则 CDN 会返回 403
  // 非 B站音源根据 quality 调用高品质解析接口
  let url: string;
  let headers: Record<string, string> | undefined;
  let resolvedExt: string | null = null;
  if (song.isLocal && song.url) {
    url = song.url;
  } else if (song.source === "bili") {
    const result = await resolveBiliSongUrl(song);
    url = result.url;
    headers = {
      Referer: result.referer,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    };
    resolvedExt = inferExtFromUrl(url) ?? "m4a";
  } else {
    const result = await resolveSongUrl(song, quality);
    url = result.url;
    resolvedExt = inferExtFromUrl(url) ?? qualityExt(quality);
  }
  if (!url) {
    throw new Error("无法获取播放地址");
  }

  // 若解析返回的扩展名与按音质推断的不一致，以解析结果为准重命名文件
  // （例如请求 flac 但源站只返回 mp3 时，避免文件名误导）
  let finalFilePath = filePath;
  let finalUri = downloadFileUri(song, quality);
  if (resolvedExt && resolvedExt !== qualityExt(quality)) {
    const adjustedName = `${song.source}-${song.id}-${quality}.${resolvedExt}`;
    finalFilePath = `${DOWNLOAD_DIR}/${adjustedName}`;
    finalUri = `file://${finalFilePath}`;
  }

  const key = downloadJobKey(song, quality);

  const download = RNFS.downloadFile({
    fromUrl: url,
    toFile: finalFilePath,
    background: true,
    discretionary: false,
    progressDivider: 5,
    headers,
    progress: (event) => {
      const progress = event.contentLength > 0 ? event.bytesWritten / event.contentLength : 0;
      onProgress?.({
        progress,
        bytesWritten: event.bytesWritten,
        contentLength: event.contentLength,
      });
    },
  });

  activeJobs.set(key, { jobId: download.jobId });

  try {
    const result = await download.promise;
    if (result.statusCode !== 200) {
      // 清理失败文件
      await safeUnlink(finalFilePath);
      throw new Error(`下载失败，HTTP ${result.statusCode}`);
    }
    await writeSidecarLyrics(song, finalFilePath);
    await enhanceDownloadedFile(song, finalFilePath);
    return finalUri;
  } catch (error) {
    // 取消或出错时清理半成品文件
    await safeUnlink(finalFilePath);
    throw error;
  } finally {
    activeJobs.delete(key);
  }
}

/**
 * 取消指定歌曲的下载任务
 *
 * @returns 是否成功取消（存在进行中的任务且已发出停止指令）
 */
export function cancelDownload(song: MusicInfo, quality?: DownloadQuality): boolean {
  const keys = quality
    ? [downloadJobKey(song, quality)]
    : Array.from(activeJobs.keys()).filter((key) => key.startsWith(`${songKey(song)}:`));
  let cancelled = false;

  for (const key of keys) {
    const job = activeJobs.get(key);
    if (!job) continue;
    try {
      RNFS.stopDownload(job.jobId);
    } catch (error) {
      console.error("Cancel download error:", error);
    }
    activeJobs.delete(key);
    cancelled = true;
  }

  return cancelled;
}

async function writeSidecarLyrics(song: MusicInfo, audioFilePath: string): Promise<void> {
  try {
    const lyrics = await fetchSongLyrics(song);
    const lrc = formatLyricsAsLrc(lyrics);
    if (!lrc) return;
    await RNFS.writeFile(sidecarLrcPath(audioFilePath), `${lrc}\n`, "utf8");
  } catch (error) {
    console.warn("Write sidecar lyrics error:", error);
  }
}

/** 拉取封面字节（对齐桌面端 fetchCoverDataUrl），失败返回 undefined 不阻断下载。 */
async function fetchCoverBytes(song: MusicInfo): Promise<Id3Cover | undefined> {
  const url = song.picUrl || song.img;
  if (!url) return undefined;
  try {
    const mime = url.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
    const tmpPath = `${RNFS.CachesDirectoryPath}/auralflow_cover_${Date.now()}.tmp`;
    const result = await RNFS.downloadFile({ fromUrl: url, toFile: tmpPath }).promise;
    if (result.statusCode !== 200) return undefined;
    const b64 = await RNFS.readFile(tmpPath, "base64");
    await RNFS.unlink(tmpPath).catch(() => undefined);
    return { mime, data: base64ToBytes(b64) };
  } catch (error) {
    console.warn("Fetch cover bytes error:", error);
    return undefined;
  }
}

/**
 * 对齐桌面端 enhanceDownloadedFile：把标题/歌手/专辑 + 封面 + 歌词写进下载音频。
 * 只处理非本地歌曲；任一步失败仅告警不中断（下载文件本身已完整）。
 */
async function enhanceDownloadedFile(
  song: MusicInfo,
  audioFilePath: string,
): Promise<void> {
  if (song.isLocal) return;
  try {
    const lyrics = await fetchSongLyrics(song);
    const lrc = formatLyricsAsLrc(lyrics);
    const cover = await fetchCoverBytes(song);

    const b64 = await RNFS.readFile(audioFilePath, "base64");
    const audio = base64ToBytes(b64);
    const tagged = embedId3Tag(audio, {
      title: song.name || undefined,
      artist: song.singer || undefined,
      album: song.albumName || undefined,
      cover,
      lyrics: lrc || undefined,
    });
    await RNFS.writeFile(audioFilePath, bytesToBase64(tagged), "base64");
  } catch (error) {
    console.warn("Enhance downloaded file (ID3) error:", error);
  }
}

/**
 * 取消所有进行中的下载任务
 */
export function cancelAllDownloads(): void {
  for (const [, job] of activeJobs) {
    try {
      RNFS.stopDownload(job.jobId);
    } catch (error) {
      console.error("Cancel all downloads error:", error);
    }
  }
  activeJobs.clear();
}

/**
 * 删除已下载文件（按歌曲）
 */
export async function removeDownloadedFile(song: MusicInfo): Promise<void> {
  await safeUnlink(downloadFilePath(song));
}

/**
 * 删除指定路径的已下载文件
 */
export async function removeDownloadedByPath(localPath: string): Promise<void> {
  const filePath = localPath.startsWith("file://") ? localPath.slice("file://".length) : localPath;
  await safeUnlink(filePath);
}

export async function getDownloadedFileSize(localPath: string): Promise<number> {
  const filePath = localPath.startsWith("file://") ? localPath.slice("file://".length) : localPath;
  const stat = await RNFS.stat(filePath);
  return Number(stat.size) || 0;
}

/**
 * 清空所有已下载文件（保留目录）
 */
export async function clearDownloadedFiles(): Promise<void> {
  try {
    const exists = await RNFS.exists(DOWNLOAD_DIR);
    if (!exists) return;
    const entries = await RNFS.readDir(DOWNLOAD_DIR);
    for (const entry of entries) {
      if (entry.isFile()) {
        await RNFS.unlink(entry.path);
      }
    }
  } catch (error) {
    console.error("Clear downloaded files error:", error);
  }
}

/**
 * 从持久化存储加载已下载列表
 */
export async function loadDownloads(): Promise<DownloadedItem[]> {
  try {
    const raw = await AsyncStorage.getItem(DOWNLOAD_STORE_KEY);
    if (!raw) return [];
    const items = JSON.parse(raw) as DownloadedItem[];
    return Array.isArray(items) ? items : [];
  } catch (error) {
    console.error("Load downloads error:", error);
    return [];
  }
}

/**
 * 保存已下载列表到持久化存储
 */
export async function saveDownloads(items: DownloadedItem[]): Promise<void> {
  try {
    await AsyncStorage.setItem(DOWNLOAD_STORE_KEY, JSON.stringify(items));
  } catch (error) {
    console.error("Save downloads error:", error);
  }
}

async function safeUnlink(filePath: string): Promise<void> {
  try {
    const exists = await RNFS.exists(filePath);
    if (exists) {
      await RNFS.unlink(filePath);
    }
  } catch (error) {
    console.error("Unlink file error:", error);
  }
}

