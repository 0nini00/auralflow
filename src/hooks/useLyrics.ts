import { useState, useEffect, useMemo } from "react";
import type { MusicInfo } from "@lx/core";
import { getLyrics, type LyricLine } from "@/services/lyricsService";

export type { LyricLine };

interface UseLyricsResult {
  lyrics: LyricLine[];
  currentLine: number;
  isLoading: boolean;
  error: string | null;
}

const LYRICS_CACHE_PREFIX = "auralflow:lyrics:v3:";

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

export function useLyrics(music: MusicInfo | null, progress: number): UseLyricsResult {
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!music) {
      setLyrics([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    const cachedLyrics = readCachedLyrics(music);
    if (cachedLyrics) {
      setLyrics(cachedLyrics);
      setError(null);
      setIsLoading(false);
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
        } else {
          setLyrics(result.lines);
          writeCachedLyrics(music, result.lines);
        }
      } catch (err) {
        if (cancelled) return;
        console.error("Failed to fetch lyrics:", err);
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
  }, [music?.id, music?.source]);

  // 同步计算当前行，不经过 state（避免额外渲染延迟）
  const currentLine = useMemo(() => {
    if (lyrics.length === 0) return -1;
    for (let i = lyrics.length - 1; i >= 0; i--) {
      if (progress + 0.08 >= lyrics[i].time) {
        return i;
      }
    }
    // 前奏阶段（progress 小于第一行时间）：高亮首行，而非返回 -1 导致不滚动
    return 0;
  }, [progress, lyrics]);

  return { lyrics, currentLine, isLoading, error };
}
