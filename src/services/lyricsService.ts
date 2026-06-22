import type { MusicInfo } from "@lx/core";
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { resolver } from '@/services/sources/sourceService';

export interface LyricWord {
  text: string;
  /** 绝对开始时间（秒） */
  start: number;
  /** 持续时长（秒） */
  dur: number;
}

export interface LyricLine {
  time: number;
  text: string;
  /** 逐字歌词：单词级时间戳；存在时启用卡拉OK 渲染 */
  words?: LyricWord[];
  /** 译文行 */
  tr?: string;
}

interface LyricResponse {
  lines: LyricLine[];
  error?: string;
}

// Lyrics cache
const lyricsCache = new Map<string, LyricResponse>();

function getCacheKey(music: MusicInfo): string {
  return `${music.source}:${music.id}`;
}

/**
 * Parse LRC format lyrics
 * Example: [00:12.34]歌词内容
 */
function parseLrc(lrc: string): LyricLine[] {
  const lines = lrc.split(/\r?\n/);
  const result: LyricLine[] = [];
  const timeRegex = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;
  const offsetMatch = lrc.match(/\[offset:([+-]?\d+)\]/i);
  const offsetSeconds = offsetMatch ? Number(offsetMatch[1]) / 1000 : 0;

  for (const line of lines) {
    const text = line.replace(timeRegex, '').replace(/\[offset:[^\]]+\]/ig, '').trim();

    let hasTimestamp = false;
    let match: RegExpExecArray | null;
    timeRegex.lastIndex = 0;
    while ((match = timeRegex.exec(line)) !== null) {
      hasTimestamp = true;
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const fraction = match[3] ?? '0';
      const milliseconds = parseInt(fraction.padEnd(3, '0').slice(0, 3), 10);
      const time = Math.max(0, minutes * 60 + seconds + milliseconds / 1000 + offsetSeconds);
      // 保留间奏/前奏里的空文本时间行，避免 currentLine 计算卡住。
      result.push({ time, text });
    }

    if (!hasTimestamp) continue;
  }

  return result.sort((a, b) => a.time - b.time);
}

/**
 * 解析网易云逐字歌词（yrc）。
 *
 * yrc 原始格式（每行）：
 *   [startMs,durMs](wStart,wDur,0)词1(wStart,wDur,0)词2...
 * 头部可能含 JSON 元信息行（以 {" 开头），跳过。
 */
function parseYrc(yrc: string): LyricLine[] {
  const lines = yrc.split(/\r?\n/);
  const result: LyricLine[] = [];
  const lineTimeRe = /^\[(\d+),(\d+)\]/;
  const wordTimeRe = /\((\d+),(\d+),\d+\)/g;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('{"')) continue;
    const lineMatch = lineTimeRe.exec(line);
    if (!lineMatch) continue;

    const lineStartMs = parseInt(lineMatch[1], 10);
    const body = line.slice(lineMatch[0].length);

    // 拆出每个词的时间戳与文本。yrc 格式：(ws,wd,0)词1(ws,wd,0)词2
    // 时间戳在词之前，故词文本 = 当前标记结尾 到 下一标记起点 之间
    const words: LyricWord[] = [];
    let textBuf = '';
    wordTimeRe.lastIndex = 0;
    const marks: { start: number; dur: number; begin: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = wordTimeRe.exec(body)) !== null) {
      marks.push({
        start: parseInt(m[1], 10) / 1000,
        dur: parseInt(m[2], 10) / 1000,
        begin: m.index + m[0].length,
      });
    }
    for (let i = 0; i < marks.length; i++) {
      const end = i + 1 < marks.length ? body.indexOf('(', marks[i].begin) : body.length;
      const text = body.slice(marks[i].begin, end > marks[i].begin ? end : body.length);
      if (text) {
        words.push({ text, start: marks[i].start, dur: marks[i].dur });
        textBuf += text;
      }
    }

    const lineText = textBuf.trim();
    if (!lineText && words.length === 0) continue;

    result.push({
      time: lineStartMs / 1000,
      text: lineText,
      words: words.length > 0 ? words : undefined,
    });
  }

  return result.sort((a, b) => a.time - b.time);
}

/** 把译文 LRC 按行时间合并到逐字/行级歌词上 */
function mergeTranslation(lines: LyricLine[], tlyric?: string): LyricLine[] {
  if (!tlyric) return lines;
  const trMap = new Map<number, string>();
  const timeRe = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/;
  for (const raw of tlyric.split(/\r?\n/)) {
    const m = timeRe.exec(raw);
    if (!m) continue;
    const text = raw.replace(timeRe, '').trim();
    if (!text) continue;
    const frac = (m[3] ?? '0').padEnd(3, '0').slice(0, 3);
    const ms = parseInt(frac, 10);
    const t = parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + ms / 1000;
    trMap.set(Math.round(t * 1000), text);
  }
  if (trMap.size === 0) return lines;
  return lines.map((line) => {
    const key = Math.round(line.time * 1000);
    // 容差 ±150ms
    let tr = trMap.get(key);
    if (!tr) {
      for (const [k, v] of trMap) {
        if (Math.abs(k - key) <= 150) { tr = v; break; }
      }
    }
    return tr ? { ...line, tr } : line;
  });
}

