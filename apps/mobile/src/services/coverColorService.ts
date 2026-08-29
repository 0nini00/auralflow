import { NativeModules, Platform } from "react-native";

import { getCachedCover } from "./cacheService";

/**
 * 封面主色调提取服务（沉浸页「氛围色背景」用）。
 *
 * 原生侧用 androidx.palette 提取封面主色；本服务负责：
 * - 优先解析本地封面缓存路径（CachedImage 已下载过的图不重复走网络）；
 * - 按 URL + 主题明暗做会话级缓存与并发去重；
 * - 失败降级为空色值，调用方回退纯主题背景。
 */

export interface CoverColors {
  /** 背景基调色 #RRGGBB；空串表示提取失败 */
  base: string;
  /** 点缀色 #RRGGBB；空串表示无有效变体 */
  accent: string;
}

interface NativeCoverColorModule {
  getCoverColors(url: string, isDark: boolean): Promise<CoverColors>;
}

const nativeModule = (NativeModules as Record<string, unknown>).CoverColorModule as
  | NativeCoverColorModule
  | undefined;

export function isCoverColorSupported(): boolean {
  return Platform.OS === "android" && nativeModule != null;
}

const EMPTY_COLORS: CoverColors = { base: "", accent: "" };
const MAX_CACHE_ENTRIES = 240;

const colorsCache = new Map<string, CoverColors>();
const inFlight = new Map<string, Promise<CoverColors>>();

export async function fetchCoverColors(url: string, isDark: boolean): Promise<CoverColors> {
  if (!url || !nativeModule) return EMPTY_COLORS;
  const cacheKey = `${url}|${isDark ? "d" : "l"}`;
  const cached = colorsCache.get(cacheKey);
  if (cached) return cached;
  const pending = inFlight.get(cacheKey);
  if (pending) return pending;

  const promise = (async () => {
    try {
      // 封面大概率已被 CachedImage 下载过大图规格，优先用本地文件取色
      const localPath = await getCachedCover(url);
      const result = await nativeModule.getCoverColors(localPath ?? url, isDark);
      const colors: CoverColors = {
        base: typeof result?.base === "string" ? result.base : "",
        accent: typeof result?.accent === "string" ? result.accent : "",
      };
      const resolved = colors.base ? colors : EMPTY_COLORS;
      if (colorsCache.size >= MAX_CACHE_ENTRIES) colorsCache.clear();
      colorsCache.set(cacheKey, resolved);
      return resolved;
    } catch {
      return EMPTY_COLORS;
    } finally {
      inFlight.delete(cacheKey);
    }
  })();
  inFlight.set(cacheKey, promise);
  return promise;
}
