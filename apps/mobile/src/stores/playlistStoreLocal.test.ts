import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MusicInfo } from "@lx/core";

const storage = vi.hoisted(() => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: vi.fn((key: string) => Promise.resolve(data.get(key) ?? null)),
    setItem: vi.fn((key: string, value: string) => {
      data.set(key, value);
      return Promise.resolve();
    }),
    removeItem: vi.fn((key: string) => {
      data.delete(key);
      return Promise.resolve();
    }),
    clear: () => data.clear(),
  };
});

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: storage,
}));

vi.mock("@/services/wyPlaylistService", () => ({
  getUserPlaylists: vi.fn(),
  getPlaylistDetail: vi.fn(),
  getLikedSongs: vi.fn(),
  addPlaylistTracks: vi.fn(),
  removePlaylistTracks: vi.fn(),
  likeSong: vi.fn(),
  unlikeSong: vi.fn(),
  subscribePlaylist: vi.fn(),
}));

import { usePlaylistStore } from "@/stores/playlistStore";
import {
  addPlaylistTracks as addPlaylistTracksApi,
  likeSong as likeSongApi,
  removePlaylistTracks as removePlaylistTracksApi,
  subscribePlaylist as subscribePlaylistApi,
  unlikeSong as unlikeSongApi,
} from "@/services/wyPlaylistService";

const LOCAL_PLAYLISTS_KEY = "auralflow.mobile.localPlaylists";
const LIKED_SONGS_KEY = "auralflow.mobile.likedSongs";

function song(id: string, source: MusicInfo["source"] = "wy"): MusicInfo {
  return {
    id,
    name: `song-${id}`,
    singer: "artist",
    albumName: "album",
    source,
  };
}

function resetStore() {
  usePlaylistStore.setState({
    playlists: [],
    currentPlaylist: null,
    currentPlaylistSongs: [],
    likedPlaylist: null,
    likedSongs: [],
    likedSongIds: new Set(),
    localPlaylists: [],
    loading: false,
    error: null,
  } as any);
}

