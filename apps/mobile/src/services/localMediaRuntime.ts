import { Image, NativeModules } from "react-native";
import RNFS from "react-native-fs";
import CryptoJS from "crypto-js";
import type { MusicInfo } from "@lx/core";
import { getLyrics } from "./musicApi";
import { cacheCover, enforceCacheSizeLimit } from "./cacheService";
import { createPartialDownloadPath, commitDownloadedFile, discardPartialDownload } from "./fileDownloadCommit";
import { findLocalMediaAssets } from "./localMediaSearchService";
import { createLocalMediaResolver, type LocalAudioAssets, type LocalMediaCache } from "./localMediaAssetsService";

const CACHE_DIRECTORY = `${RNFS.CachesDirectoryPath}/auralflow/lyrics`;
const CACHE_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const IMAGE_TIMEOUT_MS = 10_000;
const cachePath = (key: string) => `${CACHE_DIRECTORY}/local-media-${CryptoJS.SHA256(key).toString()}.json`;
const localPath = (uri: string) => uri.startsWith("file://") ? decodeURIComponent(uri.slice(7)) : uri;

async function readLocal(song: MusicInfo): Promise<LocalAudioAssets> {
  if (!song.url || !/^(file|content):\/\//.test(song.url)) throw new Error("本地歌曲缺少可读取的音频 URI");
  const native = NativeModules.LocalMusicModule as { readAudioAssets?: (uri: string) => Promise<LocalAudioAssets> } | undefined;
  if (!native?.readAudioAssets) throw new Error("本地资料读取原生模块不可用，请安装新版 APK");
  const result = await native.readAudioAssets(song.url);
  if (!result || typeof result.signature !== "string" || !result.signature || !Array.isArray(result.warnings)
    || result.warnings.some(issue => typeof issue !== "string")
    || (result.lyrics !== undefined && typeof result.lyrics !== "string")
    || (result.coverUri !== undefined && (typeof result.coverUri !== "string" || !/^file:\/\//.test(result.coverUri)))) {
    throw new Error("本地资料读取结果无效");
  }
  return result;
}

function validateCache(value: unknown): asserts value is LocalMediaCache {
  const data = value as LocalMediaCache | null;
  if (!data || data.version !== 1 || !Number.isFinite(data.cachedAt) || !Array.isArray(data.lyrics)
    || data.lyrics.some(line => !line || !Number.isFinite(line.time) || line.time < 0 || typeof line.text !== "string"
      || (line.tr !== undefined && typeof line.tr !== "string"))
    || (data.coverUri !== undefined && (typeof data.coverUri !== "string" || !/^(file|content):\/\//.test(data.coverUri)))) {
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

async function validateImage(uri: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error("封面解码超时")), IMAGE_TIMEOUT_MS);
      Image.getSize(uri, (width, height) => {
        if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) resolve();
        else reject(new Error("封面尺寸无效"));
      }, reject);
    });
  } finally { clearTimeout(timer); }
}

async function cover(uri: string): Promise<string | undefined> {
  let resolved: string | undefined;
  if (/^https?:\/\//i.test(uri)) resolved = await cacheCover(uri) ?? undefined;
  else if (uri.startsWith("content://")) resolved = uri;
  else if (uri.startsWith("file://")) resolved = await RNFS.exists(localPath(uri)) ? uri : undefined;
  else throw new Error("封面 URI 格式无效");
  if (!resolved) return undefined;
  await validateImage(resolved);
  return resolved;
}

const resolver = createLocalMediaResolver({
  readLocal, readCache, writeCache, cover,
  parse: raw => getLyrics({ source: "local", id: "local-lyrics", name: "", singer: "", albumName: "", localLyrics: raw }),
  search: findLocalMediaAssets,
  now: Date.now,
});
export const resolveLocalMediaAssets = resolver.resolve;
