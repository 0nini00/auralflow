import AsyncStorage from "@react-native-async-storage/async-storage";
import RNFS from "react-native-fs";
import type { LyricLine, MusicInfo } from "@lx/core";
import { DEFAULT_QUALITY_UPGRADE_WINDOW_MS, estimateStreamDurationSeconds, isPreviewStream, raceForBestQuality } from "@lx/core";
import { fetchSongLyrics, parseUrl, buildStreamHeaders } from "./musicApi";
import { resolveBiliSongUrl } from "./biliService";
import { resolveUrlWithCustomSource } from "./playerService";
import { probeStreamUrl } from "./streamProbe";
import { STREAM_USER_AGENT } from "./musicApi";

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

/** 上次选择的下载音质（对齐 lx getLastSelectQuality/saveLastSelectQuality）。 */
const LAST_QUALITY_KEY = "auralflow.mobile.download.lastQuality";

/** 读取上次选择的下载音质；无记录返回 null。 */
export async function getLastSelectQuality(): Promise<DownloadQuality | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_QUALITY_KEY);
    if (!raw) return null;
    return normalizeQualityKeyForDownload(raw);
  } catch {
    return null;
  }
}

/** 保存本次选择的下载音质，供下次默认选中。 */
export async function saveLastSelectQuality(quality: DownloadQuality): Promise<void> {
  try {
    await AsyncStorage.setItem(LAST_QUALITY_KEY, quality);
  } catch {}
}

/** 兼容历史存储的别名值（如 "hires" → "flac24bit"），非法值回退 null。 */
function normalizeQualityKeyForDownload(value: string): DownloadQuality | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "hires" || normalized === "hi-res" || normalized === "flac24bit") return "flac24bit";
  if (normalized === "flac") return "flac";
  if (normalized === "320k" || normalized === "320") return "320k";
  if (normalized === "192k" || normalized === "192") return "192k";
  if (normalized === "128k" || normalized === "128") return "128k";
  return null;
}




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
  /** 下载速度（字节/秒），串行队列内实时计算；未知为 0 */
  speed: number;
}

/** 进行中的下载任务句柄，用于取消/暂停/继续 */
interface ActiveJob {
  jobId: number;
  /** 已写入的字节数，用于暂停后续传 */
  bytesWritten: number;
}

const activeJobs = new Map<string, ActiveJob>();

/** 串行下载队列（对齐 lx：一个任务完成后再下载下一个，避免并发抢带宽）。 */
interface QueueTask {
  key: string;
  song: MusicInfo;
  quality: DownloadQuality;
  onProgress?: (info: DownloadProgressInfo) => void;
  resolve: (path: string) => void;
  reject: (error: Error) => void;
}

const taskQueue: QueueTask[] = [];
let isQueueProcessing = false;
let pausedKeys = new Set<string>();

function songKey(song: MusicInfo): string {
  return `${song.source}:${song.id}`;
}

function downloadJobKey(song: MusicInfo, quality: DownloadQuality): string {
  return `${songKey(song)}:${quality}`;
}

/**
 * 串行下载入口：把任务加入队列，等待前序任务完成后再真正下载。
 * 返回的 Promise 在任务真正完成时 resolve（被取消/暂停时 reject）。
 */
export function enqueueDownloadTask(
  song: MusicInfo,
  quality: DownloadQuality,
  onProgress?: (info: DownloadProgressInfo) => void,
): Promise<string> {
  const key = downloadJobKey(song, quality);
  return new Promise<string>((resolve, reject) => {
    taskQueue.push({ key, song, quality, onProgress, resolve, reject });
    void processDownloadQueue();
  });
}

/** 从队列移除某个任务（取消/暂停时调用）。返回 true 表示仍在排队未开始。 */
export function dequeueDownloadTask(key: string): boolean {
  const index = taskQueue.findIndex((task) => task.key === key);
  if (index < 0) return false;
  const [task] = taskQueue.splice(index, 1);
  task.reject(new Error("已取消"));
  return true;
}

