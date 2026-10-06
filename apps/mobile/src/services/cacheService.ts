import RNFS from "react-native-fs";
import AsyncStorage from "@react-native-async-storage/async-storage";
import CryptoJS from "crypto-js";
import { Platform } from "react-native";
import { COVER_SIZE_LARGE, resizeCoverUrl, type MusicInfo } from "@lx/core";
import { clearPlaybackUrlCache } from "./playbackUrlCache";
import { selectFilesToEvict, type CachedFileEntry } from "./cacheEvictionModel";
import { buildStreamHeaders } from "./musicApi";
import {
  reconcileAudioCacheEntries,
  type AudioCacheIndexEntry,
  type CachedAudioEntry,
} from "./audioCacheListModel";
import { usePlayerStore } from "@/stores/playerStore";
import { logger } from "@/services/logger";
import { commitDownloadedFile, createPartialDownloadPath, discardPartialDownload, isPartialDownload, removeOrphanedPartialDownloads } from "./fileDownloadCommit";

// 缓存目录
const CACHE_DIR = `${RNFS.CachesDirectoryPath}/auralflow`;
const COVER_CACHE_DIR = `${CACHE_DIR}/covers`;
const LYRIC_CACHE_DIR = `${CACHE_DIR}/lyrics`;
const AUDIO_CACHE_DIR = `${CACHE_DIR}/audio`;

/** 仅这些音源的音质 URL 稳定可落盘缓存（对齐桌面端 CACHEABLE_AUDIO_SOURCES；预读下一首时后台整曲落盘，切歌即本地播放，下载失败静默由在线流兜底） */
export const CACHEABLE_AUDIO_SOURCES = new Set<string>(["wy", "tx"]);

function normalizeKeyPart(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "unknown";
}

function getAudioCacheFilePath(music: MusicInfo, quality: string): string {
  const name = `${normalizeKeyPart(music.source)}-${normalizeKeyPart(music.id)}-${normalizeKeyPart(quality)}`;
  return `${AUDIO_CACHE_DIR}/${name}.audio`;
}

// 缓存配置
// 整曲落盘缓存的总容量上限。此前 100MB 时十几首 flac/二三十首 320k 就把重听曲目
// LRU 驱逐出去，「以前听过的重新听」永远 miss 缓存、走完整解析链；提到 2GB 后
// 常听曲目能稳定驻留（file:// 命中不探活、离线可播，对齐 ExoPlayer SimpleCache 的量级）。
// 磁盘空间不足的兜底见 autoCleanCache（启动时检查，剩余 <500MB 清 7 天前文件）。
const MAX_CACHE_SIZE = 2 * 1024 * 1024 * 1024; // 2GB
// 歌词内容可能随版权/修词更新，保留 30 天过期；封面/音频采用 lx 的 immutable 语义
// （URL 不变永不过期，仅受容量上限 LRU 约束），避免定期失效导致重新下载。
const MAX_CACHE_AGE = 30 * 24 * 60 * 60 * 1000; // 30天（仅歌词使用）
// CDN 下载超时：弱网/断网时 RNFS.downloadFile 可能长期挂起，若不中断会把 InFlight
// 条目永久占用，同 URL 后续请求永远复用同一个 pending Promise。超时后停止下载并
// 在 catch/finally 清理 InFlight，标记失败，下一个请求可重试。
const DOWNLOAD_TIMEOUT_MS = 30_000;

export interface CacheStats {
  totalSize: number;
  coverCacheSize: number;
  lyricCacheSize: number;
  audioCacheSize: number;
  otherCacheSize: number;
}

const emptyCacheStats = (): CacheStats => ({
  totalSize: 0,
  coverCacheSize: 0,
  lyricCacheSize: 0,
  audioCacheSize: 0,
  otherCacheSize: 0,
});

/**
 * 初始化缓存目录
 */
let partialRecovery: Promise<void> | undefined;

