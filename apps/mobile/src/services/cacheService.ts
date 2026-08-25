import RNFS from "react-native-fs";
import CryptoJS from "crypto-js";
import { Platform } from "react-native";
import { COVER_SIZE_LARGE, resizeCoverUrl, type MusicInfo } from "@lx/core";
import { clearPlaybackUrlCache } from "./playbackUrlCache";
import { selectFilesToEvict, type CachedFileEntry } from "./cacheEvictionModel";

// 缓存目录
const CACHE_DIR = `${RNFS.CachesDirectoryPath}/auralflow`;
const COVER_CACHE_DIR = `${CACHE_DIR}/covers`;
const LYRIC_CACHE_DIR = `${CACHE_DIR}/lyrics`;
const AUDIO_CACHE_DIR = `${CACHE_DIR}/audio`;

/** 仅这些音源的音质 URL 稳定可落盘缓存（对齐桌面端 CACHEABLE_AUDIO_SOURCES） */
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
const MAX_CACHE_SIZE = 100 * 1024 * 1024; // 100MB
// 歌词内容可能随版权/修词更新，保留 30 天过期；封面/音频采用 lx 的 immutable 语义
// （URL 不变永不过期，仅受容量上限 LRU 约束），避免定期失效导致重新下载。
const MAX_CACHE_AGE = 30 * 24 * 60 * 60 * 1000; // 30天（仅歌词使用）

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
async function initCacheDirectories(): Promise<void> {
  try {
    const dirs = [CACHE_DIR, COVER_CACHE_DIR, LYRIC_CACHE_DIR, AUDIO_CACHE_DIR];
    for (const dir of dirs) {
      const exists = await RNFS.exists(dir);
      if (!exists) {
        await RNFS.mkdir(dir);
      }
    }
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

/** 同一封面 URL 的进行中下载去重（避免多行并发写同一文件导致损坏）。 */
const coverDownloadsInFlight = new Map<string, Promise<string | null>>();

/**
 * 缓存封面图片
 */
export async function cacheCover(url: string): Promise<string | null> {
  if (!url) return null;

  // 缓存大图规格而非原图（对齐桌面端 cacheMusicCover）：图床原图常有数 MB，
  // resizeCoverUrl 只对已知图床域名改写（网易云 ?param=NxN / B站 @Nw_Nh.webp），其他原样。
  const targetUrl = resizeCoverUrl(url, COVER_SIZE_LARGE);

  await initCacheDirectories();

  const filePath = getCacheFilePath(targetUrl, "cover");

  // 检查缓存（immutable：URL 不变永不过期，对齐 lx）
  if (await isCacheFileExists(filePath)) {
    return `file://${filePath}`;
  }

  // 并发去重：同 URL 正在下载时直接复用同一 Promise
  const inFlight = coverDownloadsInFlight.get(filePath);
  if (inFlight) return inFlight;

  const promise = (async () => {
    // 下载并缓存（带 UA 请求头，对齐 lx defaultHeaders，避免部分图床 403）
    try {
      const downloadResult = await RNFS.downloadFile({
        fromUrl: targetUrl,
        toFile: filePath,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Safari/537.36",
        },
      }).promise;

      if (downloadResult.statusCode === 200) {
        scheduleEnforceCacheSizeLimit();
        return `file://${filePath}`;
      }
      // 非 200（404/403 等）：清理残留的响应体文件，避免下次被误判为有效缓存
      await RNFS.unlink(filePath).catch(() => undefined);
      return null;
    } catch (error) {
      // 下载中断（网络错误）同样会留下部分文件，必须清理，否则下次会被误判为有效 immutable 缓存
      await RNFS.unlink(filePath).catch(() => undefined);
      return null;
    } finally {
      coverDownloadsInFlight.delete(filePath);
    }
  })();
  coverDownloadsInFlight.set(filePath, promise);
  return promise;
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

/** 同一音频缓存文件的进行中下载去重（预读缓存、手动下载、再次播放可能并发触发同一文件）。 */
const audioDownloadsInFlight = new Map<string, Promise<string | null>>();

/**
 * 把音频文件下载到本地缓存目录，返回 file:// 路径。
 * 已存在则直接返回，避免重复下载；同文件并发下载复用同一 Promise。
 * 仅对可缓存音质 URL 生效（调用方负责筛选音源）。
 */
export async function cacheAudioFile(
  url: string,
  music: MusicInfo,
  quality: string,
): Promise<string | null> {
  if (!/^https?:\/\//i.test(url)) return null;
  await initCacheDirectories();
  const filePath = getAudioCacheFilePath(music, quality);

  const existing = await getCachedAudioFile(music, quality);
  if (existing) return existing;

  const inFlight = audioDownloadsInFlight.get(filePath);
  if (inFlight) return inFlight;

  const promise = (async () => {
    try {
      const result = await RNFS.downloadFile({ fromUrl: url, toFile: filePath }).promise;
      if (result.statusCode >= 200 && result.statusCode < 300) {
        scheduleEnforceCacheSizeLimit();
        return `file://${filePath}`;
      }
      await RNFS.unlink(filePath).catch(() => undefined);
      return null;
    } catch (error) {
      // 下载中断会留下部分文件（可能非空），清理避免被 getCachedAudioFile 误判为完整缓存
      await RNFS.unlink(filePath).catch(() => undefined);
      return null;
    } finally {
      audioDownloadsInFlight.delete(filePath);
    }
  })();
  audioDownloadsInFlight.set(filePath, promise);
  return promise;
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
        if (!entry.isFile()) continue;
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
export async function enforceCacheSizeLimit(now = Date.now()): Promise<void> {
  if (enforceInFlight) return enforceInFlight;
  enforceInFlight = (async () => {
    try {
      const files = await collectAllCacheFiles(now);
      const toEvict = selectFilesToEvict(files, MAX_CACHE_SIZE);
      if (toEvict.length === 0) return;
      for (const path of toEvict) {
        await RNFS.unlink(path).catch(() => undefined);
      }
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
      if (now - new Date(file.mtime || 0).getTime() > SEVEN_DAYS) {
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
