import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MusicInfo } from "@lx/core";

const builtinClient = vi.hoisted(() => ({
  resolveUrl: vi.fn((_song: MusicInfo, quality?: string) => Promise.resolve({
    url: `https://audio.example.com/${quality ?? "missing"}.mp3`,
    quality: quality ?? "missing",
  })),
  searchSongs: vi.fn(),
  getLyric: vi.fn(),
}));

vi.mock("@lx/core", () => ({
  createBuiltinMusicApiClient: vi.fn(() => builtinClient),
  mergeTranslation: vi.fn((lines) => lines),
  parseLyricSource: vi.fn(() => []),
}));

vi.mock("@/services/biliService", () => ({
  resolveBiliSongUrl: vi.fn(),
  searchBiliVideos: vi.fn(),
}));

vi.mock("@/services/searchResultCache", () => ({
  getCachedResult: vi.fn(() => null),
  setCachedResult: vi.fn(),
}));

vi.mock("@/services/songMetadataMerge", () => ({
  mergeDuplicateSongs: vi.fn((songs) => songs),
}));

vi.mock("@/services/txPlaylistService", () => ({
  resolveTxSongUrl: vi.fn(),
  searchTxPlaylists: vi.fn(() => Promise.resolve([])),
}));

import { resolveTxSongUrl } from "@/services/txPlaylistService";
import { parseUrl } from "@/services/musicApi";

function song(id: string): MusicInfo {
  return {
    id,
    name: `song-${id}`,
    singer: "artist",
    albumName: "album",
    source: "wy",
  };
}

describe("music api playback quality", () => {
  beforeEach(() => {
    builtinClient.resolveUrl.mockReset();
    builtinClient.resolveUrl.mockImplementation((_song: MusicInfo, quality?: string) => Promise.resolve({
      url: `https://audio.example.com/${quality ?? "missing"}.mp3`,
      quality: quality ?? "missing",
    }));
    vi.mocked(resolveTxSongUrl).mockReset();
  });

  it("passes the requested playback quality to the builtin resolver", async () => {
    await parseUrl(song("1"), "flac");

    expect(builtinClient.resolveUrl).toHaveBeenCalledWith(song("1"), "flac");
  });

  it("tries merged song variants when the primary source cannot resolve a playback URL", async () => {
    const txVariant: MusicInfo = {
      ...song("tx-1"),
      source: "tx",
    };
    const mergedSong = {
      ...song("wy-1"),
      variants: [txVariant],
    } as MusicInfo & { variants: MusicInfo[] };
    builtinClient.resolveUrl.mockRejectedValueOnce(new Error("WY unavailable"));
    vi.mocked(resolveTxSongUrl).mockResolvedValueOnce("https://tx.example.com/song.m4a");

    await expect(parseUrl(mergedSong, "320k")).resolves.toBe("https://tx.example.com/song.m4a");

    expect(builtinClient.resolveUrl).toHaveBeenCalledWith(mergedSong, "320k");
    expect(resolveTxSongUrl).toHaveBeenCalledWith(txVariant);
  });
});
