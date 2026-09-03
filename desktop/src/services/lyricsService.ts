import {
  detectLyricSourceType,
  mergeMissingLines,
  mergeTranslation,
  parseLyricSource,
  type LyricLine,
  type LyricResponse,
  type LyricSourceType,
  type LyricWord,
  type MusicInfo,
} from '@lx/core';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { getSource } from '@/services/sources/sourceService';
import {
  MIN_LYRIC_MATCH_SCORE,
  rankLyricMatches,
  selectBestLyricMatch,
  type LyricSearchCandidate,
} from '@/services/lyrics/matchScore';
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

/** 播放链路有时会在 music 上挂 variants（多源同曲）；类型上未声明，这里兼容读取。 */
function getMusicVariants(music: MusicInfo): MusicInfo[] {
  const raw = (music as MusicInfo & { variants?: MusicInfo[] }).variants;
  if (!Array.isArray(raw) || raw.length === 0) return [];
  return raw.filter(
    (item) =>
      item &&
      typeof item.id === 'string' &&
      item.id &&
      // 排除与主曲完全相同的 source:id，避免重复请求
      `${item.source}:${item.id}` !== `${music.source}:${music.id}`,
  );
}

function dedupeMusicCandidates(list: MusicInfo[]): MusicInfo[] {
  const seen = new Set<string>();
  const out: MusicInfo[] = [];
  for (const item of list) {
    if (!item?.id) continue;
    const key = `${item.source}:${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/** 单曲拉取（不含跨 variant 回退）；结果写入该曲自己的缓存键。 */
async function getLyricsForSingle(music: MusicInfo): Promise<LyricResponse> {
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
    }

    let result: LyricResponse;

    if (music.source === 'bili') {
      // B站:先取视频 CC 字幕当歌词,无字幕再走外部兜底(LRC Lib → 网易搜索)
      const provider = getSource('bili');
      try {
        const lyricResult = await provider?.getLyric(music);
        const lines = lyricResult ? parseProviderLyrics(lyricResult) : [];
        result = lines.length > 0 ? { lines } : await searchAndMatchLyrics(music);
      } catch {
        result = await searchAndMatchLyrics(music);
      }
    } else if (music.source === 'local') {
      if ('lyrics' in music && music.lyrics) {
        const lyricFormat = normalizeLyricFormat((music as { lyricFormat?: string }).lyricFormat);
        const lines = parseLyricSource({ type: lyricFormat, content: String(music.lyrics) });
        result = lines.length > 0 ? { lines } : { lines: [], error: '暂无歌词' };
      } else if ('localLyrics' in music && (music as { localLyrics?: string }).localLyrics) {
        const lines = parseEmbeddedLyrics(String((music as { localLyrics?: string }).localLyrics));
        result = lines.length > 0 ? { lines } : { lines: [], error: '暂无歌词' };
      } else {
        result = await searchAndMatchLyrics(music);
      }
    } else {
      const provider = getSource(music.source);
      if (!provider) {
        result = { lines: [], error: '不支持的音源' };
      } else {
        try {
          const lyricResult = await provider.getLyric(music);
          const lines = parseProviderLyrics(lyricResult);
          result = lines.length > 0 ? { lines } : await searchAndMatchLyrics(music);
        } catch (providerError) {
          // 音源歌词接口抛错时不要直接失败：走网易云搜索匹配兜底
          result = await searchAndMatchLyrics(music);
        }
      }
    }

    if (result.lines.length > 0 || isCacheableEmptyLyricResult(result)) {
      lyricsCache.set(cacheKey, result);
      void saveCachedLyrics(music, result).catch(() => undefined);
    } else {
      lyricsCache.delete(cacheKey);
    }
    return result;
  } catch (error) {
    lyricsCache.delete(cacheKey);
    return { lines: [], error: '获取歌词失败' };
  }
}

/**
 * 获取歌词。
 * - 先拉主曲
 * - 主曲无词时，按 variants（多源同曲）依次回退
 * - 多个有词结果时，用内容质量分择优，并写回主曲缓存键（下次直接命中）
 */
export async function getLyrics(
  music: MusicInfo,
  variants?: MusicInfo[],
): Promise<LyricResponse> {
  if (!music.id) {
    return { lines: [], error: '歌曲信息不完整' };
  }

  const primaryKey = getCacheKey(music);
  const cached = lyricsCache.get(primaryKey);
  if (cached?.lines?.length) return cached;

  const attached = getMusicVariants(music);
  const candidates = dedupeMusicCandidates([
    music,
    ...(variants ?? []),
    ...attached,
  ]);

  let best: { result: LyricResponse; quality: number; isPrimary: boolean } | null = null;
  let lastEmpty: LyricResponse | null = null;

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const isPrimary = candidate.source === music.source && candidate.id === music.id;
    try {
      const result = await getLyricsForSingle(candidate);
      if (result.lines.length === 0) {
        lastEmpty = result;
        continue;
      }
      const quality = scoreLyricContentQuality(result.lines);
      // 主曲略加权，避免被弱相关 variant 抢走
      const total = quality + (isPrimary ? 6 : 0);
      if (!best || total > best.quality) {
        best = { result, quality: total, isPrimary };
      }
      // 主曲已经很好（有逐字）就不必再扫 variant
      if (isPrimary && quality >= 50) break;
      // variant 已经足够好也可以停
      if (!isPrimary && quality >= 60) break;
    } catch (err) {
    }
  }

  if (best) {
    // 写回主曲缓存键，后续切歌/重开直接用
    lyricsCache.set(primaryKey, best.result);
    void saveCachedLyrics(music, best.result).catch(() => undefined);
    return best.result;
  }

  const empty = lastEmpty ?? { lines: [], error: '暂无歌词' };
  if (isCacheableEmptyLyricResult(empty)) {
    lyricsCache.set(primaryKey, empty);
    void saveCachedLyrics(music, empty).catch(() => {});
  }
  return empty;
}


/** 歌词内容质量分：逐字 > 行数适中 > 有翻译 > 非空 */
function scoreLyricContentQuality(lines: LyricLine[]): number {
  if (lines.length === 0) return 0;
  let score = 0;
  // 行数：过少可能残缺，过多可能混进脏数据
  if (lines.length >= 8 && lines.length <= 120) score += 24;
  else if (lines.length >= 4) score += 14;
  else score += 6;

  const withWords = lines.filter((l) => (l.words?.length ?? 0) > 0).length;
  const wordRatio = withWords / lines.length;
  score += Math.round(wordRatio * 40); // 逐字时间轴很值钱

  const withTr = lines.filter((l) => !!(l.tr && l.tr.trim())).length;
  if (withTr > 0) score += 10;

  // 时间轴覆盖：首尾跨度合理
  const times = lines.map((l) => l.time).filter((x) => Number.isFinite(x));
  if (times.length >= 2) {
    const span = times[times.length - 1] - times[0];
    if (span >= 30 && span <= 600) score += 12;
    else if (span > 0) score += 4;
  }

  // 空行过多扣分
  const emptyRatio = lines.filter((l) => !(l.text && l.text.trim())).length / lines.length;
  score -= Math.round(emptyRatio * 20);

  return Math.max(0, score);
}

const MAX_LYRIC_CANDIDATES_TO_TRY = 3;

/**
 * LRC Lib(https://lrclib.net)按「标题 + 歌手 + 时长」直查。
 *
 * 返回三态:
 *  - `null`         无结果或请求不可用(继续走网易搜索兜底)
 *  - `"instrumental"` 命中且明确为纯音乐(无词,直接结束,不必再搜)
 *  - `LyricLine[]`  命中歌词
 */
async function fetchLrclibLyrics(
  music: MusicInfo,
): Promise<LyricLine[] | "instrumental" | null> {
  const title = music.name?.trim();
  const artist = music.singer?.trim();
  if (!title || !artist) return null;

  const params = new URLSearchParams({
    artist_name: artist,
    track_name: title,
  });
  const interval = music.interval;
  const durationSec = typeof interval === "number" && Number.isFinite(interval) ? Math.round(interval) : 0;
  if (durationSec > 0) params.set("duration", String(durationSec));

  const response = await tauriFetch(`https://lrclib.net/api/get?${params.toString()}`, {
    method: "GET",
    headers: {
      "User-Agent": "AuralFlow/0.1 (https://github.com/0nini00/auralflow)",
    },
  });
  if (!response.ok) return null;
  const data = (await response.json()) as {
    syncedLyrics?: string;
    plainLyrics?: string;
    instrumental?: boolean;
  };
  if (data.instrumental) return "instrumental";
  const source = data.syncedLyrics || data.plainLyrics;
  if (!source) return null;
  const lines = parseLyricSource({ content: source });
  return lines.length > 0 ? lines : null;
}