describe("playlist store local playlists", () => {
  beforeEach(() => {
    storage.clear();
    storage.getItem.mockClear();
    storage.setItem.mockClear();
    storage.removeItem.mockClear();
    vi.mocked(likeSongApi).mockClear();
    vi.mocked(unlikeSongApi).mockClear();
    vi.mocked(subscribePlaylistApi).mockClear();
    vi.mocked(addPlaylistTracksApi).mockClear();
    vi.mocked(removePlaylistTracksApi).mockClear();
    resetStore();
  });



  it("likes and persists non-WY songs locally without calling the WY API", async () => {
    await usePlaylistStore.getState().likeSong(song("1", "tx"));

    expect(likeSongApi).not.toHaveBeenCalled();
    expect(usePlaylistStore.getState().likedSongs).toEqual([song("1", "tx")]);
    expect(usePlaylistStore.getState().likedSongIds).toEqual(new Set(["tx:1"]));
    expect(storage.setItem).toHaveBeenLastCalledWith(LIKED_SONGS_KEY, JSON.stringify([song("1", "tx")]));
  });

  it("unlikes and persists non-WY songs locally without calling the WY API", async () => {
    usePlaylistStore.setState({
      likedSongs: [song("1", "tx"), song("2", "wy")],
      likedSongIds: new Set(["tx:1", "wy:2"]),
    } as any);

    await usePlaylistStore.getState().unlikeSong(song("1", "tx"));

    expect(unlikeSongApi).not.toHaveBeenCalled();
    expect(usePlaylistStore.getState().likedSongs).toEqual([song("2", "wy")]);
    expect(usePlaylistStore.getState().likedSongIds).toEqual(new Set(["wy:2"]));
    expect(storage.setItem).toHaveBeenLastCalledWith(LIKED_SONGS_KEY, JSON.stringify([song("2", "wy")]));
  });

  it("calls the WY API when liking WY songs", async () => {
    await usePlaylistStore.getState().likeSong(song("1", "wy"));

    expect(likeSongApi).toHaveBeenCalledWith("1");
  });

  it("checks liked songs by source and id", () => {
    usePlaylistStore.setState({
      likedSongs: [song("1", "wy")],
      likedSongIds: new Set(["wy:1"]),
    } as any);

    expect(usePlaylistStore.getState().isLiked(song("1", "wy"))).toBe(true);
    expect(usePlaylistStore.getState().isLiked(song("1", "tx"))).toBe(false);
  });

  it("loads local playlists from persistent storage", async () => {
    storage.data.set(
      LOCAL_PLAYLISTS_KEY,
      JSON.stringify([
        { id: "local-1", name: "本地", songs: [song("1")], createdAt: 1000, updatedAt: 1000 },
      ]),
    );

    await usePlaylistStore.getState().loadLocalPlaylists();

    expect(usePlaylistStore.getState().localPlaylists).toEqual([
      { id: "local-1", name: "本地", songs: [song("1")], createdAt: 1000, updatedAt: 1000 },
    ]);
    expect(storage.getItem).toHaveBeenCalledWith(LOCAL_PLAYLISTS_KEY);
  });

  it("subscribes a remote WY playlist and refreshes account playlists", async () => {
    const remotePlaylist = {
      id: "remote-1",
      name: "远程歌单",
      author: "author",
      source: "wy" as const,
      trackCount: 2,
      subscribed: false,
    };
    const refreshedPlaylists = [{ ...remotePlaylist, subscribed: true }];
    const { getUserPlaylists } = await import("@/services/wyPlaylistService");
    vi.mocked(getUserPlaylists).mockResolvedValueOnce(refreshedPlaylists);
    usePlaylistStore.setState({ playlists: [] } as any);

    await usePlaylistStore.getState().setWyPlaylistSubscribed("user-1", remotePlaylist, true);

    expect(subscribePlaylistApi).toHaveBeenCalledWith("remote-1", true);
    expect(getUserPlaylists).toHaveBeenCalledWith("user-1");
    expect(usePlaylistStore.getState().playlists).toEqual(refreshedPlaylists);
  });

  it("removes subscribed WY playlists after unsubscribe", async () => {
    usePlaylistStore.setState({
      playlists: [
        { id: "owned-1", name: "自建", author: "me", source: "wy", trackCount: 1, subscribed: false },
        { id: "sub-1", name: "收藏", author: "other", source: "wy", trackCount: 1, subscribed: true },
      ],
    } as any);

    await usePlaylistStore.getState().setWyPlaylistSubscribed("user-1", { id: "sub-1" } as any, false);

    expect(subscribePlaylistApi).toHaveBeenCalledWith("sub-1", false);
    expect(usePlaylistStore.getState().playlists.map((playlist) => playlist.id)).toEqual(["owned-1"]);
  });

  it("rejects unsubscribing owned WY playlists", async () => {
    usePlaylistStore.setState({
      playlists: [
        { id: "owned-1", name: "自建", author: "me", source: "wy", trackCount: 1, subscribed: false },
      ],
    } as any);

    await expect(
      usePlaylistStore.getState().setWyPlaylistSubscribed("user-1", { id: "owned-1" } as any, false),
    ).rejects.toThrow("自建歌单不能取消收藏");
    expect(subscribePlaylistApi).not.toHaveBeenCalled();
  });

  it("adds a WY song to an owned WY playlist and updates track count", async () => {
    usePlaylistStore.setState({
      playlists: [
        { id: "owned-1", name: "自建", author: "me", source: "wy", trackCount: 1, subscribed: false },
      ],
    } as any);

    await usePlaylistStore.getState().addSongToWyPlaylist("owned-1", song("2", "wy"));

    expect(addPlaylistTracksApi).toHaveBeenCalledWith("owned-1", ["2"]);
    expect(usePlaylistStore.getState().playlists[0]?.trackCount).toBe(2);
  });

  it("rejects adding songs to subscribed WY playlists", async () => {
    usePlaylistStore.setState({
      playlists: [
        { id: "sub-1", name: "收藏", author: "other", source: "wy", trackCount: 1, subscribed: true },
      ],
    } as any);

    await expect(usePlaylistStore.getState().addSongToWyPlaylist("sub-1", song("2", "wy"))).rejects.toThrow("收藏歌单不支持添加歌曲");
    expect(addPlaylistTracksApi).not.toHaveBeenCalled();
  });

  it("rejects adding non-WY songs to WY playlists", async () => {
    usePlaylistStore.setState({
      playlists: [
        { id: "owned-1", name: "自建", author: "me", source: "wy", trackCount: 1, subscribed: false },
      ],
    } as any);

    await expect(usePlaylistStore.getState().addSongToWyPlaylist("owned-1", song("2", "tx"))).rejects.toThrow("当前只支持添加网易云歌曲到网易云歌单");
    expect(addPlaylistTracksApi).not.toHaveBeenCalled();
  });

  it("removes a WY song from an owned WY playlist and updates current detail", async () => {
    usePlaylistStore.setState({
      playlists: [
        { id: "owned-1", name: "自建", author: "me", source: "wy", trackCount: 2, subscribed: false },
      ],
      currentPlaylist: { id: "owned-1", name: "自建", author: "me", source: "wy", trackCount: 2, subscribed: false },
      currentPlaylistSongs: [song("1", "wy"), song("2", "wy")],
    } as any);

    await usePlaylistStore.getState().removeSongFromWyPlaylist("owned-1", song("2", "wy"));

    expect(removePlaylistTracksApi).toHaveBeenCalledWith("owned-1", ["2"]);
    expect(usePlaylistStore.getState().playlists[0]?.trackCount).toBe(1);
    expect(usePlaylistStore.getState().currentPlaylist?.trackCount).toBe(1);
    expect(usePlaylistStore.getState().currentPlaylistSongs.map((item) => item.id)).toEqual(["1"]);
  });

  it("rejects removing songs from subscribed WY playlists", async () => {
    usePlaylistStore.setState({
      playlists: [
        { id: "sub-1", name: "收藏", author: "other", source: "wy", trackCount: 1, subscribed: true },
      ],
    } as any);

    await expect(usePlaylistStore.getState().removeSongFromWyPlaylist("sub-1", song("2", "wy"))).rejects.toThrow("收藏歌单不支持删除歌曲");
    expect(removePlaylistTracksApi).not.toHaveBeenCalled();
  });

  it("rejects removing non-WY songs from WY playlists", async () => {
    usePlaylistStore.setState({
      playlists: [
        { id: "owned-1", name: "自建", author: "me", source: "wy", trackCount: 1, subscribed: false },
      ],
    } as any);

    await expect(usePlaylistStore.getState().removeSongFromWyPlaylist("owned-1", song("2", "tx"))).rejects.toThrow("当前只支持从网易云歌单删除网易云歌曲");
    expect(removePlaylistTracksApi).not.toHaveBeenCalled();
  });


  it("replaces local playlists and persists them", async () => {
    const localPlaylists = [
      { id: "local-1", name: "同步歌单", songs: [song("1", "local")], createdAt: 1000, updatedAt: 1000 },
    ];

    await usePlaylistStore.getState().replaceLocalPlaylists(localPlaylists);

    expect(usePlaylistStore.getState().localPlaylists).toEqual(localPlaylists);
    expect(storage.setItem).toHaveBeenLastCalledWith(LOCAL_PLAYLISTS_KEY, JSON.stringify(localPlaylists));
  });

  it("creates and persists a local playlist without touching remote playlists", async () => {
    usePlaylistStore.setState({
      playlists: [{ id: "remote-1", name: "远端", author: "me", source: "wy", trackCount: 0 }],
    } as any);

    await usePlaylistStore.getState().createLocalPlaylist({ id: "local-1", name: " 新歌单 ", now: 1000 });

    expect(usePlaylistStore.getState().playlists).toHaveLength(1);
    expect(usePlaylistStore.getState().localPlaylists).toMatchObject([
      { id: "local-1", name: "新歌单", songs: [], createdAt: 1000, updatedAt: 1000 },
    ]);
    expect(JSON.parse(storage.data.get(LOCAL_PLAYLISTS_KEY) ?? "[]")).toMatchObject([
      { id: "local-1", name: "新歌单", songs: [] },
    ]);
  });


  it("creates a local playlist with a selected song and persists it", async () => {
    await usePlaylistStore.getState().createLocalPlaylistWithSong({
      id: "local-1",
      name: "新歌单",
      now: 1000,
      song: song("1", "wy"),
    });

    expect(usePlaylistStore.getState().localPlaylists).toMatchObject([
      { id: "local-1", name: "新歌单", songs: [song("1", "wy")], createdAt: 1000, updatedAt: 1000 },
    ]);
    expect(storage.setItem).toHaveBeenLastCalledWith(
      LOCAL_PLAYLISTS_KEY,
      JSON.stringify(usePlaylistStore.getState().localPlaylists),
    );
  });

  it("creates a local playlist with imported songs and persists it", async () => {
    await usePlaylistStore.getState().createLocalPlaylistWithSongs({
      id: "search-wy-playlist-1",
      name: "搜索歌单",
      description: "来自搜索结果",
      now: 1000,
      songs: [song("1", "wy"), song("1", "wy"), song("2", "tx")],
    });

    expect(usePlaylistStore.getState().localPlaylists).toMatchObject([
      {
        id: "search-wy-playlist-1",
        name: "搜索歌单",
        description: "来自搜索结果",
        songs: [song("1", "wy"), song("2", "tx")],
        createdAt: 1000,
        updatedAt: 1000,
      },
    ]);
    expect(storage.setItem).toHaveBeenLastCalledWith(
      LOCAL_PLAYLISTS_KEY,
      JSON.stringify(usePlaylistStore.getState().localPlaylists),
    );
  });

  it("duplicates a local playlist, persists it, and returns the copy", async () => {
    await usePlaylistStore.getState().createLocalPlaylistWithSongs({
      id: "local-1",
      name: "默认",
      description: "说明",
      now: 1000,
      songs: [song("1", "wy"), song("2", "tx")],
    });

    const duplicated = await usePlaylistStore.getState().duplicateLocalPlaylist("local-1", {
      id: "local-copy",
      now: 2000,
    });

    expect(duplicated).toMatchObject({
      id: "local-copy",
      name: "默认 (副本)",
      description: "说明",
      songs: [song("1", "wy"), song("2", "tx")],
      createdAt: 2000,
      updatedAt: 2000,
    });
    expect(usePlaylistStore.getState().localPlaylists.map((playlist) => playlist.id)).toEqual([
      "local-1",
      "local-copy",
    ]);
    expect(storage.setItem).toHaveBeenLastCalledWith(
      LOCAL_PLAYLISTS_KEY,
      JSON.stringify(usePlaylistStore.getState().localPlaylists),
    );
  });

  it("updates local playlist name and description and persists it", async () => {
    await usePlaylistStore.getState().createLocalPlaylist({
      id: "local-1",
      name: "默认",
      description: "旧说明",
      now: 1000,
    });

    await usePlaylistStore.getState().updateLocalPlaylistInfo("local-1", {
      name: " 新名称 ",
      description: "  新说明  ",
      now: 2000,
    });

    expect(usePlaylistStore.getState().localPlaylists[0]).toMatchObject({
      id: "local-1",
      name: "新名称",
      description: "新说明",
      updatedAt: 2000,
    });
    expect(storage.setItem).toHaveBeenLastCalledWith(
      LOCAL_PLAYLISTS_KEY,
      JSON.stringify(usePlaylistStore.getState().localPlaylists),
    );
  });

  it("adds and removes songs in a local playlist", async () => {
    await usePlaylistStore.getState().createLocalPlaylist({ id: "local-1", name: "默认", now: 1000 });
    await usePlaylistStore.getState().addSongToLocalPlaylist("local-1", song("1", "wy"), 2000);
    await usePlaylistStore.getState().addSongToLocalPlaylist("local-1", song("1", "wy"), 3000);
    await usePlaylistStore.getState().addSongToLocalPlaylist("local-1", song("1", "tx"), 4000);
    await usePlaylistStore.getState().removeSongFromLocalPlaylist("local-1", song("1", "wy"), 5000);

    expect(usePlaylistStore.getState().localPlaylists[0]?.songs.map((item) => `${item.source}:${item.id}`)).toEqual([
      "tx:1",
    ]);
    expect(usePlaylistStore.getState().localPlaylists[0]?.updatedAt).toBe(5000);
    expect(storage.setItem).toHaveBeenLastCalledWith(
      LOCAL_PLAYLISTS_KEY,
      JSON.stringify(usePlaylistStore.getState().localPlaylists),
    );
  });
});
