import { NativeModules } from "react-native";
import RNFS from "react-native-fs";
import CryptoJS from "crypto-js";
import type { MusicInfo } from "@lx/core";
import { getLyrics } from "./musicApi";
import { enforceCacheSizeLimit } from "./cacheService";
import { createPartialDownloadPath, commitDownloadedFile, discardPartialDownload } from "./fileDownloadCommit";
import { findLocalMediaAssets } from "./localMediaSearchService";
import { createLocalMediaResolver, type LocalAudioAssets, type LocalMediaCache } from "./localMediaAssetsService";

const CACHE_DIRECTORY = `${RNFS.CachesDirectoryPath}/auralflow/lyrics`;
const CACHE_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const cachePath = (key: string) => `${CACHE_DIRECTORY}/local-media-${CryptoJS.SHA256(key).toString()}.json`;

async function readLocal(song: MusicInfo): Promise<LocalAudioAssets> {
  if (!song.url || !/^(file|content):\/\//.test(song.url)) throw new Error("本地歌曲缺少可读取的音频 URI");
  const native = NativeModules.LocalMusicModule as { readAudioAssets?: (uri: string) => Promise<LocalAudioAssets> } | undefined;
  if (!native?.readAudioAssets) throw new Error("本地资料读取原生模块不可用，请安装新版 APK");
  const result = await native.readAudioAssets(song.url);
  if (!result || typeof result.signature !== "string" || !result.signature || !Array.isArray(result.warnings)
    || result.warnings.some(issue => typeof issue !== "string")
    || (result.lyrics !== undefined && typeof result.lyrics !== "string")) {
    throw new Error("本地资料读取结果无效");
  }
  return result;
}

/**
 * 「选择歌词」面板要的两样东西：当前文件指纹（绑定的依据）与文件里已有的歌词文本（本地候选）。
 *
 * 只在用户做出选择的那一刻读一次——指纹不得进入扫描或播放路径（一次原生读取 = 一次全文件
 * SHA-256），否则每次切歌都要为它多付一遍 I/O。
 */
export async function readLocalLyricsFile(song: MusicInfo): Promise<{ fingerprint: string; lyrics?: string }> {
  const assets = await readLocal(song);
  return { fingerprint: assets.signature, ...(assets.lyrics ? { lyrics: assets.lyrics } : {}) };
}

/** 来源标注是可选字段，但出现时必须结构合法：宁可把坏缓存按 miss 处理，也不静默读进不认识的字段。 */
function isLyricOrigin(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const origin = value as { tier?: unknown; performer?: unknown; source?: unknown };
  return (origin.tier === "same-recording" || origin.tier === "other-performer") &&
    (origin.performer === undefined || typeof origin.performer === "string") &&
    (origin.source === undefined || typeof origin.source === "string");
}
function validateCache(value: unknown): asserts value is LocalMediaCache {
  const data = value as LocalMediaCache | null;
  if (!data || data.version !== 1 || !Number.isFinite(data.cachedAt) || !Array.isArray(data.lyrics)
    || data.lyrics.some(line => !line || !Number.isFinite(line.time) || line.time < 0 || typeof line.text !== "string"
      || (line.tr !== undefined && typeof line.tr !== "string"))
    || (data.lyricOrigin !== undefined && !isLyricOrigin(data.lyricOrigin))) {
    throw new Error("本地补全缓存格式无效");
  }
}

async function readCache(key: string): Promise<LocalMediaCache | null> {
  const path = cachePath(key);
  if (!await RNFS.exists(path)) return null;
  const data: unknown = JSON.parse(await RNFS.readFile(path, "utf8"));
  validateCache(data);
  return Date.now() - data.cachedAt > CACHE_AGE_MS ? null : data;
}

const cacheWrites = new Map<string, Promise<void>>();
async function writeCache(key: string, value: LocalMediaCache, isCurrent: () => boolean): Promise<void> {
  validateCache(value);
  const path = cachePath(key);
  const result = (cacheWrites.get(path) ?? Promise.resolve()).then(async () => {
    if (!isCurrent()) return;
    await RNFS.mkdir(CACHE_DIRECTORY);
    if (!isCurrent()) return;
    const partial = createPartialDownloadPath(path);
    try {
      await RNFS.writeFile(partial, JSON.stringify(value), "utf8");
      if (!isCurrent()) return;
      const exists = await RNFS.exists(path);
      if (!isCurrent()) return;
      if (exists) await RNFS.unlink(path);
      if (!isCurrent()) return;
      await commitDownloadedFile(partial, path);
      await enforceCacheSizeLimit();
    } finally { await discardPartialDownload(partial); }
  });
  // 同键串行发布防止旧请求删掉新缓存；失败仍交给原 result 报告。
  const tail = result.then(() => undefined, () => undefined);
  cacheWrites.set(path, tail);
  void tail.then(() => { if (cacheWrites.get(path) === tail) cacheWrites.delete(path); });
  return result;
}

const resolver = createLocalMediaResolver({
  readLocal, readCache, writeCache,
  parse: raw => getLyrics({ source: "local", id: "local-lyrics", name: "", singer: "", albumName: "", localLyrics: raw }),
  search: findLocalMediaAssets,
  now: Date.now,
  /**
   * 改名 / 移动后的选择重绑：本模块已经把文件内容 SHA-256 拿到手（`readLocal`），不必为它多读一次文件。
   *
   * 动态 import 而不是静态引用：认领要写回本地曲库（zustand + AsyncStorage）。没有孤儿时连这份模块
   * 都不必加载，也避免本模块（被 playerService 动态加载）与播放链形成静态环。
   */
  claimOrphanedLyricsChoice: async (song, fingerprint) => {
    const { useLocalMusicStore } = await import("@/stores/localMusicStore");
    const store = useLocalMusicStore?.getState?.();
    // 拿不到曲库（模块未加载完 / 被裁剪）等同于「没有可认领的孤儿」，不阻塞解析。
    return store?.claimOrphanedLyricsChoice ? store.claimOrphanedLyricsChoice(song, fingerprint) : null;
  },
});
export const resolveLocalMediaAssets = resolver.resolve;
