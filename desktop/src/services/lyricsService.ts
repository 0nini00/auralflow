import {
  detectLyricSourceType,
  mergeTranslation,
  mergeRomanization,
  parseLyricSource,
  type LyricLine,
  type LyricOrigin,
  type LyricResponse,
  type LyricSourceType,
  type LyricWord,
  type MusicInfo,
} from '@lx/core';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { getSource } from '@/services/sources/sourceService';
import { fetchNeteaseJson, searchNeteaseMatch } from '@/services/localMediaMatch';
import { matchLocalCover } from '@/services/localCoverMatch';
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

/** 手动/本地词是当前歌曲的权威输入，绝不写入自动匹配缓存。 */
export function getLocalLyricsOverride(music: MusicInfo): LyricResponse | null {
  if (music.localLyrics === undefined) return null;
  // 空白字符串表示用户主动清空，仍是权威覆盖，不能回退到自动歌词。
  if (!music.localLyrics.trim()) return { lines: [] };
  const lines = mergeRomanization(
    mergeTranslation(parseEmbeddedLyrics(music.localLyrics), music.localLyricsTranslation),
    music.localLyricsRomanization,
  );
  return lines.length ? { lines } : { lines: [], error: '本地歌词无法解析' };
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
          // 音源歌词接口抛错时不要直接失败：走网易云搜索匹配兜底（同时留痕）
          console.error('[lyrics] 音源歌词接口失败，改走搜索匹配', providerError);
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

const MAX_LYRIC_CANDIDATES_TO_TRY = 3;

/** 不带 duration 直查时接口给的是「最近似」条目，超出这个窗口即视为另一首歌。 */
const LRCLIB_DURATION_WINDOW_SECONDS = 5;

/**
 * 取主歌手：本地 tag 常写「主歌手/别名/合作者」（吴亦凡/Kris），而平台按单一署名分条，
 * 用整串查必然查无此歌。
 */
function getPrimaryArtist(singer: string): string {
  return singer
    .split(/[/、,，;&]|\band\b|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b/iu)
    .map((part) => part.trim())
    .find(Boolean) ?? '';
}

/** 宽松同文比较：只折叠字形、大小写与标点，用于确认回包就是我们查的那首歌。 */
function sameLooseText(left: unknown, right: string): boolean {
  if (typeof left !== "string") return false;
  const normalize = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{Z}\s]/gu, "");
  return normalize(left) === normalize(right);
}

/**
 * LRC Lib(https://lrclib.net)单次直查。
 *
 * `requestDurationSec` 为 0 表示这次不带 duration 参数：接口此时返回的是「最近似」条目，
 * 必须用 `localDurationSec` 加 5 秒窗确认它确实是同一首歌，否则会把同名不同曲的词套上去。
 * 带了 duration 的查询由接口保证时长一致，不必再校验。
 */
async function requestLrclibLyrics(
  artist: string,
  title: string,
  requestDurationSec: number,
  localDurationSec: number,
): Promise<LyricLine[] | "instrumental" | null> {
  const params = new URLSearchParams({
    artist_name: artist,
    track_name: title,
  });
  if (requestDurationSec > 0) params.set("duration", String(requestDurationSec));

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
    duration?: number;
    /** 回包自带的署名与曲名，用于确认命中的就是我们查的那首歌。 */
    artistName?: string;
    trackName?: string;
  };
  if (data.instrumental) return "instrumental";
  if (
    requestDurationSec === 0 &&
    localDurationSec > 0 &&
    typeof data.duration === "number" &&
    Number.isFinite(data.duration) &&
    Math.abs(data.duration - localDurationSec) > LRCLIB_DURATION_WINDOW_SECONDS
  ) {
    // 时长窗只用来拦「回包本来就不是我们要的那首歌」：署名与标题都对得上时，时长差只说明本地
    // 是另一个版本的录音（或 tag 里的时长本身就是错的），不该因此把本来能用的歌词丢掉——
    // 这正是「原唱在平台不可得、只有别人的录音」之外最常见的落空原因。
    const identityMatches = sameLooseText(data.artistName, artist) && sameLooseText(data.trackName, title);
    if (!identityMatches) return null;
  }
  const source = data.syncedLyrics || data.plainLyrics;
  if (!source) return null;
  const lines = parseLyricSource({ content: source });
  return lines.length > 0 ? lines : null;
}

/**
 * LRC Lib(https://lrclib.net)两轮直查「标题 + 歌手 + 时长」。
 *
 * 为什么分两轮：平台侧按单一署名 + 精确时长分条，而本地 tag 是「主歌手/别名」且时长常差几秒。
 * 只用整串歌手查会 404（吴亦凡/Kris 查不到），只用时长查也会 404（本地 214s vs 条目 201.5s），
 * 所以第一轮用主歌手且不带时长（命中率最高），第二轮才复现旧的「完整歌手 + 时长」行为。
 *
 * 返回三态:
 *  - `null`         两轮都无结果或请求不可用(继续走网易搜索兜底)
 *  - `"instrumental"` 命中且明确为纯音乐(无词,直接结束,不必再搜)
 *  - `LyricLine[]`  命中歌词
 */
