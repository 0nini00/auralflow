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

vi.mock("@/services/localMusicService", () => ({
  scanLocalMusic: vi.fn(),
  updateLocalMusicMetadata: vi.fn().mockResolvedValue(1),
}));

import { useLocalMusicStore } from "@/stores/localMusicStore";
import { scanLocalMusic } from "@/services/localMusicService";

const LOCAL_MUSIC_KEY = "auralflow.mobile.localMusic";

function song(id: string, source: MusicInfo["source"] = "local"): MusicInfo {
  return {
    id,
    name: `song-${id}`,
    singer: "artist",
    albumName: "album",
    source,
  };
}

function resetStore() {
  useLocalMusicStore.setState({
    localSongs: [],
    loading: false,
    error: null,
  } as any);
}

describe("local music store", () => {
  beforeEach(() => {
    storage.clear();
    storage.getItem.mockClear();
    storage.setItem.mockClear();
    storage.removeItem.mockClear();
    vi.mocked(scanLocalMusic).mockReset();
    resetStore();
  });

  it("loads persisted local songs on startup", async () => {
    storage.data.set(LOCAL_MUSIC_KEY, JSON.stringify([song("1", "local")]));

    await useLocalMusicStore.getState().loadLocalSongs();

    expect(useLocalMusicStore.getState().localSongs).toEqual([song("1", "local")]);
    expect(storage.getItem).toHaveBeenCalledWith(LOCAL_MUSIC_KEY);
  });

  it("persists scanned local songs", async () => {
    vi.mocked(scanLocalMusic).mockResolvedValue([song("1", "local"), song("2", "local")]);

    await useLocalMusicStore.getState().scanMusic();

    expect(useLocalMusicStore.getState().localSongs).toEqual([song("1", "local"), song("2", "local")]);
    expect(storage.setItem).toHaveBeenCalledWith(
      LOCAL_MUSIC_KEY,
      JSON.stringify([song("1", "local"), song("2", "local")]),
    );
  });

  it("removes one local song by source and id without touching same-id songs from other sources", () => {
    useLocalMusicStore.setState({
      localSongs: [song("1", "local"), song("1", "wy"), song("2", "local")],
    } as any);

    void useLocalMusicStore.getState().removeLocalSong({ id: "1", source: "local" });

    expect(useLocalMusicStore.getState().localSongs.map((item) => `${item.source}:${item.id}`)).toEqual([
      "wy:1",
      "local:2",
    ]);
  });

  it("persists local song removal", async () => {
    useLocalMusicStore.setState({
      localSongs: [song("1", "local"), song("2", "local")],
    } as any);

    await useLocalMusicStore.getState().removeLocalSong({ id: "1", source: "local" });

    expect(storage.setItem).toHaveBeenCalledWith(
      LOCAL_MUSIC_KEY,
      JSON.stringify([song("2", "local")]),
    );
  });

  it("updates local song metadata and persists the edited display fields", async () => {
    useLocalMusicStore.setState({
      localSongs: [song("1", "local"), song("2", "local")],
    } as any);

    await useLocalMusicStore.getState().updateLocalSongMetadata(
      { id: "1", source: "local" },
      {
        name: "  新标题 ",
        singer: " 新歌手 ",
        albumName: " 新专辑 ",
        coverUrl: " https://img.example/cover.jpg ",
        localLyrics: " [00:01.00]第一句歌词 ",
      },
    );

    expect(useLocalMusicStore.getState().localSongs).toEqual([
      {
        ...song("1", "local"),
        name: "新标题",
        singer: "新歌手",
        albumName: "新专辑",
        picUrl: "https://img.example/cover.jpg",
        img: "https://img.example/cover.jpg",
        localLyrics: "[00:01.00]第一句歌词",
      },
      song("2", "local"),
    ]);
    expect(storage.setItem).toHaveBeenCalledWith(
      LOCAL_MUSIC_KEY,
      JSON.stringify([
        {
          ...song("1", "local"),
          name: "新标题",
          singer: "新歌手",
          albumName: "新专辑",
          picUrl: "https://img.example/cover.jpg",
          img: "https://img.example/cover.jpg",
          localLyrics: "[00:01.00]第一句歌词",
        },
        song("2", "local"),
      ]),
    );
  });

  it("does not persist local metadata edits with a blank title", async () => {
    useLocalMusicStore.setState({
      localSongs: [song("1", "local")],
    } as any);

    await expect(useLocalMusicStore.getState().updateLocalSongMetadata(
      { id: "1", source: "local" },
      { name: " ", singer: "歌手", albumName: "专辑" },
    )).rejects.toThrow("歌曲标题不能为空");

    expect(useLocalMusicStore.getState().localSongs).toEqual([song("1", "local")]);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("clears persisted local songs", async () => {
    storage.data.set(LOCAL_MUSIC_KEY, JSON.stringify([song("1", "local")]));
    useLocalMusicStore.setState({ localSongs: [song("1", "local")] } as any);

    await useLocalMusicStore.getState().clearLocalMusic();

    expect(useLocalMusicStore.getState().localSongs).toEqual([]);
    expect(storage.removeItem).toHaveBeenCalledWith(LOCAL_MUSIC_KEY);
  });
});
