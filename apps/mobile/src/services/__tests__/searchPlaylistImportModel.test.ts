import { describe, expect, it } from "vitest";
import type { MusicInfo } from "@lx/core";
import type { LocalPlaylist } from "@/services/localPlaylistModel";
import type { SearchPlaylistResult } from "@/services/musicApi";
import type { WyPlaylistInfo } from "@/services/wyPlaylistService";
import {
  buildImportedSearchPlaylist,
  buildImportedSourcePlaylist,
  getSearchPlaylistPrimaryAction,
  getSearchPlaylistImportStatus,
  getSourcePlaylistImportStatus,
  type ImportablePlaylistSource,
} from "@/services/searchPlaylistImportModel";

function song(id: string, source: MusicInfo["source"] = "wy"): MusicInfo {
  return {
    id,
    name: `song-${id}`,
    singer: "artist",
    albumName: "album",
    source,
  };
}

function searchPlaylist(source: SearchPlaylistResult["source"] = "wy"): SearchPlaylistResult {
  return {
    id: "playlist-1",
    name: "搜索歌单",
    creatorName: "creator",
    coverUrl: "https://example.com/cover.jpg",
    trackCount: 2,
    playCount: 1000,
    source,
  };
}

function sourcePlaylist(source: ImportablePlaylistSource = "wy"): WyPlaylistInfo & { source: ImportablePlaylistSource } {
  return {
    id: "playlist-1",
    name: "搜索歌单",
    author: "creator",
    picUrl: "https://example.com/cover.jpg",
    coverImgUrl: "https://example.com/cover.jpg",
    trackCount: 2,
    playCount: 1000,
    source,
  };
}

function localPlaylist(description?: string): LocalPlaylist {
  return {
    id: "local-1",
    name: "搜索歌单",
    description,
    songs: [song("1")],
    createdAt: 1000,
    updatedAt: 1000,
  };
}

describe("search playlist import model", () => {
  it("uses account collection for WY search playlists and local import for TX playlists", () => {
    expect(getSearchPlaylistPrimaryAction(searchPlaylist("wy"), [])).toEqual({
      type: "collectWy",
      label: "收藏到网易云",
      disabled: false,
    });

    expect(getSearchPlaylistPrimaryAction(searchPlaylist("wy"), [sourcePlaylist("wy")])).toEqual({
      type: "collectWy",
      label: "已收藏",
      disabled: true,
    });

    expect(getSearchPlaylistPrimaryAction(searchPlaylist("tx"), [])).toEqual({
      type: "importLocal",
      label: "导入",
      disabled: false,
    });
  });

  it("builds a local playlist from a search playlist and its songs", () => {
    expect(buildImportedSearchPlaylist(searchPlaylist(), [song("1"), song("2")], 2000)).toEqual({
      id: "search-wy-playlist-1",
      name: "搜索歌单",
      description: "creator · 来自网易云搜索\n[af-search-playlist:wy:playlist-1]",
      cover: "https://example.com/cover.jpg",
      songs: [song("1"), song("2")],
      createdAt: 2000,
      updatedAt: 2000,
    });
  });

  it("marks already imported search playlists by source and id", () => {
    const imported = localPlaylist("creator\n[af-search-playlist:wy:playlist-1]");

    expect(getSearchPlaylistImportStatus(searchPlaylist("wy"), [imported])).toEqual({
      imported: true,
      label: "已导入",
    });
    expect(getSearchPlaylistImportStatus(searchPlaylist("tx"), [imported])).toEqual({
      imported: false,
      label: "导入",
    });
  });

  it("builds a local playlist from a playlist detail using the same import marker", () => {
    expect(buildImportedSourcePlaylist(sourcePlaylist(), [song("1"), song("2")], 2000)).toEqual({
      id: "search-wy-playlist-1",
      name: "搜索歌单",
      description: "creator · 来自网易云歌单\n[af-search-playlist:wy:playlist-1]",
      cover: "https://example.com/cover.jpg",
      songs: [song("1"), song("2")],
      createdAt: 2000,
      updatedAt: 2000,
    });
  });

  it("recognizes a playlist detail as imported when it was imported from search", () => {
    const imported = localPlaylist("creator\n[af-search-playlist:wy:playlist-1]");

    expect(getSourcePlaylistImportStatus(sourcePlaylist("wy"), [imported])).toEqual({
      imported: true,
      label: "已导入",
    });
    expect(getSourcePlaylistImportStatus(sourcePlaylist("tx"), [imported])).toEqual({
      imported: false,
      label: "导入",
    });
  });
});