async function processDownloadQueue(): Promise<void> {
  if (isQueueProcessing) return;
  isQueueProcessing = true;
  try {
    while (taskQueue.length > 0) {
      const task = taskQueue.shift()!;
      try {
        const path = await downloadSongInternal(task);
        task.resolve(path);
      } catch (error) {
        task.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
  } finally {
    isQueueProcessing = false;
  }
}

/** 暂停：停止当前任务的网络写入（RNFS stopDownload），并标记为可续传。 */
export function pauseDownload(song: MusicInfo, quality: DownloadQuality): boolean {
  const key = downloadJobKey(song, quality);
  if (dequeueDownloadTask(key)) {
    // 排队未开始的任务直接出队，按暂停处理
    pausedKeys.add(key);
    return true;
  }
  const job = activeJobs.get(key);
  if (!job) return false;
  pausedKeys.add(key);
  try {
    RNFS.stopDownload(job.jobId);
  } catch {}
  activeJobs.delete(key);
  return true;
}

/**
 * 继续：标记任务可续传（不清除 pausedKeys——由 downloadSongInternal 读取续传点后清理，
 * 避免 store.resumeDownload 先清标记再入队时，downloadSong 把半成品文件误判为已完成）。
 */
export function resumeDownload(song: MusicInfo, quality: DownloadQuality): boolean {
  return pausedKeys.has(downloadJobKey(song, quality));
}

/** 任务是否处于暂停状态。 */
export function isDownloadPaused(song: MusicInfo, quality: DownloadQuality): boolean {
  return pausedKeys.has(downloadJobKey(song, quality));
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
 * 查找已存在的下载文件。
 *
 * 下载时若解析出的真实扩展名与按音质推断的不一致（如 B站 m4s→m4a），文件会以调整后的
 * 扩展名落盘；这里先查标准路径，再按文件名前缀扫描目录，避免把已下载文件当成未下载而重复下载。
 */
async function findExistingDownloadFile(
  song: MusicInfo,
  quality: DownloadQuality,
): Promise<string | null> {
  const expected = downloadFilePath(song, quality);
  if (await RNFS.exists(expected)) return expected;
  try {
    const prefix = `${song.source}-${song.id}-${quality}.`;
    const entries = await RNFS.readDir(DOWNLOAD_DIR);
    for (const entry of entries) {
      if (entry.isFile() && entry.name.startsWith(prefix)) return entry.path;
    }
  } catch {}
  return null;
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
    return (await findExistingDownloadFile(song, quality)) != null;
  } catch (error) {
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
  const path = await findExistingDownloadFile(song, quality);
  return path ? `file://${path}` : null;
}

/**
 * 下载歌曲到本地（串行队列入口）
 *
 * 加入串行下载队列（对齐 lx：一个完成再下一个），返回的 Promise 在真正完成时 resolve。
 * 重复入队同一首歌同音质时直接返回已存在文件（去重）。
 *
 * @param song 歌曲信息
 * @param onProgress 下载进度回调（含实时速度）
 * @param quality 下载音质，默认 320k
 * @returns 本地 file:// 路径
 */
export async function downloadSong(
  song: MusicInfo,
  onProgress?: (info: DownloadProgressInfo) => void,
  quality: DownloadQuality = "320k",
): Promise<string> {
  await ensureDownloadDirectory();

  // 暂停后继续：半成品文件是续传起点，不能按「已下载」短路
  const isResuming = isDownloadPaused(song, quality);
  if (!isResuming) {
    // 若已存在则直接返回，避免重复下载（含扩展名被调整过的历史文件）
    const existingPath = await findExistingDownloadFile(song, quality);
    if (existingPath) {
      const stat = await RNFS.stat(existingPath);
      onProgress?.({
        progress: 1,
        bytesWritten: Number(stat.size) || 0,
        contentLength: Number(stat.size) || 0,
        speed: 0,
      });
      return `file://${existingPath}`;
    }
  }

  return enqueueDownloadTask(song, quality, onProgress);
}

/**
 * 真正执行单个下载任务（由串行队列 processDownloadQueue 调用）。
 */
async function downloadSongInternal(task: QueueTask): Promise<string> {
  const { song, quality, onProgress } = task;
  const key = task.key;

  // 暂停后继续：RNFS 的 stopDownload 后重新 downloadFile 无法真正断点续传（fresh 请求会从头覆盖），
  // 对齐 lx 的 resumeTask 行为——直接删除半成品、整曲重新下载，保证文件完整性与可播放性。
  const isResuming = isDownloadPaused(song, quality);
  const filePath = downloadFilePath(song, quality);
  if (isResuming) {
    // 清理暂停残留的半成品（标准路径 + 调整过扩展名的变体）
    await safeUnlink(filePath);
    try {
      const prefix = `${song.source}-${song.id}-${quality}.`;
      const entries = await RNFS.readDir(DOWNLOAD_DIR);
      for (const entry of entries) {
        if (entry.isFile() && entry.name.startsWith(prefix)) {
          await safeUnlink(entry.path);
        }
      }
    } catch {}
    // 续传点已消费，清除暂停标记（若再次失败则按普通失败清理，不残留半成品）
    pausedKeys.delete(key);
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
    // 同档音质内并发竞速（与播放链路一致，用户要求 2026-08）：网关与自定义音源同时
    // 发起，谁先返回有效 URL 用谁；下载完成后 headers 用胜出方的防盗链配置。
    try {
      const raced = await raceDownloadUrl(song, quality);
      url = raced.url;
      // 防盗链 headers 统一按音源补齐：自定义源返回的也多为 wy/tx 官方 CDN 链接，
      // 缺 Referer 会 403；其他源 CDN 无 Referer 要求，多带无害（与播放链路保持一致）。
      headers = buildStreamHeaders(song.source);
      // 死代理探活：与播放链路同策略，避免下载写入死链后无限等待。下载是用户显式
      // 指定音质且不降档，探不通直接报错，让用户换源或换音质重试。
      const probe = await probeStreamUrl(url, headers);
      if (!probe.ok) {
        throw new Error(`下载地址不可用（${probe.reason}），请重试或更换音源`);
      }
      if (
        probe.ok &&
        probe.totalBytes != null &&
        isPreviewStream({
          totalBytes: probe.totalBytes,
          quality: raced.quality,
          expectedDurationSeconds: song.interval,
        })
      ) {
        const previewSeconds = estimateStreamDurationSeconds(probe.totalBytes, raced.quality);
        throw new Error(
          `下载地址为试听片段（约 ${Math.round(previewSeconds ?? 0)}s），请更换音源或音质`,
        );
      }
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    }
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

  // 速度统计：每 500ms 采样一次字节增量
  let lastBytes = 0;
  let lastSampleAt = Date.now();
  let currentSpeed = 0;

  const download = RNFS.downloadFile({
    fromUrl: url,
    toFile: finalFilePath,
    background: true,
    discretionary: false,
    progressDivider: 5,
    headers,
    progress: (event) => {
      const now = Date.now();
      const deltaTime = now - lastSampleAt;
      const deltaBytes = event.bytesWritten - lastBytes;
      if (deltaTime >= 500) {
        currentSpeed = deltaTime > 0 ? deltaBytes / (deltaTime / 1000) : 0;
        lastBytes = event.bytesWritten;
        lastSampleAt = now;
      }
      const progress = event.contentLength > 0 ? event.bytesWritten / event.contentLength : 0;
      onProgress?.({
        progress,
        bytesWritten: event.bytesWritten,
        contentLength: event.contentLength,
        speed: currentSpeed,
      });
    },
  });

  activeJobs.set(key, { jobId: download.jobId, bytesWritten: 0 });

  try {
    const result = await download.promise;
    if (result.statusCode !== 200 && result.statusCode !== 206) {
      // 清理失败文件
      await safeUnlink(finalFilePath);
      throw new Error(`下载失败，请重试或更换音源`);
    }
    // 歌词只拉取一次：旁挂 .lrc 与嵌入 ID3 共用，避免两个函数各自请求一次网络
    const lyrics = await fetchSongLyrics(song).catch(() => [] as LyricLine[]);
    await writeSidecarLyrics(song, finalFilePath, lyrics);
    await enhanceDownloadedFile(song, finalFilePath, lyrics);
    return finalUri;
  } catch (error) {
    // 取消/暂停或出错时清理半成品文件（暂停续传依赖服务端 Accept-Ranges，失败则整文件重下）
    if (!isDownloadPaused(song, quality)) {
      await safeUnlink(finalFilePath);
    }
    throw error;
  } finally {
    activeJobs.delete(key);
  }
}

/**
 * 取消指定歌曲的下载任务
 *
 * 同时处理：排队中未开始的任务（直接出队）、进行中的任务（停止网络写入）。
 *
 * @returns 是否成功取消
 */
export function cancelDownload(song: MusicInfo, quality?: DownloadQuality): boolean {
  const keys = quality
    ? [downloadJobKey(song, quality)]
    : Array.from(new Set([
        ...activeJobs.keys(),
        ...taskQueue.map((task) => task.key),
      ])).filter((key) => key.startsWith(`${songKey(song)}:`));
  let cancelled = false;

  for (const key of keys) {
    if (dequeueDownloadTask(key)) {
      cancelled = true;
      continue;
    }
    const wasPaused = pausedKeys.delete(key);
    const job = activeJobs.get(key);
    if (job) {
      try {
        RNFS.stopDownload(job.jobId);
      } catch {}
      activeJobs.delete(key);
      cancelled = true;
      // 取消进行中任务：RNFS stopDownload 后由 downloadSongInternal 的 catch 清理半成品
      continue;
    }
    if (wasPaused) {
      // 取消已暂停任务：主动清理暂停时残留的半成品文件（异步，不阻塞取消返回）
      cancelled = true;
      const keyQuality = key.split(":").pop() as DownloadQuality;
      const songOfKey = { source: key.split(":")[0]!, id: key.split(":")[1]! } as MusicInfo;
      void removeDownloadedFile(songOfKey, keyQuality).catch(() => undefined);
    }
  }

  return cancelled;
}

async function writeSidecarLyrics(
  song: MusicInfo,
  audioFilePath: string,
  lyrics?: LyricLine[],
): Promise<void> {
  try {
    const lrc = formatLyricsAsLrc(lyrics ?? []);
    if (!lrc) return;
    await RNFS.writeFile(sidecarLrcPath(audioFilePath), `${lrc}\n`, "utf8");
  } catch {}
}

/** 拉取封面字节（对齐桌面端 fetchCoverDataUrl），失败返回 undefined 不阻断下载。 */
async function fetchCoverBytes(song: MusicInfo): Promise<Id3Cover | undefined> {
  const url = song.picUrl || song.img;
  if (!url) return undefined;
  // 临时文件统一在 finally 里清理：非 200 / 下载异常 / 读盘异常也不能残留泄漏。
  const tmpPath = `${RNFS.CachesDirectoryPath}/auralflow_cover_${Date.now()}.tmp`;
  try {
    const mime = url.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
    const result = await RNFS.downloadFile({ fromUrl: url, toFile: tmpPath }).promise;
    if (result.statusCode !== 200) return undefined;
    const b64 = await RNFS.readFile(tmpPath, "base64");
    return { mime, data: base64ToBytes(b64) };
  } catch {
    return undefined;
  } finally {
    await RNFS.unlink(tmpPath).catch(() => undefined);
  }
}

/**
 * 对齐桌面端 enhanceDownloadedFile：把标题/歌手/专辑 + 封面 + 歌词写进下载音频。
 * 只处理非本地、MP3 类文件：
 * - FLAC/M4A 用 ID3v2 头是非标准格式（播放器可能忽略甚至误读），跳过；
 * - 读整文件进内存 + base64 双转换，超过体积上限（25MB）跳过，避免 Hermes OOM。
 * 任一步失败仅告警不中断（下载文件本身已完整）。
 */
async function enhanceDownloadedFile(
  song: MusicInfo,
  audioFilePath: string,
  lyrics?: LyricLine[],
): Promise<void> {
  if (song.isLocal) return;
  const ext = audioFilePath.split(".").pop()?.toLowerCase() ?? "";
  if (ext !== "mp3") return;
  try {
    const stat = await RNFS.stat(audioFilePath);
    if (Number(stat.size) > 25 * 1024 * 1024) return;
    const lrc = formatLyricsAsLrc(lyrics ?? []);
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
  } catch {}
}

/**
 * 取消所有下载任务（排队中 + 进行中）
 */
export function cancelAllDownloads(): void {
  while (taskQueue.length > 0) {
    const task = taskQueue.shift()!;
    task.reject(new Error("已取消"));
  }
  for (const [, job] of activeJobs) {
    try {
      RNFS.stopDownload(job.jobId);
    } catch {}
  }
  activeJobs.clear();
  pausedKeys.clear();
}

/**
 * 删除已下载文件（按歌曲 + 音质；不传音质默认 320k）
 */
export async function removeDownloadedFile(
  song: MusicInfo,
  quality: DownloadQuality = "320k",
): Promise<void> {
  // 按文件名前缀扫描删除该音质的所有扩展名变体，避免调整过扩展名的残留文件。
  await safeUnlink(downloadFilePath(song, quality));
  try {
    const prefix = `${song.source}-${song.id}-${quality}.`;
    const entries = await RNFS.readDir(DOWNLOAD_DIR);
    for (const entry of entries) {
      if (entry.isFile() && entry.name.startsWith(prefix)) {
        await safeUnlink(entry.path);
      }
    }
  } catch {}
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
 * 保存封面图到下载目录（供「下载封面」使用）。
 * @returns file:// 路径；失败返回空串。
 */
export async function saveCoverToDownloads(song: MusicInfo): Promise<string> {
  const url = song.picUrl || song.img;
  if (!url) return "";
  try {
    const exists = await RNFS.exists(DOWNLOAD_DIR);
    if (!exists) await RNFS.mkdir(DOWNLOAD_DIR);

    let ext = "jpg";
    try {
      const parsed = new URL(url);
      const e = parsed.pathname.split(".").pop()?.toLowerCase();
      if (e === "png" || e === "webp" || e === "gif" || e === "jpg") ext = e;
    } catch {
      // 忽略解析失败，默认 jpg
    }

    const coverName = songKey(song).replace(/:/g, "-");
    const path = `${DOWNLOAD_DIR}/${coverName}-cover.${ext}`;
    const result = await RNFS.downloadFile({ fromUrl: url, toFile: path }).promise;
    if (result.statusCode !== 200) {
      await RNFS.unlink(path).catch(() => undefined);
      return "";
    }
    return `file://${path}`;
  } catch {
    return "";
  }
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
  } catch {}
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
    throw error;
  }
}

async function safeUnlink(filePath: string): Promise<void> {
  try {
    const exists = await RNFS.exists(filePath);
    if (exists) {
      await RNFS.unlink(filePath);
    }
  } catch {}
}

/**
 * 下载取链的同档竞速：网关与自定义音源并发，先返回有效 URL 者胜。
 * 与播放链路 raceQualityTier 同策略（用户要求 2026-08）；区别在于下载
 * 不做音质降档（用户指定什么档就下什么档），失败直接报错。
 * 单档场景下 ceiling 即该档，任一通道成功立即定稿，不进入升级等待窗口。
 */
async function raceDownloadUrl(
  song: MusicInfo,
  quality: string,
): Promise<{ url: string; quality: string; fromCustomSource: boolean }> {
  const gatewayAttempt = parseUrl(song, quality).then(
    (result) => ({ url: result.url, quality: result.quality || quality, fromCustomSource: false }),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`播放地址解析失败：${message}`);
    },
  );
  const customAttempt = resolveUrlWithCustomSource(song, [quality]).then(
    (result) => ({ ...result, fromCustomSource: true }),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`自定义音源解析失败：${message}`);
    },
  );

  return raceForBestQuality([gatewayAttempt, customAttempt], {
    getQuality: (value) => value.quality,
    upgradeWindowMs: DEFAULT_QUALITY_UPGRADE_WINDOW_MS,
    ceiling: quality,
    formatError: (errors) => {
      const detail = errors
        .map((error) => (error instanceof Error ? error.message : String(error)))
        .join("；");
      return new Error(detail || "下载地址解析失败");
    },
  });
}
