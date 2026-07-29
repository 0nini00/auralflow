import type { WyPlaylistInfo } from "./wyPlaylistService";
import { mapTxPlaylistInfo } from "./txPlaylistService";
import type {
  AlbumDetailResult,
  SearchAlbumResult,
  SearchArtistResult,
  SearchPlaylistResult,
} from "./musicApi";

export interface SearchArtistDetailRoute {
  type: "artist";
  artist: SearchArtistResult;
  parentAlbum: SearchAlbumDetailRoute | null;
}

export interface SearchAlbumDetailRoute {
  type: "album";
  album: SearchAlbumResult;
  parentArtist: SearchArtistResult | null;
}

export interface SearchPlaylistDetailRoute {
  type: "playlist";
  playlist: WyPlaylistInfo;
}

export type SearchDetailRoute = SearchArtistDetailRoute | SearchAlbumDetailRoute | SearchPlaylistDetailRoute;

function isSupportedNeteaseSource(source: string): boolean {
  return source === "wy";
}

function isSupportedPlaylistSource(source: string): boolean {
  return source === "wy" || source === "tx";
}

export function toWyPlaylistInfo(playlist: SearchPlaylistResult): WyPlaylistInfo {
  return {
    id: playlist.id,
    name: playlist.name,
    author: playlist.creatorName || "未知创建者",
    picUrl: playlist.coverUrl,
    coverImgUrl: playlist.coverUrl,
    trackCount: playlist.trackCount ?? 0,
    playCount: playlist.playCount,
    source: playlist.source,
  };
}

export function openSearchArtistDetail(artist: SearchArtistResult): SearchArtistDetailRoute | null {
  if (!isSupportedNeteaseSource(artist.source)) return null;
  return { type: "artist", artist, parentAlbum: null };
}

export function openSearchAlbumDetail(
  album: SearchAlbumResult,
  parentArtist: SearchArtistResult | null = null
): SearchAlbumDetailRoute | null {
  if (!isSupportedNeteaseSource(album.source)) return null;
  return { type: "album", album, parentArtist };
}

export function openAlbumArtistDetail(
  album: AlbumDetailResult["album"] | SearchAlbumResult,
  parentAlbum: SearchAlbumDetailRoute | null = null,
): SearchArtistDetailRoute | null {
  if (!isSupportedNeteaseSource(album.source)) return null;
  if (!("artistId" in album) || !album.artistId) return null;

  return {
    type: "artist",
    artist: {
      id: album.artistId,
      name: album.artistName,
      source: "wy",
    },
    parentAlbum,
  };
}

export function openSearchPlaylistDetail(playlist: SearchPlaylistResult): SearchPlaylistDetailRoute | null {
  if (!isSupportedPlaylistSource(playlist.source)) return null;
  const detailPlaylist = playlist.source === "tx" ? mapTxPlaylistInfo(playlist) : toWyPlaylistInfo(playlist);
  return { type: "playlist", playlist: detailPlaylist };
}

export function backFromSearchDetail(route: SearchDetailRoute | null): SearchDetailRoute | null {
  if (route?.type === "artist" && route.parentAlbum) {
    return route.parentAlbum;
  }

  if (route?.type === "album" && route.parentArtist) {
    return { type: "artist", artist: route.parentArtist, parentAlbum: null };
  }

  return null;
}