async function initCacheDirectories(): Promise<void> {
  try {
    const dirs = [CACHE_DIR, COVER_CACHE_DIR, LYRIC_CACHE_DIR, AUDIO_CACHE_DIR];
    for (const dir of dirs) {
      const exists = await RNFS.exists(dir);
      if (!exists) {
        await RNFS.mkdir(dir);
      }
    }
    if (!partialRecovery) {
      partialRecovery = Promise.all([COVER_CACHE_DIR, AUDIO_CACHE_DIR].map(removeOrphanedPartialDownloads))
        .then(() => undefined)
        .catch((error) => { partialRecovery = undefined; throw error; });
    }
    await partialRecovery;
  } catch (error) {
    throw error;
  }
}

/**
 * 生成缓存文件名（基于 URL 的真正 MD5，32 位小写十六进制）
 */
function getCacheFileName(url: string): string {
  return CryptoJS.MD5(url).toString();
}

/**
 * 获取缓存文件路径
 */
function getCacheFilePath(url: string, type: "cover" | "lyric"): string {
  const fileName = getCacheFileName(url);
  const ext = type === "cover" ? ".jpg" : ".json";
  const dir = type === "cover" ? COVER_CACHE_DIR : LYRIC_CACHE_DIR;
  return `${dir}/${fileName}${ext}`;
}

/**
 * 检查缓存文件是否存在（封面/音频：immutable，不做过期校验，仅容量 LRU 控制）。
 * 歌词调用方用 isCacheValidWithAge 校验 30 天有效期。
 */
async function isCacheFileExists(filePath: string): Promise<boolean> {
  try {
    return await RNFS.exists(filePath);
  } catch (error) {
    return false;
  }
}

/**
 * 检查缓存是否存在且未过期（仅歌词使用）。
 */
async function isCacheValidWithAge(filePath: string): Promise<boolean> {
  try {
    if (!(await isCacheFileExists(filePath))) return false;
    const stat = await RNFS.stat(filePath);
    const age = Date.now() - new Date(stat.mtime).getTime();
    return age < MAX_CACHE_AGE;
  } catch (error) {
    return false;
  }
}

/** 封面与音频共用文件提交边界；同一路径只允许一个写入任务。 */
const cacheDownloadsInFlight = new Map<string, Promise<string | null>>();

async function downloadCacheFile(url: string, filePath: string, headers: Record<string, string> | undefined, onCommitted?: () => Promise<void>): Promise<string | null> {
  const running = cacheDownloadsInFlight.get(filePath);
  if (running) return running;
  const partialPath = createPartialDownloadPath(filePath);
  const task = (async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abandoned = false;
    const cleanLateDownload = async () => {
      if (abandoned) await discardPartialDownload(partialPath);
    };
    try {
      const download = RNFS.downloadFile({ fromUrl: url, toFile: partialPath, headers });
      // stopDownload 不保证原生 Promise 立即结束；迟到写入只能清理本次独占临时文件。
      void download.promise.then(cleanLateDownload, cleanLateDownload).catch((error) => {
        logger.warn("清理迟到缓存下载失败", error);
      });
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          try {
            RNFS.stopDownload(download.jobId);
          } catch (error) {
            logger.warn("停止超时缓存下载失败", error);
          }
          reject(new Error("缓存下载超时"));
        }, DOWNLOAD_TIMEOUT_MS);
      });
      const result = await Promise.race([download.promise, timeout]);
      if (result.statusCode < 200 || result.statusCode >= 300) throw new Error(`缓存下载失败，HTTP ${result.statusCode}`);
      await commitDownloadedFile(partialPath, filePath, result.bytesWritten);
      await onCommitted?.();
      scheduleEnforceCacheSizeLimit();
      return `file://${filePath}`;
    } catch (error) {
      abandoned = true;
      logger.warn("缓存下载未完成", error);
      // 缓存是可选加速；失败明确记入日志，调用方保留已有在线播放路径。
      await discardPartialDownload(partialPath);
      return null;
    } finally {
      if (timer) clearTimeout(timer);
      cacheDownloadsInFlight.delete(filePath);
    }
  })();
  cacheDownloadsInFlight.set(filePath, task);
  return task;
}

