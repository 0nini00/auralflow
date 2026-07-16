import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MusicInfo } from "@lx/core";

const builtinClient = vi.hoisted(() => ({
  resolveUrl: vi.fn(),
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
  searchTxPlaylists: vi.fn(() => Promise.resolve([
    {
      id: "tx-playlist-1",
      name: "QQ 歌单",
      creatorName: "tx-user",
      source: "tx",
    },
  ])),
}));

function song(id: string, source: MusicInfo["source"]): MusicInfo {
  return {
    id,
    name: `${source}-song`,
    singer: "artist",
    albumName: "album",
    source,
  };
}

function jsonTextResponse(body: unknown): Response {
  return {
    ok: true,
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

describe("music api search", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    builtinClient.searchSongs.mockReset();
    builtinClient.searchSongs.mockImplementation(
      async (_apiSource: string, _keyword: string, _page: number, _limit: number, source: MusicInfo["source"]) => [
        song(`${source}-1`, source),
      ],
    );
    vi.stubGlobal("fetch", vi.fn((url: RequestInfo | URL) => {
      const text = String(url);
      if (text.includes("type=1000")) {
        return Promise.resolve(jsonTextResponse({
          result: {
            playlists: [
              {
                id: 1000,
                name: "网易云歌单",
                creator: { nickname: "wy-user" },
                trackCount: 12,
              },
            ],
          },
        }));
      }
      if (text.includes("type=100")) {
        return Promise.resolve(jsonTextResponse({
          result: {
            artists: [{ id: 100, name: "网易云歌手", musicSize: 20 }],
          },
        }));
      }
      if (text.includes("type=10")) {
        return Promise.resolve(jsonTextResponse({
          result: {
            albums: [{ id: 10, name: "网易云专辑", artist: { name: "网易云歌手" }, size: 8 }],
          },
        }));
      }
      return Promise.resolve(jsonTextResponse({ result: {} }));
    }));
  });

  it("aggregates WY and TX content for the combined search source", async () => {
    const { searchAll } = await import("@/services/musicApi");

    const result = await searchAll("all", "关键词");

    expect(result.songs.map((item) => item.source)).toEqual(["wy", "tx"]);
    expect(result.artists.map((item) => item.name)).toEqual(["网易云歌手"]);
    expect(result.albums.map((item) => item.name)).toEqual(["网易云专辑"]);
    expect(result.playlists.map((item) => item.source)).toEqual(["wy", "tx"]);
  });

  it("keeps song results constrained to the selected WY source", async () => {
    const { searchAll } = await import("@/services/musicApi");

    const result = await searchAll("wy", "关键词");

    expect(result.songs.map((item) => item.source)).toEqual(["wy"]);
  });

  it("keeps song results constrained to the selected TX source", async () => {
    const { searchAll } = await import("@/services/musicApi");

    const result = await searchAll("tx", "关键词");

    expect(result.songs.map((item) => item.source)).toEqual(["tx"]);
  });
});
