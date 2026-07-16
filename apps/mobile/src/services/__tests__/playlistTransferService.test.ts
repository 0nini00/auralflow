import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MusicInfo } from "@lx/core";

const playlistStore = vi.hoisted(() => ({
  state: {
    likedSongs: [] as MusicInfo[],
    localPlaylists: [] as any[],
    currentPlaylist: null as any,
    currentPlaylistSongs: [] as MusicInfo[],
    replaceLocalPlaylists: vi.fn(),
  },
}));

const share = vi.hoisted(() => vi.fn<(payload: { title: string; message: string }) => Promise<void>>(() => Promise.resolve()));

vi.mock("@/stores/playlistStore", () => ({
  usePlaylistStore: {
    getState: () => playlistStore.state,
  },
}));

vi.mock("react-native", () => ({
  Share: {
    share,
  },
}));

import { importPlaylistsFromJsonInput, shareExportedLocalPlaylists, shareExportedPlaylists } from "@/services/playlistTransferService";

function song(id: string, source: MusicInfo["source"] = "wy"): MusicInfo {
  return {
    id,
    name: `song-${id}`,
    singer: "artist",
    albumName: "album",
    source,
  };
}

describe("playlist transfer service", () => {
  beforeEach(() => {
    playlistStore.state.likedSongs = [];
    playlistStore.state.localPlaylists = [];
    playlistStore.state.currentPlaylist = null;
    playlistStore.state.currentPlaylistSongs = [];
    playlistStore.state.replaceLocalPlaylists.mockClear();
    share.mockClear();
  });

  it("shares exported playlist JSON through the native share sheet", async () => {
    playlistStore.state.localPlaylists = [
      {
        id: "local-1",
        name: "本地歌单",
        description: "说明",
        songs: [song("1", "local")],
        createdAt: 1000,
        updatedAt: 1000,
      },
    ];
    await shareExportedPlaylists();

    expect(share).toHaveBeenCalledTimes(1);
    const payload = share.mock.calls[0]?.[0];
    expect(payload?.title).toBe("导出 AuralFlow 歌单");
    expect(JSON.parse(payload?.message ?? "{}")).toEqual({
      app: "auralflow",
      version: 1,
      exportedAt: expect.any(Number),
      playlists: [
        {
          name: "本地歌单",
          description: "说明",
          songs: [song("1", "local")],
        },
      ],
    });
  });

  it("shares only the selected local playlist", async () => {
    const selectedPlaylist = {
      id: "local-1",
      name: "选中的歌单",
      description: "只导出这个",
      songs: [song("1", "local")],
      createdAt: 1000,
      updatedAt: 1000,
    };
    playlistStore.state.likedSongs = [song("liked-1", "wy")];
    playlistStore.state.localPlaylists = [
      selectedPlaylist,
      {
        id: "local-2",
        name: "其他歌单",
        songs: [song("2", "tx")],
        createdAt: 1000,
        updatedAt: 1000,
      },
    ];
    playlistStore.state.currentPlaylist = { id: "remote-1", name: "远端歌单", desc: "远端" };
    playlistStore.state.currentPlaylistSongs = [song("3", "wy")];

    await shareExportedLocalPlaylists([selectedPlaylist]);

    expect(share).toHaveBeenCalledTimes(1);
    const payload = share.mock.calls[0]?.[0];
    expect(payload?.title).toBe("导出 AuralFlow 歌单");
    expect(JSON.parse(payload?.message ?? "{}")).toEqual({
      app: "auralflow",
      version: 1,
      exportedAt: expect.any(Number),
      playlists: [
        {
          name: "选中的歌单",
          description: "只导出这个",
          songs: [song("1", "local")],
        },
      ],
    });
  });

  it("imports playlists from pasted JSON and reports added songs", async () => {
    const json = JSON.stringify({
      app: "auralflow",
      version: 1,
      exportedAt: 1000,
      playlists: [
        {
          name: "导入歌单",
          description: "来自 JSON",
          songs: [song("1", "wy"), song("2", "tx")],
        },
      ],
    });

    const result = await importPlaylistsFromJsonInput(`  ${json}  `);

    expect(result).toEqual({ addedSongCount: 2, imported: true });
    expect(playlistStore.state.replaceLocalPlaylists).toHaveBeenCalledWith([
      expect.objectContaining({
        name: "导入歌单",
        description: "来自 JSON",
        songs: [song("1", "wy"), song("2", "tx")],
      }),
    ]);
  });

  it("rejects blank playlist JSON input", async () => {
    await expect(importPlaylistsFromJsonInput("   ")).rejects.toThrow("请先粘贴歌单 JSON");
    expect(playlistStore.state.replaceLocalPlaylists).not.toHaveBeenCalled();
  });
});
