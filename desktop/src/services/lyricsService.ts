import {
  detectLyricSourceType,
  mergeTranslation,
  mergeRomanization,
  parseLyricSource,
  type LyricLine,
  type LyricResponse,
  type LyricSourceType,
  type LyricWord,
  type MusicInfo,
} from '@lx/core';
import { getSource } from '@/services/sources/sourceService';

import { getCachedLyrics, isCacheableEmptyLyricResult, saveCachedLyrics } from '@/services/persistentCache';

export type { LyricLine, LyricResponse, LyricWord };

const lyricsCache = new Map<string, LyricResponse>();

/** 清空进程内歌词缓存；设置页「只清歌词缓存」需要连这一层一起清，否则同一会话仍命中旧词。 */
export function clearLyricsMemoryCache(): void {
  lyricsCache.clear();
}

/**
 * 同步 peek 进程内歌词缓存（不做任何 I/O）。
 *
 * 唯一用途是 useLyrics 的「切歌首帧」：持久化层是异步 IPC，做不到同步返回，
 * 而切歌时哪怕一个 async tick 的空白也肉眼可见。只返回有词的结果——空结果
 * （含白名单缓存的「暂无歌词」）返回 null，让调用方走正常异步路径，错误由 error 字段统一表达。
 */
export function peekCachedLyrics(music: MusicInfo): LyricLine[] | null {
  const cached = lyricsCache.get(getCacheKey(music));
  return cached && cached.lines.length > 0 ? cached.lines : null;
}

function getCacheKey(music: MusicInfo): string {
  return `${music.source}:${music.id}`;
}

function parseEmbeddedLyrics(content: string): LyricLine[] {
  return parseLyricSource({
    type: detectLyricSourceType(content),
    content,
  });
}

/** 解析一份按曲文本（手动写下的、或面板选中的那一份），带上译文 / 罗马音。 */
function parseLocalLyricsText(music: MusicInfo, text: string): LyricResponse {
  const lines = mergeRomanization(
    mergeTranslation(parseEmbeddedLyrics(text), music.localLyricsTranslation),
    music.localLyricsRomanization,
  );
  return lines.length ? { lines } : { lines: [], error: '本地歌词无法解析' };
}

/**
 * 本地歌词的权威判定。
 *
 * 匹配链路删除之后这里只剩一条规则：**本地曲的歌词只来自文件自己**——内嵌标签、
 * 同目录旁挂 `.lrc`（扫描时写进 `localLyrics`），或者用户在编辑框里手写的按曲文本。
 * 有文本就解析；本地曲没有文本则返回**权威空**，让 UI 明确显示「没有歌词」，
 * 而不是像以前那样先去平台搜索碰运气。
 *
 * 非本地曲带按曲文本时同样优先用它（下载/导入可能写进来），其余交给音源自己的歌词接口。
 */
export function getLocalLyricsOverride(music: MusicInfo): LyricResponse | null {
  const text = typeof music.localLyrics === 'string' ? music.localLyrics : '';
  if (text.trim()) return parseLocalLyricsText(music, text);
  return music.source === 'local' ? { lines: [], error: '本地文件没有歌词' } : null;
}