export async function cacheCover(url: string): Promise<string | null> {
  if (!url) return null;
  const targetUrl = resizeCoverUrl(url, COVER_SIZE_LARGE);
  await initCacheDirectories();
  const filePath = getCacheFilePath(targetUrl, "cover");
  const running = cacheDownloadsInFlight.get(filePath);
  if (running) return running;
  if (await isCacheFileExists(filePath)) return `file://${filePath}`;
  return downloadCacheFile(targetUrl, filePath, {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Safari/537.36",
  });
}

/**
 * 获取缓存的封面路径
 */
export async function getCachedCover(url: string): Promise<string | null> {
  if (!url) return null;

  // 与 cacheCover 同步：按大图规格查缓存，保证同一 URL 两边命中同一文件
  const filePath = getCacheFilePath(resizeCoverUrl(url, COVER_SIZE_LARGE), "cover");
  if (await isCacheFileExists(filePath)) {
    return `file://${filePath}`;
  }

  return null;
}

/**
 * 缓存歌词
 */
export async function cacheLyrics(
  song: MusicInfo,
  lyrics: Array<{ time: number; text: string }>
): Promise<void> {
  await initCacheDirectories();

  const key = `${song.source}-${song.id}`;
  const filePath = getCacheFilePath(key, "lyric");

  try {
    const data = {
      song: {
        id: song.id,
        name: song.name,
        singer: song.singer,
        source: song.source,
      },
      lyrics,
      cachedAt: Date.now(),
    };

    await RNFS.writeFile(filePath, JSON.stringify(data), "utf8");
    scheduleEnforceCacheSizeLimit();
  } catch {}
}

/**
 * 获取缓存的歌词
 */
export async function getCachedLyrics(
  song: MusicInfo
): Promise<Array<{ time: number; text: string }> | null> {
  const key = `${song.source}-${song.id}`;
  const filePath = getCacheFilePath(key, "lyric");

  if (!(await isCacheValidWithAge(filePath))) {
    return null;
  }

  try {
    const content = await RNFS.readFile(filePath, "utf8");
    const data = JSON.parse(content);
    return data.lyrics;
  } catch (error) {
    return null;
  }
}

/**
 * 读取本地缓存的音频文件路径（file://）。不存在或大小为 0 返回 null。
 */
export async function getCachedAudioFile(music: MusicInfo, quality: string): Promise<string | null> {
  const filePath = getAudioCacheFilePath(music, quality);
  try {
    if (!(await RNFS.exists(filePath))) return null;
    const stat = await RNFS.stat(filePath);
    if (!stat.size || stat.size <= 0) return null;
    return `file://${filePath}`;
  } catch {
    return null;
  }
}

