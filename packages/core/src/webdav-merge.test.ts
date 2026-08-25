import { describe, expect, it } from "vitest";
import type { MusicInfo } from "./sources/types";
import {
  mergeWebdavCloudPlaylists,
  mergeWebdavDataDesktop,
  mergeWebdavLocalPlaylists,
  mergeWebdavSongs,
} from "./webdav-merge";

function song(id: string, name = id): MusicInfo {
  return {
    id,
    name,
    singer: "artist",
    albumName: "album",
    source: "wy",
  };
}

describe("WebDAV shared merge rules", () => {
  it("keeps unique favorites from both sides in deterministic local-first order", () => {
    expect(mergeWebdavSongs([song("local"), song("shared", "local shared")], [
      song("shared", "remote shared"),
      song("remote"),
    ])).toEqual([
      song("local"),
      song("shared", "local shared"),
      song("remote"),
    ]);
  });

  it("uses the newer local-playlist metadata, keeps local metadata on ties, and unions songs", () => {
    const local = [
      {
        id: "shared",
        name: "local newer",
        cover: "local-cover",
        songs: [song("local-song")],
        createdAt: 1,
        updatedAt: 20,
      },
      {
        id: "tie",
        name: "local tie",
        songs: [],
        createdAt: 1,
        updatedAt: 30,
      },
      {
        id: "local-only",
        name: "local only",
        songs: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    const remote = [
      {
        id: "shared",
        name: "remote older",
        cover: "remote-cover",
        songs: [song("remote-song")],
        createdAt: 2,
        updatedAt: 10,
      },
      {
        id: "tie",
        name: "remote tie",
        songs: [song("tie-song")],
        createdAt: 2,
        updatedAt: 30,
      },
      {
        id: "remote-newer",
        name: "remote newer",
        cover: "remote-newer-cover",
        songs: [],
        createdAt: 2,
        updatedAt: 40,
      },
    ];

    expect(mergeWebdavLocalPlaylists(local, remote)).toEqual([
      {
        ...local[0],
        songs: [song("local-song"), song("remote-song")],
      },
      {
        ...local[1],
        songs: [song("tie-song")],
      },
      local[2],
      remote[2],
    ]);
  });

  it("uses newer cloud references while keeping local data for equal or unknown timestamps", () => {
    const local = [
      { id: "newer", name: "local older", updatedAt: 10 },
      { id: "tie", name: "local tie", updatedAt: 20 },
      { id: "unknown", name: "local unknown" },
      { id: "local-only", name: "local only", updatedAt: 1 },
    ];
    const remote = [
      { id: "newer", name: "remote newer", updatedAt: 30 },
      { id: "tie", name: "remote tie", updatedAt: 20 },
      { id: "unknown", name: "remote timestamped", updatedAt: 40 },
      { id: "remote-only", name: "remote only", updatedAt: 1 },
    ];

    expect(mergeWebdavCloudPlaylists(local, remote)).toEqual([
      remote[0],
      local[1],
      local[2],
      local[3],
      remote[3],
    ]);
  });

  it("preserves the selected desktop playlist cover", () => {
    const result = mergeWebdavDataDesktop(
      [],
      [{
        id: "playlist",
        name: "local",
        cover: "local-cover",
        songs: [],
        createdAt: 1,
        updatedAt: 10,
      }],
      [],
      [],
      [{
        id: "playlist",
        name: "remote",
        cover: "remote-cover",
        songs: [],
        createdAt: 2,
        updatedAt: 20,
      }],
      [],
    );

    expect(result.playlists[0]?.cover).toBe("remote-cover");
  });
});
