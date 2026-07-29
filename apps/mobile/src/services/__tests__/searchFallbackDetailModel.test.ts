import { describe, expect, it } from "vitest";
import type { MusicInfo } from "@lx/core";
import {
  buildAlbumFallbackDetail,
  buildArtistFallbackDetail,
} from "@/services/searchFallbackDetailModel";

function song(partial: Partial<MusicInfo> & Pick<MusicInfo, "id" | "name">): MusicInfo {
  return {
    singer: "Artist",
    albumName: "Album",
    source: "tx",
    ...partial,
  };
}

describe("search fallback detail model", () => {
  it("collects related songs for a non-netease artist from current search hits", () => {
    const songs = [
      song({ id: "1", name: "A", singer: "Jay", source: "tx" }),
      song({ id: "2", name: "B", singer: "Other", source: "tx" }),
      song({ id: "3", name: "C", singer: "Jay Chou", source: "wy" }),
    ];

    const model = buildArtistFallbackDetail(
      { id: "a1", name: "Jay", source: "tx" },
      songs,
    );

    expect(model.type).toBe("fallback");
    expect(model.songs.map((item) => item.id)).toEqual(["1"]);
    expect(model.subtitle).toContain("QQ音乐");
  });

  it("collects related songs for a non-netease album", () => {
    const songs = [
      song({ id: "1", name: "A", albumName: "Fantasy", singer: "Jay", source: "tx" }),
      song({ id: "2", name: "B", albumName: "Other", singer: "Jay", source: "tx" }),
    ];

    const model = buildAlbumFallbackDetail(
      { id: "al1", name: "Fantasy", artistName: "Jay", source: "tx" },
      songs,
    );

    expect(model.songs.map((item) => item.id)).toEqual(["1"]);
    expect(model.emptyHint).toBe("");
  });

  it("returns empty hint when no related songs are in current results", () => {
    const model = buildArtistFallbackDetail(
      { id: "a1", name: "Nobody", source: "tx" },
      [song({ id: "1", name: "A", singer: "Someone", source: "tx" })],
    );

    expect(model.songs).toEqual([]);
    expect(model.emptyHint.length).toBeGreaterThan(0);
  });
});
