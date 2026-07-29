import { describe, expect, it } from "vitest";
import type { MusicInfo } from "@lx/core";

import { buildSongListMetadata, shouldShowSongListDownloadAction } from "@/services/songListMetadataModel";

function song(overrides: Partial<MusicInfo> = {}): MusicInfo {
  return {
    id: "1",
    name: "Song",
    singer: "Artist",
    albumName: "Album",
    source: "local",
    interval: 185,
    ...overrides,
  };
}

describe("song list metadata model", () => {
  it("includes artist, album and duration for local music rows", () => {
    expect(buildSongListMetadata(song())).toEqual({
      artistName: "Artist",
      albumName: "Album",
      durationLabel: "3:05",
      metaParts: ["Artist", "Album", "3:05"],
    });
  });

  it("keeps metadata concise when album or duration is missing", () => {
    expect(buildSongListMetadata(song({ singer: "", albumName: "", interval: undefined }))).toEqual({
      artistName: "未知艺术家",
      albumName: "",
      durationLabel: "",
      metaParts: ["未知艺术家"],
    });
  });

  it("hides download action for local music rows", () => {
    expect(shouldShowSongListDownloadAction(song({ source: "local" }))).toBe(false);
    expect(shouldShowSongListDownloadAction(song({ source: "wy" }))).toBe(true);
    expect(shouldShowSongListDownloadAction(song({ source: "tx" }))).toBe(true);
    expect(shouldShowSongListDownloadAction(song({ source: "bili" }))).toBe(true);
  });
});
