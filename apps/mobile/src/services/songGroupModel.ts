/**
 * 搜索结果歌曲去重 — 跨源合并同名同歌手歌曲。
 * 从桌面端 SearchView.tsx 的 groupSongResults 移植。
 */
import type { MusicInfo } from "@lx/core";

export interface SongGroup {
  /** 去重 key：normalized name + singer + interval */
  key: string;
  /** 排序最优的主源歌曲 */
  primary: MusicInfo;
  /** 所有源的变体 */
  variants: MusicInfo[];
}

function normalizeText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[（(【\[].*?[）)】\]]/g, "")
    .replace(/[\s\-—_·.,，。:：'"《》<>]/g, "")
    .trim();
}

function splitSingerTokens(singer: string): string[] {
  return singer
    .split(/[、/,，&＋+]/)
    .map(normalizeText)
    .filter(Boolean);
}

function hasSingerOverlap(a: MusicInfo, b: MusicInfo): boolean {
  const singersA = splitSingerTokens(a.singer);
  const singersB = splitSingerTokens(b.singer);
  if (singersA.length === 0 || singersB.length === 0) return false;
  return singersA.some((singerA) => singersB.some((singerB) => singerA === singerB));
}

function isSameSong(a: MusicInfo, b: MusicInfo): boolean {
  if (normalizeText(a.name) !== normalizeText(b.name)) return false;
  if (!hasSingerOverlap(a, b)) return false;
  if (a.interval && b.interval) {
    return Math.abs(a.interval - b.interval) <= 6;
  }
  return true;
}

function sourceRank(source: MusicInfo["source"]): number {
  if (source === "wy") return 0;
  if (source === "tx") return 1;
  return 2;
}

/**
 * 将歌曲列表按同名同歌手跨源合并。
 * primary 取 sourceRank 最高的源。
 */
export function groupSongResults(songs: MusicInfo[]): SongGroup[] {
  const groups: SongGroup[] = [];

  for (const song of songs) {
    const existing = groups.find((group) =>
      group.variants.some((variant) => isSameSong(variant, song)),
    );
    if (!existing) {
      groups.push({
        key: `${normalizeText(song.name)}:${normalizeText(song.singer)}:${song.interval ?? 0}`,
        primary: song,
        variants: [song],
      });
      continue;
    }

    if (!existing.variants.some((variant) => variant.source === song.source && variant.id === song.id)) {
      existing.variants.push(song);
    }

    existing.variants.sort((a, b) => sourceRank(a.source) - sourceRank(b.source));
    existing.primary = existing.variants[0];
  }

  return groups;
}
