import type { MusicInfo } from '@lx/core';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { resolver } from '@/services/sources/sourceService';
import {
  detectLyricSourceType,
  mergeMissingLines,
  mergeTranslation,
  parseLyricSource,
  type LyricLine,
  type LyricResponse,
  type LyricSourceType,
  type LyricWord,
} from '@/services/lyrics/parserCore';
import { selectBestLyricMatch, type LyricSearchCandidate } from '@/services/lyrics/matchScore';
import { getCachedLyrics, isCacheableEmptyLyricResult, saveCachedLyrics } from '@/services/persistentCache';

export type { LyricLine, LyricResponse, LyricWord };

const lyricsCache = new Map<string, LyricResponse>();

function getCacheKey(music: MusicInfo): string {
  return `${music.source}:${music.id}`;
}

function parseEmbeddedLyrics(content: string): LyricLine[] {
  return parseLyricSource({
    type: detectLyricSourceType(content),
    content,
  });
}

function parseProviderLyrics(lyricResult: {
  lyric?: string;
  yrc?: string;
  qrc?: string;
  krc?: string;
  tlyric?: string;
}): LyricLine[] {
  let lines: LyricLine[] = [];
  if (lyricResult.yrc) {
    lines = parseLyricSource({ type: 'yrc', content: lyricResult.yrc });
    if (lyricResult.lyric) {
      lines = mergeMissingLines(lines, parseLyricSource({ type: 'lrc', content: lyricResult.lyric }));
    }
  } else if (lyricResult.qrc) {
    lines = parseLyricSource({ type: 'qrc', content: lyricResult.qrc });
  } else if (lyricResult.krc) {
    lines = parseLyricSource({ type: 'krc', content: lyricResult.krc });
  } else if (lyricResult.lyric) {
    lines = parseLyricSource({ type: 'auto', content: lyricResult.lyric });
  }
  return mergeTranslation(lines, lyricResult.tlyric);
}

async function fetchNeteaseJson(url: string): Promise<any> {
  const response = await tauriFetch(url, {
    method: 'GET',
    headers: { Referer: 'https://music.163.com' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function normalizeLyricFormat(value?: string | null): LyricSourceType | 'auto' {
  if (value === 'lrc' || value === 'enhanced-lrc' || value === 'yrc' || value === 'qrc' || value === 'krc' || value === 'vtt') {
    return value;
  }
  return 'auto';
}

export async function getLyrics(music: MusicInfo): Promise<LyricResponse> {
  if (!music.id) {
    return { lines: [], error: '歌曲信息不完整' };
  }

  const cacheKey = getCacheKey(music);
  const cached = lyricsCache.get(cacheKey);
  if (cached) return cached;

  try {
    try {
      const persisted = await getCachedLyrics(music);
      if (persisted) {
        lyricsCache.set(cacheKey, persisted);
        return persisted;
      }
    } catch (error) {
      console.warn('读取歌词缓存失败:', error);
    }

    let result: LyricResponse;

    if (music.source === 'local') {
      if ('lyrics' in music && music.lyrics) {
        const lyricFormat = normalizeLyricFormat((music as { lyricFormat?: string }).lyricFormat);
        const lines = parseLyricSource({ type: lyricFormat, content: String(music.lyrics) });
        result = lines.length > 0 ? { lines } : { lines: [], error: '暂无歌词' };
      } else {
        result = await searchAndMatchLyrics(music);
      }
    } else {
      const provider = resolver.getSource(music.source);
      if (!provider) {
        result = { lines: [], error: '不支持的音源' };
      } else {
        const lyricResult = await provider.getLyric(music);
        const lines = parseProviderLyrics(lyricResult);
        result = lines.length > 0 ? { lines } : await searchAndMatchLyrics(music);
      }
    }

    if (result.lines.length > 0 || isCacheableEmptyLyricResult(result)) {
      lyricsCache.set(cacheKey, result);
      void saveCachedLyrics(music, result).catch((error) => {
        console.warn('写入歌词缓存失败:', error);
      });
    } else {
      lyricsCache.delete(cacheKey);
    }
    return result;
  } catch (error) {
    console.error('Failed to get lyrics:', error);
    lyricsCache.delete(cacheKey);
    return { lines: [], error: '获取歌词失败' };
  }
}

async function searchAndMatchLyrics(music: MusicInfo): Promise<LyricResponse> {
  try {
    const keyword = `${music.name} ${music.singer}`.trim();
    if (!keyword) {
      return { lines: [], error: '歌曲信息不完整' };
    }

    const searchUrl = `https://music.163.com/api/search/get/web?s=${encodeURIComponent(keyword)}&type=1&limit=8`;
    const searchData = await fetchNeteaseJson(searchUrl);
    const songs = (searchData.result?.songs || []) as LyricSearchCandidate[];
    if (songs.length === 0) {
      return { lines: [], error: '未找到匹配歌曲' };
    }

    const matchedSong = selectBestLyricMatch(
      {
        name: music.name,
        singer: music.singer,
        albumName: music.albumName,
        interval: music.interval,
      },
      songs,
    ) ?? songs[0];
    const songId = String(matchedSong.id);

    const lyricUrl = `https://music.163.com/api/song/lyric?id=${songId}&lv=1&kv=1&tv=-1`;
    const lyricData = await fetchNeteaseJson(lyricUrl);
    const lines = parseProviderLyrics({
      lyric: lyricData.lrc?.lyric,
      yrc: lyricData.yrc?.lyric,
      tlyric: lyricData.tlyric?.lyric,
    });
    return lines.length > 0 ? { lines } : { lines: [], error: '暂无歌词' };
  } catch (error) {
    console.error('Failed to match lyrics:', error);
    return { lines: [], error: '匹配歌词失败' };
  }
}

export const __lyricsInternals = {
  parseEmbeddedLyrics,
  parseProviderLyrics,
  searchAndMatchLyrics,
};