async function fetchLrclibLyrics(
  music: MusicInfo,
): Promise<LyricLine[] | "instrumental" | null> {
  const title = music.name?.trim();
  const singer = music.singer?.trim();
  if (!title || !singer) return null;

  const interval = music.interval;
  const localDurationSec =
    typeof interval === "number" && Number.isFinite(interval) && interval > 0 ? Math.round(interval) : 0;

  const primaryArtist = getPrimaryArtist(singer);
  if (primaryArtist) {
    const primaryHit = await requestLrclibLyrics(primaryArtist, title, 0, localDurationSec);
    if (primaryHit !== null) return primaryHit;
  }
  return requestLrclibLyrics(singer, title, localDurationSec, localDurationSec);
}

/** 拉一首网易云歌的歌词（逐字/行级 + 翻译/罗马音）。 */
async function fetchNeteaseLyricLines(songId: string): Promise<LyricLine[]> {
  const lyricUrl = `https://music.163.com/api/song/lyric?id=${songId}&lv=1&kv=1&tv=-1`;
  const lyricData = await fetchNeteaseJson(lyricUrl);
  return parseProviderLyrics({
    lyric: lyricData.lrc?.lyric,
    yrc: lyricData.yrc?.lyric,
    tlyric: lyricData.tlyric?.lyric,
    romaLyric: lyricData.romalrc?.lyric ?? lyricData.yromalrc?.lyric,
  });
}

/** 自动匹配的来源标注；手动/本地覆盖与失败结果都不设，避免 UI 误标。 */
function wyOrigin(tier: LyricOrigin['tier'], performer?: string): LyricOrigin {
  return performer ? { tier, performer, source: 'wy' } : { tier, source: 'wy' };
}

/**
 * 歌词匹配成功时顺手补一次本地曲封面（已知被采用候选的网易歌曲 id）。
 *
 * 这是「顺路兜底 / 提前触发」：播放路径（playerStore）自己也能独立完成匹配，这里带 id 触发
 * 只是更早一步，且不会重复搜索（缓存命中直接返回，同键并发由 localCoverMatch 去重）。
 * 完全旁路：不 await、不参与返回，封面失败不能让已经匹配到的歌词消失或变成失败。
 */
function triggerLocalCoverMatch(music: MusicInfo, songId: string | undefined): void {
  if (!songId) return;
  if (music.source !== 'local' && !music.isLocal) return;
  void matchLocalCover(music, songId).catch(() => undefined);
}

async function searchAndMatchLyrics(music: MusicInfo): Promise<LyricResponse> {
  try {
    // 先试 LRC Lib:标题/歌手直查,命中即返回,省去网易搜索+判定
    try {
      const lrclibResult = await fetchLrclibLyrics(music);
      if (lrclibResult === "instrumental") return { lines: [], error: "暂无歌词" };
      if (lrclibResult && lrclibResult.length > 0) return { lines: lrclibResult };
    } catch {
      // LRC Lib 不可用(网络/限流)时静默走网易搜索兜底
    }

    const keyword = `${music.name} ${music.singer}`.trim();
    if (!keyword) {
      // keyword 为空要单独报「信息不完整」，不能与「搜到了但没匹配上」混为一谈
      return { lines: [], error: '歌曲信息不完整' };
    }

    // 搜索与判定都在 localMediaMatch（与封面匹配共用同一份规则）
    const { match } = await searchNeteaseMatch(music);
    if (!match) {
      return { lines: [], error: '未找到匹配歌曲' };
    }

    if (match.status !== 'matched' || !match.tier) {
      // 显式失败：宁可没有歌词，也不能把别人的演唱版本静默套到本地曲上
      return { lines: [], error: '未找到匹配歌曲' };
    }

    if (match.tier === 'other-performer') {
      const adopted = match.candidates[0];
      const lines = adopted ? await fetchNeteaseLyricLines(adopted.id) : [];
      if (lines.length === 0) return { lines: [], error: '暂无歌词' };
      triggerLocalCoverMatch(music, adopted?.id);
      // 异唱档必须带来源标注：UI 要提示用户这是别人的演唱版本
      return { lines, origin: wyOrigin('other-performer', match.performer) };
    }

    // 同一录音组内可能有多个条目（换名重传/多版本）：匹配分不再参与选择，
    // 只在这些条目之间用内容质量挑选
    let best: LyricLine[] | null = null;
    let bestQuality = -1;
    let bestCandidateId: string | undefined;
    for (const candidate of match.candidates.slice(0, MAX_LYRIC_CANDIDATES_TO_TRY)) {
      try {
        const lines = await fetchNeteaseLyricLines(candidate.id);
        if (lines.length === 0) continue;
        const quality = scoreLyricContentQuality(lines);
        if (quality > bestQuality) {
          best = lines;
          bestQuality = quality;
          bestCandidateId = candidate.id;
        }
      } catch (err) {
        // 某个候选拉歌词失败就试同组的下一个
        console.error('[lyrics] 候选歌词拉取失败', err);
      }
    }

    if (!best) return { lines: [], error: '暂无歌词' };
    triggerLocalCoverMatch(music, bestCandidateId);
    return { lines: best, origin: wyOrigin('same-recording') };
  } catch (error) {
    console.error('[lyrics] 匹配歌词失败', error);
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
