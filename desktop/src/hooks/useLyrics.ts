import { useState, useEffect, useMemo } from "react";
import type { LyricOrigin, MusicInfo } from "@lx/core";
import { getLyrics, getLocalLyricsOverride, type LyricLine } from "@/services/lyricsService";
import { findCurrentLyricLine } from "@/services/lyrics/playbackSync";

export type { LyricLine };

interface UseLyricsResult {
  lyrics: LyricLine[];
  currentLine: number;
  isLoading: boolean;
  error: string | null;
  /** 自动匹配的来源标注（如「来自某位的演唱版本」）；手动/本地覆盖与失败结果为 null。 */
  origin: LyricOrigin | null;
}

// v4：v3 及更早的条目由旧解析器写入，缺网易云 eapi 富文本元信息行（作词/作曲等），整体废弃
const LYRICS_CACHE_PREFIX = "auralflow:lyrics:v4:";

function getLyricsCacheKey(music: MusicInfo): string {
  return `${LYRICS_CACHE_PREFIX}${music.source}:${music.id}`;
}

function readCachedLyrics(music: MusicInfo): LyricLine[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(getLyricsCacheKey(music));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { lines?: LyricLine[] };
    return Array.isArray(parsed.lines) ? parsed.lines : null;
  } catch {
    return null;
  }
}

function writeCachedLyrics(music: MusicInfo, lines: LyricLine[]) {
  if (typeof window === "undefined" || lines.length === 0) return;
  try {
    window.localStorage.setItem(getLyricsCacheKey(music), JSON.stringify({ lines }));
  } catch {
    // localStorage can be unavailable or full; lyrics fetching still works without the shared cache.
  }
}

export function useLyrics(music: MusicInfo | null, progress: number, offsetSec = 0): UseLyricsResult {
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [origin, setOrigin] = useState<LyricOrigin | null>(null);

  useEffect(() => {
    if (!music) {
      setLyrics([]);
      setError(null);
      setOrigin(null);
      setIsLoading(false);
      return;
    }

    const override = getLocalLyricsOverride(music);
    if (override) {
      setLyrics(override.lines);
      setError(override.error ?? null);
      // 手动/本地覆盖是权威输入，不来自任何平台匹配，不带来源标注
      setOrigin(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    const cachedLyrics = readCachedLyrics(music);
    if (cachedLyrics) {
      // 内存缓存命中：立刻显示，避免切歌白屏
      setLyrics(cachedLyrics);
      setError(null);
      // localStorage 只存行，来源标注要等下面的网络结果回来才补上
      setOrigin(null);
      setIsLoading(false);
    } else {
      // 无缓存：先清掉上一首的歌词，避免短暂显示旧词
      setLyrics([]);
      setError(null);
      setOrigin(null);
      setIsLoading(true);
    }

    async function fetchLyrics() {
      setIsLoading(!cachedLyrics);
      setError(null);

      try {
        if (!music) return;
        const result = await getLyrics(music);
        if (cancelled) return;

        if (result.error) {
          setError(result.error);
          setLyrics([]);
          setOrigin(null);
        } else {
          setLyrics(result.lines);
          setOrigin(result.origin ?? null);
          writeCachedLyrics(music, result.lines);
        }
      } catch (err) {
        if (cancelled) return;
        setError("获取歌词失败");
        setLyrics([]);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    fetchLyrics();

    return () => {
      cancelled = true;
    };
  }, [
    music?.id,
    music?.source,
    music?.localLyrics,
    music?.localLyricsTranslation,
    music?.localLyricsRomanization,
  ]);

  // 同步计算当前行，不经过 state（避免额外渲染延迟）
  const currentLine = useMemo(() => {
    return findCurrentLyricLine(lyrics, progress + offsetSec);
  }, [progress, lyrics, offsetSec]);

  return { lyrics, currentLine, isLoading, error, origin };
}