/**
 * Main function to get lyrics, routed through the provider architecture.
 */
export async function getLyrics(music: MusicInfo): Promise<LyricResponse> {
  if (!music.id) {
    return { lines: [], error: '歌曲信息不完整' };
  }

  // Check cache first
  const cacheKey = getCacheKey(music);
  const cached = lyricsCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    let result: LyricResponse;

    // 本地音乐：优先使用内嵌歌词
    if (music.source === 'local') {
      // 检查是否有内嵌歌词
      if ('lyrics' in music && music.lyrics) {
        const lines = parseLrc(music.lyrics as string);
        result = { lines };
      } else {
        // 无内嵌歌词，尝试通过歌名+歌手搜索网易云匹配
        result = await searchAndMatchLyrics(music);
      }
    } else {
      // 通过 resolver/provider 体系获取歌词
      const provider = resolver.getSource(music.source);
      if (!provider) {
        result = { lines: [], error: '不支持的音源' };
      } else {
        const lyricResult = await provider.getLyric(music);
        let lines: LyricLine[] = [];
        if (lyricResult.yrc) {
          lines = parseYrc(lyricResult.yrc);
          // yrc 缺失的行用 LRC 补齐
          if (lyricResult.lyric) {
            const lrcLines = parseLrc(lyricResult.lyric);
            lines = mergeMissingLines(lines, lrcLines);
          }
        } else if (lyricResult.lyric) {
          lines = parseLrc(lyricResult.lyric);
        }
        lines = mergeTranslation(lines, lyricResult.tlyric);
        result = lines.length > 0 ? { lines } : { lines: [], error: '暂无歌词' };
      }
    }

    // Cache the result
    lyricsCache.set(cacheKey, result);
    return result;
  } catch (error) {
    console.error('Failed to get lyrics:', error);
    const errorResult = { lines: [], error: '获取歌词失败' };
    lyricsCache.set(cacheKey, errorResult);
    return errorResult;
  }
}

/** 用 LRC 行补齐 yrc 中缺失时间点的行（yrc 通常是子集） */
function mergeMissingLines(yrcLines: LyricLine[], lrcLines: LyricLine[]): LyricLine[] {
  if (lrcLines.length === 0) return yrcLines;
  const existing = new Set(yrcLines.map((l) => Math.round(l.time * 1000)));
  const merged = [...yrcLines];
  for (const lrc of lrcLines) {
    const key = Math.round(lrc.time * 1000);
    let found = existing.has(key);
    if (!found) {
      for (const k of existing) {
        if (Math.abs(k - key) <= 150) { found = true; break; }
      }
    }
    if (!found) merged.push(lrc);
  }
  return merged.sort((a, b) => a.time - b.time);
}

/**
 * 本地音乐通过搜索网易云匹配歌词
 */
async function searchAndMatchLyrics(music: MusicInfo): Promise<LyricResponse> {
  try {
    const keyword = `${music.name} ${music.singer}`.trim();
    if (!keyword) {
      return { lines: [], error: '歌曲信息不完整' };
    }

    // 搜索网易云 - 使用 Tauri fetch
    const searchUrl = `https://music.163.com/api/search/get/web?s=${encodeURIComponent(keyword)}&type=1&limit=5`;
    const searchResp = await tauriFetch(searchUrl, {
      method: 'GET',
      headers: { 'Referer': 'https://music.163.com' },
    });

    if (!searchResp.ok) {
      return { lines: [], error: '搜索失败' };
    }

    const searchData = await searchResp.json();
    const songs = searchData.result?.songs || [];

    if (songs.length === 0) {
      return { lines: [], error: '未找到匹配歌曲' };
    }

    // 简单匹配：取第一个结果（可以改进为相似度匹配）
    const matchedSong = songs[0];
    const songId = String(matchedSong.id);

    // 获取歌词 — 直接用 tauriFetch 调网易云歌词 API
    const lyricUrl = `https://music.163.com/api/song/lyric?id=${songId}&lv=1&kv=1&tv=-1`;
    const lyricResp = await tauriFetch(lyricUrl, {
      method: 'GET',
      headers: { 'Referer': 'https://music.163.com' },
    });

    if (!lyricResp.ok) {
      return { lines: [], error: '获取歌词失败' };
    }

    const lyricData = await lyricResp.json();
    if (!lyricData.lrc?.lyric) {
      return { lines: [], error: '暂无歌词' };
    }

    const lines = parseLrc(lyricData.lrc.lyric);
    return { lines };
  } catch (error) {
    console.error('Failed to match lyrics:', error);
    return { lines: [], error: '匹配歌词失败' };
  }
}
