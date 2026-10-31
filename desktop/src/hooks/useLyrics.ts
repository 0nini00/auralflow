import { useState, useEffect, useMemo } from "react";
import type { MusicInfo } from "@lx/core";
import {
  DEFAULT_LYRIC_LEAD_SECONDS,
  findCurrentLyricLineIndex,
  LYRIC_LINE_ADVANCE_HYSTERESIS_SECONDS,
} from "@lx/core";
import { getLyrics, getLocalLyricsOverride, peekCachedLyrics, type LyricLine } from "@/services/lyricsService";

export type { LyricLine };

interface UseLyricsResult {
  lyrics: LyricLine[];
  currentLine: number;
  isLoading: boolean;
  error: string | null;
}

/**
 * 桌面语义的行定位：首行之前预高亮第一行（core 的 -1 表示「显示空态」，
 * 是移动端的语义）。滞后带与提前量与原桌面实现保持一致。
 */
function findCurrentLyricLine(
  lines: readonly LyricLine[],
  progress: number,
  leadSeconds = DEFAULT_LYRIC_LEAD_SECONDS,
): number {
  if (lines.length === 0) return -1;
  const index = findCurrentLyricLineIndex(lines, progress, {
    leadSeconds,
    hysteresisSeconds: LYRIC_LINE_ADVANCE_HYSTERESIS_SECONDS,
  });
  return index < 0 ? 0 : index;
}

/**
 * 当前曲的歌词。
 *
 * 曾经这里还维护 `origin`（「歌词来自某位的演唱版本」）——那是平台匹配时代的产物，
 * 用来在 UI 上标注异唱。匹配链路删除后，歌词要么来自文件自身、要么来自该曲自己的音源，
 * 不存在「把别人的词套上来」这回事，标注也就不需要了。
 */
export function useLyrics(music: MusicInfo | null, progress: number, offsetSec = 0): UseLyricsResult {
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

    const override = getLocalLyricsOverride(music);
    if (override) {
      setLyrics(override.lines);
      setError(override.error ?? null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    // 进程内缓存同步 peek：命中就立刻显示，避免切歌白屏（持久化层是异步 IPC，
    // 做不到同步首帧；此前这里还有第三层 localStorage，已连同其版本化清理一起删除）。
    const cachedLyrics = peekCachedLyrics(music);
    if (cachedLyrics) {
      setLyrics(cachedLyrics);
      setError(null);
      setIsLoading(false);
    } else {
      // 无缓存：先清掉上一首的歌词，避免短暂显示旧词
      setLyrics([]);
      setError(null);
      setIsLoading(true);
    }

    async function fetchLyrics() {
      // isLoading 已在上面按缓存命中设置过，这里不再重复写同一个值
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

  return { lyrics, currentLine, isLoading, error };
}
