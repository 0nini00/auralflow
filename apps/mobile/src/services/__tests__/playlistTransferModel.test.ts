import { describe, expect, it } from "vitest";
import type { MusicInfo } from "@lx/core";
import type { WyPlaylistInfo } from "@/services/wyPlaylistService";
import type { LocalPlaylist } from "@/services/localPlaylistModel";
import {
  buildImportedLocalPlaylists,
  buildPlaylistExportEnvelope,
  mergeImportedSongs,
} from "@/services/playlistTransferModel";

const song = (id: string, source: MusicInfo["source"] = "wy"): MusicInfo => ({
  id,
  name: `Song ${id}`,
  singer: "Artist",
  albumName: "Album",
  source,
});

const localPlaylist = (id: string, name: string, songs: MusicInfo[], cover?: string): LocalPlaylist => ({
  id,
  name,
  cover,
  songs,
  createdAt: 1000,
  updatedAt: 1000,
});

describe("playlist transfer model", () => {
  it("exports the current playlist description from desc", () => {
    const playlist: WyPlaylistInfo = {
      id: "playlist-1",
      name: "迁移歌单",
      author: "AuralFlow",
      desc: "桌面端字段",
      trackCount: 1,
      source: "wy",
    };

    const envelope = buildPlaylistExportEnvelope({
      likedSongs: [],
      currentPlaylist: playlist,
      currentPlaylistSongs: [song("1")],
      exportedAt: 123,
    });

    expect(envelope.playlists).toEqual([
      {
        name: "迁移歌单",
        description: "桌面端字段",
        songs: [song("1")],
      },
    ]);
  });

  it("exports local playlists as first-class playlists", () => {
    const envelope = buildPlaylistExportEnvelope({
      likedSongs: [],
      localPlaylists: [localPlaylist("local-1", "本地歌单", [song("1", "local")], "https://img.test/cover.jpg")],
      currentPlaylist: null,
      currentPlaylistSongs: [],
      exportedAt: 123,
    });

    expect(envelope.playlists).toEqual([
      {
        name: "本地歌单",
        description: undefined,
        cover: "https://img.test/cover.jpg",
        songs: [song("1", "local")],
      },
    ]);
  });

  it("deduplicates imported songs by source and id", () => {
    const existing = [song("1", "wy"), song("1", "tx")];
    const imported = [song("1", "wy"), song("2", "wy"), song("1", "tx")];

    expect(mergeImportedSongs(existing, imported)).toEqual({
      songs: [song("1", "wy"), song("1", "tx"), song("2", "wy")],
      addedCount: 1,
    });
  });

  it("imports transfer playlists into local playlists and deduplicates with existing names", () => {
    const result = buildImportedLocalPlaylists(
      [localPlaylist("existing", "导入歌单", [song("1", "wy")])],
      {
        app: "auralflow",
        version: 1,
        exportedAt: 123,
        playlists: [
          { name: "导入歌单", songs: [song("1", "wy"), song("2", "wy")] },
          { name: "新歌单", description: "说明", cover: "https://img.test/new.jpg", songs: [song("3", "tx")] },
        ],
      },
      { now: 2000, idPrefix: "import" },
    );

    expect(result.addedSongCount).toBe(2);
    expect(result.localPlaylists.map((playlist) => ({
      id: playlist.id,
      name: playlist.name,
      description: playlist.description,
      cover: playlist.cover,
      songs: playlist.songs,
      createdAt: playlist.createdAt,
      updatedAt: playlist.updatedAt,
    }))).toEqual([
      {
        id: "existing",
        name: "导入歌单",
        description: undefined,
        cover: undefined,
        songs: [song("1", "wy"), song("2", "wy")],
        createdAt: 1000,
        updatedAt: 2000,
      },
      {
        id: "import-2000-1",
        name: "新歌单",
        description: "说明",
        cover: "https://img.test/new.jpg",
        songs: [song("3", "tx")],
        createdAt: 2000,
        updatedAt: 2000,
      },
    ]);
  });
});
