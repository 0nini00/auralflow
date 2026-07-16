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

export interface LyricResponse {
  lines: LyricLine[];
  error?: string;
}

export type LyricSourceType = 'lrc' | 'enhanced-lrc' | 'yrc' | 'qrc' | 'krc' | 'vtt';

export interface RawLyricSource {
  type?: LyricSourceType | 'auto';
  content: string;
  translation?: string;
}

const LRC_TIME_REGEX = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const LRC_SINGLE_TIME_REGEX = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/;
const ANGLE_TIME_REGEX = /<(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?>/g;
const OFFSET_REGEX = /\[offset:([+-]?\d+)\]/i;
const METADATA_REGEX = /^\[(?:ti|ar|al|by|offset|length|tool|re):/i;

function parseTimestamp(minute: string, second: string, fraction = '0'): number {
  const milliseconds = Number.parseInt(fraction.padEnd(3, '0').slice(0, 3), 10);
  return Number.parseInt(minute, 10) * 60 + Number.parseInt(second, 10) + milliseconds / 1000;
}

function sortLines(lines: LyricLine[]): LyricLine[] {
  return lines.sort((a, b) => a.time - b.time);
}

function stripInlineTimeTags(value: string): string {
  return value.replace(LRC_TIME_REGEX, '').replace(ANGLE_TIME_REGEX, '');
}

export function normalizeLyricTextForCompare(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s"'`“”‘’.,，。!?！？;；:：、~～…·\-—_()[\]{}<>《》【】（）]/g, '');
}

export function isSameLyricText(a: string, b: string): boolean {
  const left = normalizeLyricTextForCompare(a);
  const right = normalizeLyricTextForCompare(b);
  return left.length > 0 && left === right;
}

export function parseLrc(lrc: string): LyricLine[] {
  const result: LyricLine[] = [];
  const offsetMatch = lrc.match(OFFSET_REGEX);
  const offsetSeconds = offsetMatch ? Number(offsetMatch[1]) / 1000 : 0;

  for (const rawLine of lrc.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || METADATA_REGEX.test(line)) continue;

    const text = stripInlineTimeTags(line).replace(OFFSET_REGEX, '').trim();
    if (!text) continue;
    let match: RegExpExecArray | null;
    LRC_TIME_REGEX.lastIndex = 0;
    while ((match = LRC_TIME_REGEX.exec(line)) !== null) {
      const time = Math.max(0, parseTimestamp(match[1], match[2], match[3]) + offsetSeconds);
      result.push({ time, text });
    }
  }

  return sortLines(result);
}

function parseEnhancedLine(line: string, offsetSeconds: number): LyricLine[] {
  const tagMatches = [...line.matchAll(LRC_TIME_REGEX)];
  if (tagMatches.length === 0) return [];

  const firstTag = tagMatches[0];
  const lineTime = Math.max(0, parseTimestamp(firstTag[1], firstTag[2], firstTag[3]) + offsetSeconds);
  const body = line.slice((firstTag.index ?? 0) + firstTag[0].length);
  const wordTags = [...body.matchAll(ANGLE_TIME_REGEX)];
  if (wordTags.length === 0) {
    const text = stripInlineTimeTags(body).trim();
    if (!text) return [];
    return tagMatches.map((match) => ({
      time: Math.max(0, parseTimestamp(match[1], match[2], match[3]) + offsetSeconds),
      text,
    }));
  }

  const words: LyricWord[] = [];
  let text = '';
  for (let index = 0; index < wordTags.length; index += 1) {
    const current = wordTags[index];
    const next = wordTags[index + 1];
    const start = Math.max(0, parseTimestamp(current[1], current[2], current[3]) + offsetSeconds);
    const contentStart = (current.index ?? 0) + current[0].length;
    const contentEnd = next?.index ?? body.length;
    const wordText = body.slice(contentStart, contentEnd).replace(ANGLE_TIME_REGEX, '');
    if (!wordText) continue;
    const nextStart = next ? Math.max(0, parseTimestamp(next[1], next[2], next[3]) + offsetSeconds) : start + 0.4;
    words.push({ text: wordText, start, dur: Math.max(0.05, nextStart - start) });
    text += wordText;
  }

  return [{ time: lineTime, text: text.trim(), words: words.length ? words : undefined }];
}

export function parseEnhancedLrc(lrc: string): LyricLine[] {
  const result: LyricLine[] = [];
  const offsetMatch = lrc.match(OFFSET_REGEX);
  const offsetSeconds = offsetMatch ? Number(offsetMatch[1]) / 1000 : 0;

  for (const rawLine of lrc.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || METADATA_REGEX.test(line)) continue;
    result.push(...parseEnhancedLine(line, offsetSeconds));
  }

  return sortLines(result);
}

function parseMsWordFormat(content: string, tagRegex: RegExp): LyricLine[] {
  const result: LyricLine[] = [];
  const lineTimeRe = /^\[(\d+),(\d+)\](.*)/;

  for (const raw of content.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('{"')) continue;
    const lineMatch = lineTimeRe.exec(line);
    if (!lineMatch) continue;

    const lineStartMs = Number.parseInt(lineMatch[1], 10);
    const body = lineMatch[3];
    const marks: Array<{ start: number; dur: number; tagStart: number; begin: number }> = [];
    let match: RegExpExecArray | null;
    tagRegex.lastIndex = 0;
    while ((match = tagRegex.exec(body)) !== null) {
      marks.push({
        start: Number.parseInt(match[1], 10) / 1000,
        dur: Number.parseInt(match[2], 10) / 1000,
        tagStart: match.index,
        begin: match.index + match[0].length,
      });
    }

    const words: LyricWord[] = [];
    let text = '';
    for (let index = 0; index < marks.length; index += 1) {
      const end = marks[index + 1]?.tagStart ?? body.length;
      const wordText = body.slice(marks[index].begin, end).replace(tagRegex, '');
      if (!wordText) continue;
      words.push({ text: wordText, start: marks[index].start, dur: marks[index].dur });
      text += wordText;
    }

    const lineText = text.trim();
    if (!lineText && words.length === 0) continue;
    result.push({
      time: lineStartMs / 1000,
      text: lineText,
      words: words.length > 0 ? words : undefined,
    });
  }

  return sortLines(result);
}

