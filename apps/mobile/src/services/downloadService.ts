import AsyncStorage from "@react-native-async-storage/async-storage";
import RNFS from "react-native-fs";
import type { LyricLine, MusicInfo } from "@lx/core";
import { DEFAULT_QUALITY_UPGRADE_WINDOW_MS, estimateStreamDurationSeconds, isPreviewStream, raceForBestQuality } from "@lx/core";
import { fetchSongLyrics, parseUrl, buildStreamHeaders } from "./musicApi";
import { resolveUrlWithCustomSource } from "./playerService";
import { probeStreamUrl } from "./streamProbe";
import { commitDownloadedFile, createPartialDownloadPath, removeOrphanedPartialDownloads, validateDownloadedFile } from "./fileDownloadCommit";

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
  /**
   * 后处理（ID3 标签 / 封面 / 旁挂 .lrc）部分失败时的原因；下载本身已完成。
   * 旧记录没有该字段，缺失即视为无警告。
   */
  warning?: string;
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

/** 持久化完成与取消共用任务状态，提交后不再接受取消。 */
export interface DownloadCompletion {
  isActive: () => boolean;
  commit: () => void;
}

type CompleteDownload = (path: string, completion: DownloadCompletion) => Promise<void>;
type InterruptionReason = "paused" | "cancelled";

export class DownloadInterruptedError extends Error {
  constructor(readonly reason: InterruptionReason) {
    super(reason === "paused" ? "已暂停" : "已取消");
    this.name = "DownloadInterruptedError";
  }
}

/** 每次尝试独占状态；同一歌曲的重试不能复用旧任务的取消或原生句柄。 */
interface QueueTask {
  key: string;
  song: MusicInfo;
  quality: DownloadQuality;
  state: "active" | "completed" | InterruptionReason;
  jobId?: number;
  filePath?: string;
  interrupted: Promise<void>;
  interrupt: () => void;
  onProgress?: (info: DownloadProgressInfo) => void;
  onWarnings?: (warnings: string[]) => void;
  onComplete?: CompleteDownload;
  resolve: (path: string) => void;
  reject: (error: Error) => void;
}

const downloadTasks = new Set<QueueTask>();
const taskQueue: QueueTask[] = [];
let currentTask: QueueTask | undefined;

function songKey(song: MusicInfo): string {
  return `${song.source}:${song.id}`;
}

function downloadJobKey(song: MusicInfo, quality: DownloadQuality): string {
  return `${songKey(song)}:${quality}`;
}

function assertTaskActive(task: QueueTask): void {
  if (task.state === "active") return;
  throw new DownloadInterruptedError(task.state === "paused" ? "paused" : "cancelled");
}

/** 取链等只读请求可提前退出；原生写入和持久化必须等实际结束再清理。 */
function waitForTask<T>(task: QueueTask, promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    task.interrupted.then(() => {
      throw new DownloadInterruptedError(task.state === "paused" ? "paused" : "cancelled");
    }),
  ]);
}

function interruptTask(task: QueueTask, reason: InterruptionReason): boolean {
  if (task.state === "completed" || task.state === "cancelled") return false;
  task.state = reason;
  task.interrupt();
  if (task.jobId !== undefined) RNFS.stopDownload(task.jobId);
  const index = taskQueue.indexOf(task);
  if (index >= 0) {
    taskQueue.splice(index, 1);
    task.reject(new DownloadInterruptedError(reason));
  }
  if (reason === "cancelled" && task !== currentTask) downloadTasks.delete(task);
  return true;
}

