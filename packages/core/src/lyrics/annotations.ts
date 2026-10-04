import type { LyricLine, LyricWord } from './parser';

/** 完整有序片段；连接 text 必须等于所属行或词的纯文本。 */
export interface LyricRubySegment {
  text: string;
  reading?: string;
}

function decodeEntities(text: string): string {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code: string) => {
    if (!code.startsWith('#')) return named[code.toLowerCase()];
    const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : entity;
  });
}

/** 仅解析显式 ruby/rt 数据，不创建 DOM、不执行 HTML；未知或残缺结构保留为文本。 */
export function parseRubyText(text: string): { text: string; ruby?: LyricRubySegment[] } {
  const segments: LyricRubySegment[] = [];
  let cursor = 0;
  let found = false;
  for (const match of text.matchAll(/<ruby(?:\s+[^<>]*)?>([\s\S]*?)<\/ruby\s*>/gi)) {
    const body = match[1].replace(/<rp(?:\s+[^<>]*)?>[\s\S]*?<\/rp\s*>/gi, '').replace(/<\/?rb\s*>/gi, '');
    const annotated: LyricRubySegment[] = [];
    let end = 0;
    for (const rt of body.matchAll(/<rt(?:\s+[^<>]*)?>([^<>]*)<\/rt\s*>/gi)) {
      const base = body.slice(end, rt.index);
      if (!base || /[<>]/.test(base) || !rt[1].trim()) break;
      annotated.push({ text: decodeEntities(base), reading: decodeEntities(rt[1].trim()) });
      end = rt.index! + rt[0].length;
    }
    if (!annotated.length || end !== body.length) continue;
    if (match.index! > cursor) segments.push({ text: decodeEntities(text.slice(cursor, match.index)) });
    segments.push(...annotated);
    cursor = match.index! + match[0].length;
    found = true;
  }
  if (!found) return { text };
  if (cursor < text.length) segments.push({ text: decodeEntities(text.slice(cursor)) });
  return { text: segments.map(segment => segment.text).join(''), ruby: segments };
}

function normalizeWord(word: LyricWord): LyricWord {
  const parsed = parseRubyText(word.text);
  if (!parsed.ruby) return word;
  const reading = parsed.ruby.length === 1 ? parsed.ruby[0].reading : undefined;
  return { ...word, ...parsed, ...(reading ? { reading } : {}) };
}

export function normalizeRubyLine(line: LyricLine): LyricLine {
  if (line.ruby) return line;
  const parsed = parseRubyText(line.text);
  return {
    ...line,
    ...parsed,
    ...(line.words ? { words: line.words.map(normalizeWord) } : {}),
  };
}
