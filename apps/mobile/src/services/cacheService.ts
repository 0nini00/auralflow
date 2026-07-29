import RNFS from "react-native-fs";
import { Platform } from "react-native";
import type { MusicInfo } from "@lx/core";
import { clearPlaybackUrlCache } from "./playbackUrlCache";

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
const MAX_CACHE_AGE = 30 * 24 * 60 * 60 * 1000; // 30天

export interface CacheStats {
  totalSize: number;
  coverCacheSize: number;
  lyricCacheSize: number;
  otherCacheSize: number;
}

const emptyCacheStats = (): CacheStats => ({
  totalSize: 0,
  coverCacheSize: 0,
  lyricCacheSize: 0,
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
    console.error("Init cache directories error:", error);
  }
}

/**
 * 生成缓存文件名（基于 URL 的 MD5）
 */
function getCacheFileName(url: string): string {
  // 简单的哈希函数（生产环境建议使用真正的 MD5）
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    const char = url.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
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
 * 检查缓存是否存在且未过期
 */
async function isCacheValid(filePath: string): Promise<boolean> {
  try {
    const exists = await RNFS.exists(filePath);
    if (!exists) return false;

    const stat = await RNFS.stat(filePath);
    const age = Date.now() - new Date(stat.mtime).getTime();
    return age < MAX_CACHE_AGE;
  } catch (error) {
    return false;
  }
}

/**
 * 缓存封面图片
 */
export async function cacheCover(url: string): Promise<string | null> {
  if (!url) return null;

  await initCacheDirectories();

  const filePath = getCacheFilePath(url, "cover");

  // 检查缓存
  if (await isCacheValid(filePath)) {
    return `file://${filePath}`;
  }

  // 下载并缓存
  try {
    const downloadResult = await RNFS.downloadFile({
      fromUrl: url,
      toFile: filePath,
    }).promise;

    if (downloadResult.statusCode === 200) {
      return `file://${filePath}`;
    } else {
      return null;
    }
  } catch (error) {
    console.error("Cache cover error:", error);
    return null;
  }
}

/**
 * 获取缓存的封面路径
 */
export async function getCachedCover(url: string): Promise<string | null> {
  if (!url) return null;

  const filePath = getCacheFilePath(url, "cover");
  if (await isCacheValid(filePath)) {
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
  } catch (error) {
    console.error("Cache lyrics error:", error);
  }
}

/**
 * 获取缓存的歌词
 */
export async function getCachedLyrics(
  song: MusicInfo
): Promise<Array<{ time: number; text: string }> | null> {
  const key = `${song.source}-${song.id}`;
  const filePath = getCacheFilePath(key, "lyric");

  if (!(await isCacheValid(filePath))) {
    return null;
  }

  try {
    const content = await RNFS.readFile(filePath, "utf8");
    const data = JSON.parse(content);
    return data.lyrics;
  } catch (error) {
    console.error("Get cached lyrics error:", error);
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

/**
 * 把音频文件下载到本地缓存目录，返回 file:// 路径。
 * 已存在则直接返回，避免重复下载。仅对可缓存音质 URL 生效（调用方负责筛选音源）。
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

  try {
    const result = await RNFS.downloadFile({ fromUrl: url, toFile: filePath }).promise;
    if (result.statusCode >= 200 && result.statusCode < 300) {
      return `file://${filePath}`;
    }
    await RNFS.unlink(filePath).catch(() => undefined);
    return null;
  } catch (error) {
    console.error("[cacheService] 缓存音频失败:", error);
    return null;
  }
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
    const totalSize = rootFileSize + coverCacheSize + lyricCacheSize;

    return {
      totalSize,
      coverCacheSize,
      lyricCacheSize,
      otherCacheSize: totalSize - coverCacheSize - lyricCacheSize,
    };
  } catch (error) {
    console.error("Get cache stats error:", error);
    return emptyCacheStats();
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
  } catch (error) {
    console.error("Auto clean cache error:", error);
  }
}

/**
 * 清理过期缓存
 */

export async function cleanExpiredCache(): Promise<void> {
  try {
    const dirs = [COVER_CACHE_DIR, LYRIC_CACHE_DIR, AUDIO_CACHE_DIR];

    for (const dir of dirs) {
      const exists = await RNFS.exists(dir);
      if (!exists) continue;

      const files = await RNFS.readDir(dir);
      const now = Date.now();

      for (const file of files) {
        const mtime = file.mtime ? new Date(file.mtime).getTime() : 0;
        const age = now - mtime;
        if (age > MAX_CACHE_AGE) {
          await RNFS.unlink(file.path);
        }
      }
    }
  } catch (error) {
    console.error("Clean expired cache error:", error);
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
    console.error("Clear all cache error:", error);
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