/** 从入队前到记录提交后均可定位任务；新任务等待旧任务停止写入、完成清理。 */
export function enqueueDownloadTask(
  song: MusicInfo,
  quality: DownloadQuality,
  onProgress?: (info: DownloadProgressInfo) => void,
  onWarnings?: (warnings: string[]) => void,
  onComplete?: CompleteDownload,
): Promise<string> {
  const key = downloadJobKey(song, quality);
  for (const previous of downloadTasks) {
    if (previous.key === key && previous.state === "paused" && previous !== currentTask) {
      downloadTasks.delete(previous);
    }
  }
  return new Promise<string>((resolve, reject) => {
    let interrupt!: () => void;
    const interrupted = new Promise<void>((notify) => { interrupt = notify; });
    const task: QueueTask = {
      key, song, quality, state: "active", interrupted, interrupt,
      onProgress, onWarnings, onComplete, resolve, reject,
    };
    downloadTasks.add(task);
    taskQueue.push(task);
    void processDownloadQueue();
  });
}

export function dequeueDownloadTask(key: string): boolean {
  const task = taskQueue.find((item) => item.key === key);
  return task ? interruptTask(task, "cancelled") : false;
}

async function processDownloadQueue(): Promise<void> {
  if (currentTask) return;
  while (taskQueue.length > 0) {
    const task = taskQueue.shift()!;
    currentTask = task;
    let fileReady = false;
    try {
      const path = await downloadSongInternal(task);
      fileReady = true;
      const completion: DownloadCompletion = {
        isActive: () => task.state === "active",
        commit: () => {
          assertTaskActive(task);
          task.state = "completed";
        },
      };
      assertTaskActive(task);
      await task.onComplete?.(path, completion);
      if (task.state !== "completed") completion.commit();
      task.resolve(path);
    } catch (error) {
      try {
        // 普通记录保存失败保留完整音频；取消、暂停和下载失败则清理本次写入。
        if (task.filePath && (!fileReady || error instanceof DownloadInterruptedError)) {
          await removeDownloadedByPath(task.filePath);
        }
      } catch (cleanupError) {
        error = new Error(`清理下载文件失败：${formatDownloadReason(cleanupError)}`);
      }
      task.reject(error instanceof Error ? error : new Error(String(error)));
    } finally {
      const hasReplacement = Array.from(downloadTasks).some((item) => item !== task && item.key === task.key);
      if (task.state !== "paused" || hasReplacement) downloadTasks.delete(task);
      currentTask = undefined;
    }
  }
}

/** 暂停与取消共享停止路径；继续时整曲重新下载，不保留可被误认的半成品。 */
export function pauseDownload(song: MusicInfo, quality: DownloadQuality): boolean {
  const key = downloadJobKey(song, quality);
  let paused = false;
  for (const task of downloadTasks) {
    if (task.key === key && interruptTask(task, "paused")) paused = true;
  }
  return paused;
}

export function resumeDownload(song: MusicInfo, quality: DownloadQuality): boolean {
  return isDownloadPaused(song, quality);
}

export function isDownloadPaused(song: MusicInfo, quality: DownloadQuality): boolean {
  const key = downloadJobKey(song, quality);
  // 旧暂停任务可能仍在等待原生停止，只有最新尝试决定是否可以继续。
  let paused = false;
  for (const task of downloadTasks) {
    if (task.key === key) paused = task.state === "paused";
  }
  return paused;
}

/**
 * 根据音质推断文件扩展名：无损系列为 flac，其余为 mp3。
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
    const pathname = new URL(url).pathname;
    const ext = pathname.split(".").pop()?.toLowerCase() ?? "";
    if (isAudioFileName(pathname)) {
      // DASH 流的 m4s 本地保存统一用 m4a 便于播放器识别
      return ext === "m4s" ? "m4a" : ext;
    }
  } catch {
    // 忽略非法 URL
  }
  return null;
}

function isAudioFileName(name: string): boolean {
  return /\.(mp3|flac|m4a|m4s|aac|wav|ogg|opus)$/i.test(name);
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
 * 下载时若解析出的真实扩展名与按音质推断的不一致，文件会以调整后的
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
      if (entry.isFile() && entry.name.startsWith(prefix) && isAudioFileName(entry.name)) return entry.path;
    }
  } catch {}
  return null;
}

/**
 * 确保下载目录存在
 */
