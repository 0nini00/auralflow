import type { MusicInfo } from "@lx/core";
import type { SearchAlbumResult, SearchArtistResult } from "@/services/musicApi";

/**
 * 非网易云歌手/专辑暂无完整详情页时，用当前搜索结果里的相关歌曲做可播放降级列表。
 */
export interface SearchFallbackDetailModel {
  type: "fallback";
  title: string;
  subtitle: string;
  songs: MusicInfo[];
  emptyHint: string;
  sourceLabel: string;
}

const SOURCE_LABELS: Record<string, string> = {
  wy: "网易云",
  tx: "QQ音乐",
  bili: "B站",
  kw: "酷我",
  kg: "酷狗",
  mg: "咪咕",
  local: "本地",
};

export function getSearchSourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

function normalizeName(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function namesLooselyMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

/** 从当前搜索单曲结果中，筛出与歌手相关的可播列表。 */
export function buildArtistFallbackDetail(
  artist: SearchArtistResult,
  songsFromSearch: MusicInfo[],
): SearchFallbackDetailModel {
  const artistName = normalizeName(artist.name);
  const matched = songsFromSearch.filter((song) => {
    if (artist.source && song.source && song.source !== artist.source) return false;
    return namesLooselyMatch(normalizeName(song.singer), artistName);
  });

  const sourceLabel = getSearchSourceLabel(artist.source);
  return {
    type: "fallback",
    title: artist.name,
    subtitle: `${sourceLabel} · 相关歌曲`,
    songs: matched,
    sourceLabel,
    emptyHint:
      matched.length > 0
        ? ""
        : `当前搜索结果里没有「${artist.name}」的歌曲。该音源暂无完整歌手页，可换关键词再搜后播放。`,
  };
}

/** 从当前搜索单曲结果中，筛出与专辑相关的可播列表。 */
export function buildAlbumFallbackDetail(
  album: SearchAlbumResult,
  songsFromSearch: MusicInfo[],
): SearchFallbackDetailModel {
  const albumName = normalizeName(album.name);
  const artistName = normalizeName(album.artistName);
  const matched = songsFromSearch.filter((song) => {
    if (album.source && song.source && song.source !== album.source) return false;
    const albumHit = namesLooselyMatch(normalizeName(song.albumName), albumName);
    if (!albumHit) return false;
    if (!artistName) return true;
    return namesLooselyMatch(normalizeName(song.singer), artistName);
  });

  const sourceLabel = getSearchSourceLabel(album.source);
  return {
    type: "fallback",
    title: album.name,
    subtitle: `${sourceLabel}${album.artistName ? ` · ${album.artistName}` : ""} · 相关歌曲`,
    songs: matched,
    sourceLabel,
    emptyHint:
      matched.length > 0
        ? ""
        : `当前搜索结果里没有「${album.name}」的曲目。该音源暂无完整专辑页，可换关键词再搜后播放。`,
  };
}