export function parseYrc(yrc: string): LyricLine[] {
  return parseMsWordFormat(yrc, /\((\d+),(\d+),\d+\)/g);
}

export function parseQrc(qrc: string): LyricLine[] {
  return parseMsWordFormat(qrc, /\((\d+),(\d+)(?:,\d+)?\)/g);
}

export function parseKrc(krc: string): LyricLine[] {
  return parseMsWordFormat(krc, /<(\d+),(\d+)(?:,\d+)?>/g);
}

function parseVttTimestamp(value: string): number {
  const parts = value.trim().split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return Number(value) || 0;
}

export function parseVtt(vtt: string): LyricLine[] {
  const normalized = vtt.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim();
  const result: LyricLine[] = [];
  const timingRe = /^((?:\d{2}:)?\d{2}:\d{2}\.\d{3})\s*-->\s*((?:\d{2}:)?\d{2}:\d{2}\.\d{3})(?:\s+.*)?$/;

  for (const block of normalized.split(/\n{2,}/)) {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
    if (lines[0]?.toUpperCase() === 'WEBVTT') continue;
    const timingIndex = lines.findIndex((line) => timingRe.test(line));
    if (timingIndex < 0) continue;
    const timing = timingRe.exec(lines[timingIndex]);
    if (!timing) continue;
    const text = lines.slice(timingIndex + 1).join(' ').replace(/<[^>]+>/g, '').trim();
    if (!text) continue;
    result.push({ time: parseVttTimestamp(timing[1]), text });
  }

  return sortLines(result);
}

export function detectLyricSourceType(content: string): LyricSourceType {
  const trimmed = content.trimStart();
  if (/^WEBVTT/i.test(trimmed)) return 'vtt';
  if (/^\[\d+,\d+\]/m.test(trimmed)) {
    if (/<\d+,\d+(?:,\d+)?>/.test(trimmed)) return 'krc';
    if (/\(\d+,\d+(?:,\d+)?\)/.test(trimmed)) return 'yrc';
  }
  if (ANGLE_TIME_REGEX.test(trimmed)) {
    ANGLE_TIME_REGEX.lastIndex = 0;
    return 'enhanced-lrc';
  }
  ANGLE_TIME_REGEX.lastIndex = 0;
  return 'lrc';
}

export function parseLyricSource(source: RawLyricSource): LyricLine[] {
  if (!source.content.trim()) return [];
  const type = source.type && source.type !== 'auto' ? source.type : detectLyricSourceType(source.content);
  switch (type) {
    case 'enhanced-lrc':
      return parseEnhancedLrc(source.content);
    case 'yrc':
      return parseYrc(source.content);
    case 'qrc':
      return parseQrc(source.content);
    case 'krc':
      return parseKrc(source.content);
    case 'vtt':
      return parseVtt(source.content);
    case 'lrc':
    default:
      return parseLrc(source.content);
  }
}

export function mergeTranslation(lines: LyricLine[], tlyric?: string): LyricLine[] {
  if (!tlyric) return lines;
  const trMap = new Map<number, string>();
  for (const raw of tlyric.split(/\r?\n/)) {
    const match = LRC_SINGLE_TIME_REGEX.exec(raw);
    if (!match) continue;
    const text = raw.replace(LRC_SINGLE_TIME_REGEX, '').trim();
    if (!text) continue;
    trMap.set(Math.round(parseTimestamp(match[1], match[2], match[3]) * 1000), text);
  }
  if (trMap.size === 0) return lines;

  return lines.map((line) => {
    const key = Math.round(line.time * 1000);
    let tr = trMap.get(key);
    if (!tr) {
      for (const [candidateKey, value] of trMap) {
        if (Math.abs(candidateKey - key) <= 150) {
          tr = value;
          break;
        }
      }
    }
    return tr && !isSameLyricText(line.text, tr) ? { ...line, tr } : line;
  });
}

const STRICT_LINE_TIME_TOLERANCE_MS = 150;
const SAME_TEXT_LINE_DRIFT_TOLERANCE_MS = 1200;

function isDuplicateFallbackLine(existing: LyricLine, fallback: LyricLine): boolean {
  const diff = Math.abs(Math.round(existing.time * 1000) - Math.round(fallback.time * 1000));
  if (isSameLyricText(existing.text, fallback.text)) {
    return diff <= SAME_TEXT_LINE_DRIFT_TOLERANCE_MS;
  }
  return !fallback.text.trim() && diff <= STRICT_LINE_TIME_TOLERANCE_MS;
}

export function mergeMissingLines(primaryLines: LyricLine[], fallbackLines: LyricLine[]): LyricLine[] {
  if (fallbackLines.length === 0) return primaryLines;
  const merged = [...primaryLines];
  for (const fallback of fallbackLines) {
    const found = merged.some((line) => isDuplicateFallbackLine(line, fallback));
    if (!found) merged.push(fallback);
  }
  return sortLines(merged);
}