let partialRecovery: Promise<void> | undefined;

export async function ensureDownloadDirectory(): Promise<string> {
  const rootExists = await RNFS.exists(DOWNLOAD_ROOT_DIR);
  if (!rootExists) {
    await RNFS.mkdir(DOWNLOAD_ROOT_DIR);
  }
  const exists = await RNFS.exists(DOWNLOAD_DIR);
  if (!exists) {
    await RNFS.mkdir(DOWNLOAD_DIR);
  }
  if (!partialRecovery) {
    partialRecovery = removeOrphanedPartialDownloads(DOWNLOAD_DIR).catch((error) => {
      partialRecovery = undefined;
      throw error;
    });
  }
  await partialRecovery;
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
 * @param onWarnings 后处理（标签/封面/歌词）部分失败时的回调；下载本身已完成
 * @returns 本地 file:// 路径
 */
export function downloadSong(
  song: MusicInfo,
  onProgress?: (info: DownloadProgressInfo) => void,
  quality: DownloadQuality = "320k",
  onWarnings?: (warnings: string[]) => void,
  onComplete?: CompleteDownload,
): Promise<string> {
  return enqueueDownloadTask(song, quality, onProgress, onWarnings, onComplete);
}

async function downloadSongInternal(task: QueueTask): Promise<string> {
  const { song, quality, onProgress } = task;
  assertTaskActive(task);
  await ensureDownloadDirectory();
  assertTaskActive(task);

  // 文件命中也必须排队：旧任务清理完成前，非空文件仍可能只是半成品。
  const existingPath = await findExistingDownloadFile(song, quality);
  assertTaskActive(task);
  if (existingPath) {
    const stat = await RNFS.stat(existingPath);
    assertTaskActive(task);
    onProgress?.({ progress: 1, bytesWritten: Number(stat.size), contentLength: Number(stat.size), speed: 0 });
    return `file://${existingPath}`;
  }
  const filePath = downloadFilePath(song, quality);

  // 解析播放 URL（本地歌曲直接用其 url）
  // 非本地音源根据 quality 调用高品质解析接口
  let url: string;
  let headers: Record<string, string> | undefined;
  let resolvedExt: string | null = null;
  if (song.isLocal && song.url) {
    url = song.url;
  } else {
    // 同档音质内并发竞速（与播放链路一致，用户要求 2026-08）：网关与自定义音源同时
    // 发起，谁先返回有效 URL 用谁；下载完成后 headers 用胜出方的防盗链配置。
    try {
      const raced = await waitForTask(task, raceDownloadUrl(song, quality));
      assertTaskActive(task);
      url = raced.url;
      // 防盗链 headers 统一按音源补齐：自定义源返回的也多为 wy/tx 官方 CDN 链接，
      // 缺 Referer 会 403；其他源 CDN 无 Referer 要求，多带无害（与播放链路保持一致）。
      headers = buildStreamHeaders(song.source);
      // 死代理探活：与播放链路同策略，避免下载写入死链后无限等待。下载是用户显式
      // 指定音质且不降档，探不通直接报错，让用户换源或换音质重试。
      const probe = await waitForTask(task, probeStreamUrl(url, headers));
      assertTaskActive(task);
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

  assertTaskActive(task);
  const partialPath = createPartialDownloadPath(finalFilePath);
  task.filePath = partialPath;
  const download = RNFS.downloadFile({
    fromUrl: url,
    toFile: partialPath,
    background: true,
    discretionary: false,
    progressDivider: 5,
    headers,
    progress: (event) => {
      if (task.state !== "active") return;
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

  task.jobId = download.jobId;
  let result;
  try {
    result = await download.promise;
  } catch (error) {
    assertTaskActive(task);
    throw error;
  } finally {
    task.jobId = undefined;
  }
  assertTaskActive(task);
  if (result.statusCode !== 200 && result.statusCode !== 206) {
    throw new Error("下载失败，请重试或更换音源");
  }
  await validateDownloadedFile(partialPath, result.bytesWritten);
  const lyrics = await waitForTask(task, fetchSongLyrics(song).catch(() => [] as LyricLine[]));
  assertTaskActive(task);
  const warnings = await enhanceDownloadedFile(song, partialPath, lyrics, finalFilePath);
  assertTaskActive(task);
  await commitDownloadedFile(partialPath, finalFilePath);
  // 提交期间取消也必须清理最终文件，不能再只清理已被重命名的临时路径。
  task.filePath = finalFilePath;
  assertTaskActive(task);
  warnings.push(...await writeSidecarLyrics(song, finalFilePath, lyrics));
  assertTaskActive(task);
  if (warnings.length > 0) task.onWarnings?.(warnings);
  return finalUri;
}

/** 取消排队、解析、原生写入、后处理及持久化中的匹配任务。 */
export function cancelDownload(song: MusicInfo, quality?: DownloadQuality): boolean {
  let cancelled = false;
  for (const task of downloadTasks) {
    if (songKey(task.song) !== songKey(song) || (quality && task.quality !== quality)) continue;
    if (interruptTask(task, "cancelled")) cancelled = true;
  }
  return cancelled;
}

async function writeSidecarLyrics(
  song: MusicInfo,
  audioFilePath: string,
  lyrics?: LyricLine[],
): Promise<string[]> {
  try {
    const lrc = formatLyricsAsLrc(lyrics ?? []);
    if (!lrc) return [];
    await RNFS.writeFile(sidecarLrcPath(audioFilePath), `${lrc}\n`, "utf8");
    return [];
  } catch (error) {
    return [`写入旁挂歌词文件失败：${formatDownloadReason(error)}`];
  }
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
 * 封面缺失可继续；文件重写失败必须终止任务，不能把截断音频当作完成下载。
 */
async function enhanceDownloadedFile(
  song: MusicInfo,
  audioFilePath: string,
  lyrics: LyricLine[],
  finalFilePath: string,
): Promise<string[]> {
  if (song.isLocal) return [];
  const ext = finalFilePath.split(".").pop()?.toLowerCase() ?? "";
  if (ext !== "mp3") return [];
  try {
    const stat = await RNFS.stat(audioFilePath);
    if (Number(stat.size) > 25 * 1024 * 1024) return [];
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
    return [];
  } catch (error) {
    throw new Error(`写入内嵌标签失败：${formatDownloadReason(error)}`);
  }
}

/** 把任意抛出物压成一行可展示的原因。 */
function formatDownloadReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 取消所有下载任务（排队中 + 进行中）
 */
export function cancelAllDownloads(): void {
  for (const task of downloadTasks) interruptTask(task, "cancelled");
}

/** 删除该音质的音频变体及其旁挂歌词，不触碰其他音质。 */
export async function removeDownloadedFile(
  song: MusicInfo,
  quality: DownloadQuality = "320k",
): Promise<void> {
  await removeDownloadedByPath(downloadFilePath(song, quality));
  if (!(await RNFS.exists(DOWNLOAD_DIR))) return;
  const prefix = `${song.source}-${song.id}-${quality}.`;
  const entries = await RNFS.readDir(DOWNLOAD_DIR);
  for (const entry of entries) {
    if (entry.isFile() && entry.name.startsWith(prefix) && isAudioFileName(entry.name)) {
      await removeDownloadedByPath(entry.path);
    }
  }
}

/** 音频和同名歌词共同删除；失败向上传递，避免伪装清理成功。 */
export async function removeDownloadedByPath(localPath: string): Promise<void> {
  const filePath = localPath.startsWith("file://") ? localPath.slice("file://".length) : localPath;
  await unlinkIfExists(sidecarLrcPath(filePath));
  await unlinkIfExists(filePath);
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

async function unlinkIfExists(filePath: string): Promise<void> {
  if (await RNFS.exists(filePath)) await RNFS.unlink(filePath);
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