/** 完整音频才可命中；下载中内容保持在独立临时路径。 */
export async function cacheAudioFile(
  url: string,
  music: MusicInfo,
  quality: string,
  headers?: Record<string, string>,
): Promise<string | null> {
  if (!/^https?:\/\//i.test(url)) return null;
  await initCacheDirectories();
  const filePath = getAudioCacheFilePath(music, quality);
  const running = cacheDownloadsInFlight.get(filePath);
  if (running) return running;
  const existing = await getCachedAudioFile(music, quality);
  if (existing) return existing;
  return downloadCacheFile(url, filePath, headers ?? buildStreamHeaders(music.source),
    () => recordAudioCacheIndex(music, quality, filePath));
}

/** 校验 file:// 本地文件是否仍存在（清理策略可能已回收）。 */
export async function isLocalFilePlayable(fileUrl: string): Promise<boolean> {
  const path = fileUrl.replace(/^file:\/\//, "");
  try {
    return await RNFS.exists(path);
  } catch {
    return false;
  }
}

// ============ 已缓存歌曲索引（歌名/歌手元数据，供缓存列表展示） ============
// 磁盘文件名只有 {source}-{id}-{quality}，不含歌曲名；索引存 AsyncStorage，
// 与磁盘的对齐（LRU 淘汰/清缓存导致的漂移）在 listCachedAudio 里完成。

const AUDIO_CACHE_INDEX_KEY = "auralflow.mobile.audioCacheIndex.v1";

async function loadAudioCacheIndex(): Promise<Record<string, AudioCacheIndexEntry>> {
  try {
    const raw = await AsyncStorage.getItem(AUDIO_CACHE_INDEX_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, AudioCacheIndexEntry>) : {};
  } catch {
    return {};
  }
}

async function saveAudioCacheIndex(index: Record<string, AudioCacheIndexEntry>): Promise<void> {
  try {
    await AsyncStorage.setItem(AUDIO_CACHE_INDEX_KEY, JSON.stringify(index));
  } catch {}
}

function getAudioCacheFileBase(music: MusicInfo, quality: string): string {
  return getAudioCacheFilePath(music, quality).split("/").pop()!.replace(/\.audio$/, "");
}

/** 缓存成功后记录歌曲元数据，供「已缓存歌曲」列表展示。 */
async function recordAudioCacheIndex(
  music: MusicInfo,
  quality: string,
  filePath: string,
): Promise<void> {
  const index = await loadAudioCacheIndex();
  index[getAudioCacheFileBase(music, quality)] = {
    name: music.name,
    singer: music.singer,
    source: music.source,
    quality,
    path: filePath,
    cachedAt: Date.now(),
  };
  await saveAudioCacheIndex(index);
}

/** 列出磁盘上仍存在的音频缓存，附歌曲元数据（索引缺失时降级为文件名解析）。 */
export async function listCachedAudio(): Promise<CachedAudioEntry[]> {
  await initCacheDirectories();
  let files: { base: string; path: string; size: number }[] = [];
  try {
    if (await RNFS.exists(AUDIO_CACHE_DIR)) {
      const dirEntries = await RNFS.readDir(AUDIO_CACHE_DIR);
      files = dirEntries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".audio"))
        .map((entry) => ({
          base: entry.name.replace(/\.audio$/, ""),
          path: entry.path,
          size: entry.size || 0,
        }));
    }
  } catch {
    return [];
  }
  const index = await loadAudioCacheIndex();
  const { entries, staleKeys } = reconcileAudioCacheEntries(index, files);
  if (staleKeys.length > 0) {
    const pruned = { ...index };
    for (const key of staleKeys) delete pruned[key];
    await saveAudioCacheIndex(pruned);
  }
  return entries;
}

/** 删除单条音频缓存文件及其索引记录。 */
export async function deleteCachedAudio(entry: CachedAudioEntry): Promise<void> {
  await RNFS.unlink(entry.path).catch(() => undefined);
  const index = await loadAudioCacheIndex();
  delete index[entry.key];
  await saveAudioCacheIndex(index);
}

/**
 * 按曲删除磁盘上的全部音频缓存（各音质档），用于试听片段 / 坏链的定向失效。
 *
 * 必须存在的原因：解析链先查磁盘音频文件、命中即直接返回（不经任何试听判定），
 * 所以只清持久化 URL 缓存不足以摆脱一个已落盘的试听片段——下一次播放仍会命中它，
 * 形成「命中 → 播放试听 → 播放期判定 → 只清 URL → 再命中」的死循环。
 */
export async function deleteCachedAudioForMusic(music: MusicInfo): Promise<void> {
  const prefix = `${normalizeKeyPart(music.source)}-${normalizeKeyPart(music.id)}-`;
  await initCacheDirectories();
  try {
    const dirEntries = await RNFS.readDir(AUDIO_CACHE_DIR);
    for (const entry of dirEntries) {
      if (!entry.isFile() || !entry.name.endsWith(".audio")) continue;
      if (!entry.name.startsWith(prefix)) continue;
      await RNFS.unlink(entry.path).catch(() => undefined);
    }
  } catch {
    // 目录不存在或读取失败：没有可删的文件，索引清理照常进行
  }
  const index = await loadAudioCacheIndex();
  let changed = false;
  for (const key of Object.keys(index)) {
    if (key.startsWith(prefix)) {
      delete index[key];
      changed = true;
    }
  }
  if (changed) await saveAudioCacheIndex(index);
}