function parseProviderLyrics(lyricResult: {
  lyric?: string;
  yrc?: string;
  qrc?: string;
  krc?: string;
  tlyric?: string;
  ytlyric?: string;
  romaLyric?: string;
  yromaLyric?: string;
}): LyricLine[] {
  let lines: LyricLine[] = [];
  let translation: string | undefined = lyricResult.tlyric;
  let romanization: string | undefined = lyricResult.romaLyric;
  if (lyricResult.yrc) {
    lines = parseLyricSource({ type: 'yrc', content: lyricResult.yrc });
    if (lines.length > 0) {
      // 对齐 lx-music-desktop（wy/lyric.js parse()）：yrc 整轨非空即独占采用，不再与 lrc 行级合并。
      // 此前 mergeMissingLines 按「同文本 ±1200ms」去重，而 yrc 的 eapi 富文本元信息行
      // 全部落在 t=0、lrc 的同批行 t 随行递增（0/463/926/1389ms…），第 4 行起漂移超出容差，
      // 「制作人: xxx」等会在头部整批重复（实测孤勇者 67→78 行）。
      // 翻译/罗马音同样优先取与逐字轨对齐的 ytlrc/yromalrc，缺失时再退 lrc 对齐轨。
      translation = lyricResult.ytlyric || lyricResult.tlyric;
      romanization = lyricResult.yromaLyric || lyricResult.romaLyric;
    } else {
      // yrc 解析不出任何行（格式异常/空串）：整轨退回 lrc
      lines = lyricResult.lyric ? parseLyricSource({ type: 'lrc', content: lyricResult.lyric }) : [];
    }
  } else if (lyricResult.qrc) {
    lines = parseLyricSource({ type: 'qrc', content: lyricResult.qrc });
  } else if (lyricResult.krc) {
    lines = parseLyricSource({ type: 'krc', content: lyricResult.krc });
  } else if (lyricResult.lyric) {
    lines = parseLyricSource({ type: 'auto', content: lyricResult.lyric });
  }
  return mergeRomanization(mergeTranslation(lines, translation), romanization);
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
  const override = getLocalLyricsOverride(music);
  if (override) return override;

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
      // 持久化歌词缓存读失败按未命中处理，不影响本次取歌词；留痕以便区分
      // “真的没歌词”与“缓存文件坏了/读不了”
      console.error('[lyrics] 读取持久化歌词缓存失败，按未命中处理', error);
    }

    let result: LyricResponse;

    if (music.source === 'local') {
      if ('lyrics' in music && music.lyrics) {
        const lyricFormat = normalizeLyricFormat((music as { lyricFormat?: string }).lyricFormat);
        const lines = parseLyricSource({ type: lyricFormat, content: String(music.lyrics) });
        result = lines.length > 0 ? { lines } : { lines: [], error: '暂无歌词' };
      } else {
        // 没有内嵌 / 旁挂 / 手写歌词，就是「没有」这个确定答案：匹配链路已删除，不再联网找词。
        result = { lines: [], error: '本地文件没有歌词' };
      }
    } else {
      const provider = getSource(music.source);
      if (!provider) {
        result = { lines: [], error: '不支持的音源' };
      } else {
        try {
          const lyricResult = await provider.getLyric(music);
          const lines = parseProviderLyrics(lyricResult);
          result = lines.length > 0 ? { lines } : { lines: [], error: '暂无歌词' };
        } catch (providerError) {
          // 音源歌词接口抛错就如实报错：原来这里会退到「网易云搜索匹配」，那条链路已删除。
          console.error('[lyrics] 音源歌词接口失败', providerError);
          result = { lines: [], error: '获取歌词失败' };
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
    console.error('[lyrics] 获取歌词失败', error);
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
  const override = getLocalLyricsOverride(music);
  if (override) return override;

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
      // 单个候选取词失败不影响其它候选：继续试下一个，但要留痕
      console.error('[lyrics] 候选歌词获取失败', err);
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

  const withTr = lines.filter((l) => l.tr?.trim()).length;
  if (withTr > 0) score += 10;

  // 时间轴覆盖：首尾跨度合理
  const times = lines.map((l) => l.time).filter((x) => Number.isFinite(x));
  if (times.length >= 2) {
    // 注意：本项目 TS target 低于 ES2022，不要用 Array.prototype.at()
    const span = times[times.length - 1] - times[0];
    if (span >= 30 && span <= 600) score += 12;
    else if (span > 0) score += 4;
  }

  // 空行过多扣分
  const emptyRatio = lines.filter((l) => !(l.text && l.text.trim())).length / lines.length;
  score -= Math.round(emptyRatio * 20);

  return Math.max(0, score);
}

function formatLrcTimestamp(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const wholeSeconds = Math.floor(safeSeconds % 60);
  const milliseconds = Math.round((safeSeconds - Math.floor(safeSeconds)) * 1000);
  return `${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
}

/**
 * 把一份歌词序列化成 LRC 文本。
 *
 * 用途只剩「用户想把自己这份词保存/写回文件」：匹配删除后不再需要把平台候选
 * 重新序列化存进 `lyricsOverride`。译文行按移动端同款写法单独成行。
 */
export function formatLyricsAsLrc(lines: LyricLine[]): string {
  return lines.flatMap((line) => {
    const text = line.text.trim();
    const translation = line.tr?.trim();
    if (!text && !translation) return [];
    const timeTag = `[${formatLrcTimestamp(line.time)}]`;
    return [text ? `${timeTag}${text}` : null, translation ? `${timeTag}${translation}` : null]
      .filter((item): item is string => item !== null);
  }).join('\n');
}

export const __lyricsInternals = {
  parseEmbeddedLyrics,
  parseProviderLyrics,
  scoreLyricContentQuality,
  getLyricsForSingle,
  getMusicVariants,
};
