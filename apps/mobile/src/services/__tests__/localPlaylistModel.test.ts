import { describe, expect, it } from "vitest";
import type { MusicInfo } from "@lx/core";
import {
  addSongToLocalPlaylist,
  createLocalPlaylist,
  createLocalPlaylistWithSongs,
  createLocalPlaylistWithSong,
  deleteLocalPlaylist,
  duplicateLocalPlaylist,
  getLocalPlaylistTrackCount,
  removeSongFromLocalPlaylist,
  renameLocalPlaylist,
  updateLocalPlaylistInfo,
} from "@/services/localPlaylistModel";

function song(id: string, source: MusicInfo["source"] = "wy"): MusicInfo {
  return {
    id,
    name: `song-${id}`,
    singer: "artist",
    albumName: "album",
    source,
  };
}

describe("local playlist model", () => {
  it("creates a playlist with a trimmed name and injected metadata", () => {
    const playlists = createLocalPlaylist([], {
      id: "playlist-1",
      name: "  跑步  ",
      description: "  日常歌单  ",
      now: 1000,
    });

    expect(playlists).toEqual([
      {
        id: "playlist-1",
        name: "跑步",
        description: "日常歌单",
        songs: [],
        createdAt: 1000,
        updatedAt: 1000,
      },
    ]);
  });

  it("rejects empty playlist names", () => {
    expect(() => createLocalPlaylist([], { id: "playlist-1", name: "   ", now: 1000 })).toThrow(
      "歌单名称不能为空",
    );
  });


  it("creates a playlist with the selected song already added", () => {
    const playlists = createLocalPlaylistWithSong([], {
      id: "playlist-1",
      name: "新歌单",
      now: 1000,
      song: song("1", "wy"),
    });

    expect(playlists[0]).toMatchObject({
      id: "playlist-1",
      name: "新歌单",
      createdAt: 1000,
      updatedAt: 1000,
      songs: [song("1", "wy")],
    });
  });

  it("creates a playlist with multiple songs deduplicated by source and id", () => {
    const playlists = createLocalPlaylistWithSongs([], {
      id: "playlist-1",
      name: "搜索歌单",
      description: "来自搜索结果",
      now: 1000,
      songs: [song("1", "wy"), song("1", "wy"), song("1", "tx")],
    });

    expect(playlists[0]).toMatchObject({
      id: "playlist-1",
      name: "搜索歌单",
      description: "来自搜索结果",
      createdAt: 1000,
      updatedAt: 1000,
      songs: [song("1", "wy"), song("1", "tx")],
    });
  });

  it("renames playlists without mutating the input", () => {
    const original = createLocalPlaylist([], { id: "playlist-1", name: "旧名称", now: 1000 });
    const renamed = renameLocalPlaylist(original, "playlist-1", " 新名称 ", 2000);

    expect(original[0]?.name).toBe("旧名称");
    expect(renamed[0]).toMatchObject({ name: "新名称", updatedAt: 2000 });
  });

  it("updates playlist name and description together", () => {
    const original = createLocalPlaylist([], {
      id: "playlist-1",
      name: "旧名称",
      description: "旧说明",
      now: 1000,
    });

    const updated = updateLocalPlaylistInfo(original, "playlist-1", {
      name: " 新名称 ",
      description: "  新说明  ",
      now: 2000,
    });
    const clearedDescription = updateLocalPlaylistInfo(updated, "playlist-1", {
      name: "新名称",
      description: "   ",
      now: 3000,
    });

    expect(original[0]).toMatchObject({ name: "旧名称", description: "旧说明", updatedAt: 1000 });
    expect(updated[0]).toMatchObject({ name: "新名称", description: "新说明", updatedAt: 2000 });
    expect(clearedDescription[0]).toMatchObject({ name: "新名称", description: undefined, updatedAt: 3000 });
  });

  it("duplicates playlists with songs and description without mutating the input", () => {
    const original = createLocalPlaylistWithSongs([], {
      id: "playlist-1",
      name: "默认",
      description: "说明",
      songs: [song("1", "wy"), song("2", "tx")],
      now: 1000,
    });

    const duplicated = duplicateLocalPlaylist(original, "playlist-1", {
      id: "playlist-copy",
      now: 2000,
    });

    expect(original).toHaveLength(1);
    expect(duplicated).toEqual([
      original[0],
      {
        id: "playlist-copy",
        name: "默认 (副本)",
        description: "说明",
        songs: [song("1", "wy"), song("2", "tx")],
        createdAt: 2000,
        updatedAt: 2000,
      },
    ]);
    expect(duplicated[1]?.songs).not.toBe(original[0]?.songs);
  });

  it("adds songs by source and id without duplicates", () => {
    const playlists = createLocalPlaylist([], { id: "playlist-1", name: "默认", now: 1000 });
    const withSong = addSongToLocalPlaylist(playlists, "playlist-1", song("1", "wy"), 2000);
    const withDuplicate = addSongToLocalPlaylist(withSong, "playlist-1", song("1", "wy"), 3000);
    const withDifferentSource = addSongToLocalPlaylist(withDuplicate, "playlist-1", song("1", "tx"), 4000);

    expect(withSong[0]?.songs).toHaveLength(1);
    expect(withDuplicate[0]?.songs).toHaveLength(1);
    expect(withDuplicate[0]?.updatedAt).toBe(2000);
    expect(withDifferentSource[0]?.songs.map((item) => `${item.source}:${item.id}`)).toEqual(["wy:1", "tx:1"]);
    expect(withDifferentSource[0]?.updatedAt).toBe(4000);
  });

  it("removes songs by source and id and deletes playlists", () => {
    const playlists = createLocalPlaylist([], { id: "playlist-1", name: "默认", now: 1000 });
    const withSongs = addSongToLocalPlaylist(
      addSongToLocalPlaylist(playlists, "playlist-1", song("1", "wy"), 2000),
      "playlist-1",
      song("1", "tx"),
      3000,
    );

    const removed = removeSongFromLocalPlaylist(withSongs, "playlist-1", song("1", "wy"), 4000);
    expect(removed[0]?.songs.map((item) => `${item.source}:${item.id}`)).toEqual(["tx:1"]);
    expect(removed[0]?.updatedAt).toBe(4000);
    expect(getLocalPlaylistTrackCount(removed[0])).toBe(1);
    expect(deleteLocalPlaylist(removed, "playlist-1")).toEqual([]);
  });

  it("fails clearly when editing an unknown playlist", () => {
    expect(() => renameLocalPlaylist([], "missing", "新名称", 1000)).toThrow("歌单不存在");
    expect(() => updateLocalPlaylistInfo([], "missing", { name: "新名称", now: 1000 })).toThrow("歌单不存在");
    expect(() => duplicateLocalPlaylist([], "missing", { id: "copy", now: 1000 })).toThrow("歌单不存在");
    expect(() => addSongToLocalPlaylist([], "missing", song("1"), 1000)).toThrow("歌单不存在");
    expect(() => removeSongFromLocalPlaylist([], "missing", song("1"), 1000)).toThrow("歌单不存在");
  });
});