/**
 * 写缓存后延迟去抖触发容量上限清理，避免每次写入都遍历文件系统。
 */
let enforceTimer: ReturnType<typeof setTimeout> | null = null;
export function scheduleEnforceCacheSizeLimit(delayMs = 2000): void {
  if (enforceTimer) {
    clearTimeout(enforceTimer);
  }
  enforceTimer = setTimeout(() => {
    enforceTimer = null;
    void enforceCacheSizeLimit();
  }, delayMs);
}

let enforceInFlight: Promise<void> | null = null;

/** 收集四个缓存目录（含根目录）下的所有文件，附大小与 mtime。 */
async function collectAllCacheFiles(now: number): Promise<CachedFileEntry[]> {
  const files: CachedFileEntry[] = [];
  const dirs = [CACHE_DIR, COVER_CACHE_DIR, LYRIC_CACHE_DIR, AUDIO_CACHE_DIR];
  for (const dir of dirs) {
    try {
      if (!(await RNFS.exists(dir))) continue;
      const entries = await RNFS.readDir(dir);
      for (const entry of entries) {
        if (!entry.isFile() || isPartialDownload(entry.path)) continue;
        files.push({
          path: entry.path,
          size: entry.size || 0,
          mtime: entry.mtime ? new Date(entry.mtime).getTime() : now,
        });
      }
    } catch {
      // 单个目录失败不阻断整体
    }
  }
  return files;
}

/**
 * 容量上限 LRU 清理：总缓存超过 MAX_CACHE_SIZE 时，按最旧优先删除直到低于上限。
 * 并发安全（同一时刻仅执行一次）。
 */
function getProtectedPlaybackCachePaths(): Set<string> {
  const protectedPaths = new Set<string>();
  try {
    const { currentUrl } = usePlayerStore.getState();
    if (currentUrl && currentUrl.startsWith("file://")) {
      protectedPaths.add(currentUrl.slice("file://".length));
    }
  } catch {}
  return protectedPaths;
}

export async function enforceCacheSizeLimit(now = Date.now()): Promise<void> {
  if (enforceInFlight) return enforceInFlight;
  enforceInFlight = (async () => {
    try {
      const files = await collectAllCacheFiles(now);
      // 正在播放的文件（mtime 是下载完成时间而非访问时间：若将其视为 LRU 最旧项淘汰，
      // 会把 TrackPlayer 正在播的本地缓存删掉）。先把它们排除出“可回收”候选，
      // 避免 selectFilesToEvict 因选中它而漏掉其它本可回收的文件。
      const protectedPaths = getProtectedPlaybackCachePaths();
      const evictable = protectedPaths.size > 0
        ? files.filter((file) => !protectedPaths.has(file.path))
        : files;
      const toEvict = selectFilesToEvict(evictable, MAX_CACHE_SIZE);
      if (toEvict.length === 0) return;
      for (const path of toEvict) {
        await RNFS.unlink(path).catch(() => undefined);
      }
      // 兜底说明：被保护的文件不计入“可回收”总量，只剩它在播时目录可能仍略超上限，
      // 属 best-effort——只要正在播的文件在，就不为达标而删除它。
    } catch {} finally {
      enforceInFlight = null;
    }
  })();
  return enforceInFlight;
}

async function getDirectorySize(dir: string): Promise<number> {
  const exists = await RNFS.exists(dir);
  if (!exists) return 0;

  const entries = await RNFS.readDir(dir);
  let totalSize = 0;

  for (const entry of entries) {
    if (entry.isFile()) {
      totalSize += entry.size;
    } else if (entry.isDirectory()) {
      totalSize += await getDirectorySize(entry.path);
    }
  }

  return totalSize;
}

