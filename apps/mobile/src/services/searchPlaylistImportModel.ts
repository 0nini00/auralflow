import type { MusicInfo } from "@lx/core";
import type { LocalPlaylist } from "./localPlaylistModel";
import type { SearchPlaylistResult } from "./musicApi";
import type { WyPlaylistInfo } from "./wyPlaylistService";
import { createLocalPlaylistWithSongs } from "./localPlaylistModel";

export type ImportablePlaylistSource = SearchPlaylistResult["source"];

type ImportablePlaylist = Pick<WyPlaylistInfo, "id" | "name"> & {
  source: ImportablePlaylistSource;
  author?: string;
  creatorName?: string;
  coverUrl?: string;
  picUrl?: string;
  coverImgUrl?: string;
};

const SOURCE_LABELS: Record<ImportablePlaylistSource, string> = {
  wy: "网易云",
  tx: "QQ音乐",
};

function markerForPlaylist(playlist: ImportablePlaylist): string {
  return `[af-search-playlist:${playlist.source}:${playlist.id}]`;
}

function getCreatorName(playlist: ImportablePlaylist): string | undefined {
  return playlist.creatorName || playlist.author;
}

function buildDescription(playlist: ImportablePlaylist, origin: "搜索" | "歌单"): string {
  const meta = [getCreatorName(playlist), `来自${SOURCE_LABELS[playlist.source]}${origin}`]
    .filter(Boolean)
    .join(" · ");
  return [meta, markerForPlaylist(playlist)].filter(Boolean).join("\n");
}

function getPlaylistCover(playlist: ImportablePlaylist): string | undefined {
  return playlist.coverUrl || playlist.coverImgUrl || playlist.picUrl || undefined;
}

export interface SearchPlaylistImportStatus {
  imported: boolean;
  label: string;
}

export interface SearchPlaylistPrimaryAction {
  type: "collectWy" | "importLocal";
  label: string;
  disabled: boolean;
}

function hasWyPlaylist(playlists: Array<Pick<WyPlaylistInfo, "id" | "source">>, playlist: ImportablePlaylist): boolean {
  return playlists.some((item) => item.source === "wy" && item.id === playlist.id);
}

export function getSearchPlaylistPrimaryAction(
  playlist: SearchPlaylistResult,
  wyPlaylists: Array<Pick<WyPlaylistInfo, "id" | "source">>,
  localPlaylists: LocalPlaylist[] = [],
): SearchPlaylistPrimaryAction {
  if (playlist.source === "wy") {
    const collected = hasWyPlaylist(wyPlaylists, playlist);
    return {
      type: "collectWy",
      label: collected ? "已收藏" : "收藏到网易云",
      disabled: collected,
    };
  }

  const status = getSearchPlaylistImportStatus(playlist, localPlaylists);
  return {
    type: "importLocal",
    label: status.label,
    disabled: status.imported,
  };
}

export function getSearchPlaylistImportStatus(
  playlist: SearchPlaylistResult,
  localPlaylists: LocalPlaylist[],
): SearchPlaylistImportStatus {
  return getSourcePlaylistImportStatus(playlist, localPlaylists);
}

export function getSourcePlaylistImportStatus(
  playlist: ImportablePlaylist,
  localPlaylists: LocalPlaylist[],
): SearchPlaylistImportStatus {
  const marker = markerForPlaylist(playlist);
  const imported = localPlaylists.some((item) => item.description?.includes(marker));
  return {
    imported,
    label: imported ? "已导入" : "导入",
  };
}

export function buildImportedSearchPlaylist(
  playlist: SearchPlaylistResult,
  songs: MusicInfo[],
  now = Date.now(),
): LocalPlaylist {
  const [created] = createLocalPlaylistWithSongs([], {
    id: `search-${playlist.source}-${playlist.id}`,
    name: playlist.name,
    description: buildDescription(playlist, "搜索"),
    cover: getPlaylistCover(playlist),
    songs,
    now,
  });
  return created;
}

export function buildImportedSourcePlaylist(
  playlist: WyPlaylistInfo & { source: ImportablePlaylistSource },
  songs: MusicInfo[],
  now = Date.now(),
): LocalPlaylist {
  const [created] = createLocalPlaylistWithSongs([], {
    id: `search-${playlist.source}-${playlist.id}`,
    name: playlist.name,
    description: buildDescription(playlist, "歌单"),
    cover: getPlaylistCover(playlist),
    songs,
    now,
  });
  return created;
}