async function searchAndMatchLyrics(music: MusicInfo): Promise<LyricResponse> {
  try {
    // 先试 LRC Lib:标题/歌手直查,命中即返回,省去网易搜索+打分
    try {
      const lrclibResult = await fetchLrclibLyrics(music);
      if (lrclibResult === "instrumental") return { lines: [], error: "暂无歌词" };
      if (lrclibResult && lrclibResult.length > 0) return { lines: lrclibResult };
    } catch {
      // LRC Lib 不可用(网络/限流)时静默走网易搜索兜底
    }

    const keyword = `${music.name} ${music.singer}`.trim();
    if (!keyword) {
      return { lines: [], error: '歌曲信息不完整' };
    }

    const target = {
      name: music.name,
      singer: music.singer,
      albumName: music.albumName,
      interval: music.interval,
    };

    const searchUrl = `https://music.163.com/api/search/get/web?s=${encodeURIComponent(keyword)}&type=1&limit=8`;
    const searchData = await fetchNeteaseJson(searchUrl);
    const songs = (searchData.result?.songs || []) as LyricSearchCandidate[];
    if (songs.length === 0) {
      return { lines: [], error: '未找到匹配歌曲' };
    }

    // 多源精选：对 top-N 高匹配候选分别拉歌词，综合「匹配分 + 内容质量」择优
    const ranked = rankLyricMatches(target, songs).filter((item) => item.score >= MIN_LYRIC_MATCH_SCORE);
    const shortlist = (ranked.length > 0 ? ranked : rankLyricMatches(target, songs)).slice(
      0,
      MAX_LYRIC_CANDIDATES_TO_TRY,
    );

    let best: { lines: LyricLine[]; total: number } | null = null;

    for (const item of shortlist) {
      try {
        const songId = String(item.candidate.id);
        const lyricUrl = `https://music.163.com/api/song/lyric?id=${songId}&lv=1&kv=1&tv=-1`;
        const lyricData = await fetchNeteaseJson(lyricUrl);
        const lines = parseProviderLyrics({
          lyric: lyricData.lrc?.lyric,
          yrc: lyricData.yrc?.lyric,
          tlyric: lyricData.tlyric?.lyric,
        });
        if (lines.length === 0) continue;

        // 匹配分权重略高于内容分，避免「质量好看但歌不对」
        const total = item.score * 0.65 + scoreLyricContentQuality(lines) * 0.35;
        if (!best || total > best.total) {
          best = { lines, total };
        }
        // 已经非常优秀就提前停：高匹配 + 有逐字
        if (item.score >= 70 && scoreLyricContentQuality(lines) >= 50) break;
      } catch (err) {
      }
    }

    if (best) return { lines: best.lines };

    // 兜底：旧逻辑选一首再试（兼容 minScore 过滤后 shortlist 全空的情况）
    const matchedSong = selectBestLyricMatch(target, songs) ?? songs[0];
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
    return { lines: [], error: '匹配歌词失败' };
  }
}

export const __lyricsInternals = {
  parseEmbeddedLyrics,
  parseProviderLyrics,
  searchAndMatchLyrics,
  scoreLyricContentQuality,
  getLyricsForSingle,
  getMusicVariants,
};
