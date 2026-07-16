import type { MusicInfo } from "@lx/core";

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
  if (a.interval && b.interval) return Math.abs(a.interval - b.interval) <= 6;
  return true;
}

function mergeMetadata(primary: MusicInfo, metadata: MusicInfo): MusicInfo {
  const cover = primary.picUrl || primary.img || metadata.picUrl || metadata.img;
  return {
    ...primary,
    albumName: primary.albumName || metadata.albumName,
    interval: primary.interval || metadata.interval,
    quality: primary.quality || metadata.quality,
    picUrl: primary.picUrl || cover,
    img: primary.img || cover,
  };
}

export function mergeSongSearchMetadata(
  primarySongs: MusicInfo[],
  metadataSongs: MusicInfo[],
): MusicInfo[] {
  const usedMetadataIndexes = new Set<number>();
  const merged = primarySongs.map((song) => {
    const metadataIndex = metadataSongs.findIndex((candidate, index) => {
      return !usedMetadataIndexes.has(index) && isSameSong(song, candidate);
    });
    if (metadataIndex < 0) return song;

    usedMetadataIndexes.add(metadataIndex);
    return mergeMetadata(song, metadataSongs[metadataIndex]);
  });

  for (let index = 0; index < metadataSongs.length; index += 1) {
    if (!usedMetadataIndexes.has(index)) merged.push(metadataSongs[index]);
  }

  return merged;
}