/**
 * 获取缓存分项大小
 */
export async function getCacheStats(): Promise<CacheStats> {
  try {
    const exists = await RNFS.exists(CACHE_DIR);
    if (!exists) return emptyCacheStats();

    const entries = await RNFS.readDir(CACHE_DIR);
    let rootFileSize = 0;

    for (const entry of entries) {
      if (entry.isFile()) {
        rootFileSize += entry.size;
      }
    }

    const coverCacheSize = await getDirectorySize(COVER_CACHE_DIR);
    const lyricCacheSize = await getDirectorySize(LYRIC_CACHE_DIR);
    const audioCacheSize = await getDirectorySize(AUDIO_CACHE_DIR);
    const otherCacheSize = rootFileSize;
    const totalSize = coverCacheSize + lyricCacheSize + audioCacheSize + otherCacheSize;

    return {
      totalSize,
      coverCacheSize,
      lyricCacheSize,
      audioCacheSize,
      otherCacheSize,
    };
  } catch (error) {
    throw error;
  }
}

/**
 * 获取缓存大小
 */
export async function getCacheSize(): Promise<number> {
  const stats = await getCacheStats();
  return stats.totalSize;
}

/**
 * 自动清理缓存
 */
export async function autoCleanCache(): Promise<void> {
  try {
    const fsInfo = await RNFS.getFSInfo();
    if (fsInfo.freeSpace > 500 * 1024 * 1024) return;

    const dirs = [COVER_CACHE_DIR, LYRIC_CACHE_DIR, AUDIO_CACHE_DIR];
    const now = Date.now();
    const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

    let allFiles = [];
    for (const dir of dirs) {
      if (await RNFS.exists(dir)) {
        const files = await RNFS.readDir(dir);
        allFiles.push(...files);
      }
    }

    // 按访问时间排序
    allFiles.sort((a, b) => new Date(a.mtime || 0).getTime() - new Date(b.mtime || 0).getTime());

    let deletedSize = 0;
    const initialSize = await getCacheSize();
    let currentFreeSpace = fsInfo.freeSpace;

    for (const file of allFiles) {
      if (currentFreeSpace > 1024 * 1024 * 1024 && deletedSize > initialSize / 2) break;
      if (!isPartialDownload(file.path) && now - new Date(file.mtime || 0).getTime() > SEVEN_DAYS) {
        deletedSize += file.size;
        await RNFS.unlink(file.path);
        currentFreeSpace += file.size;
      }
    }
  } catch {}
}

/**
 * 清理过期缓存：仅清理歌词缓存（内容可能随版权/修词更新，30 天过期）。
 * 封面/音频采用 immutable 语义（URL 不变永不过期），由容量上限 LRU 自动回收，
 * 避免定期失效导致封面反复重新下载（对齐 lx 的 FastImage immutable 缓存）。
 */

export async function cleanExpiredCache(): Promise<void> {
  try {
    const exists = await RNFS.exists(LYRIC_CACHE_DIR);
    if (!exists) return;

    const files = await RNFS.readDir(LYRIC_CACHE_DIR);
    const now = Date.now();

    for (const file of files) {
      if (!file.isFile() || !file.mtime) continue;
      const mtime = new Date(file.mtime).getTime();
      if (!Number.isFinite(mtime)) continue;
      const age = now - mtime;
      if (age > MAX_CACHE_AGE) {
        await RNFS.unlink(file.path);
      }
    }
  } catch (error) {
    throw error;
  }
}

/**
 * 清空所有缓存
 */
export async function clearAllCache(): Promise<void> {
  try {
    const exists = await RNFS.exists(CACHE_DIR);
    if (exists) {
      await RNFS.unlink(CACHE_DIR);
    }
    await AsyncStorage.removeItem(AUDIO_CACHE_INDEX_KEY);
    await clearPlaybackUrlCache();
    await initCacheDirectories();
  } catch (error) {
    throw error;
  }
}

/**
 * 格式化缓存大小
 */
export function formatCacheSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}
