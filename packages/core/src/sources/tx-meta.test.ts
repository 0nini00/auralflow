import { describe, expect, it } from "vitest";
import { extractTxTrackMeta } from "./tx-meta";

describe("extractTxTrackMeta", () => {
  it("extracts media_mid from the search response shape", () => {
    // 对齐 lx-music 的 tx musicSearch filterData：strMediaMid 来自 item.file.media_mid
    expect(
      extractTxTrackMeta({
        id: 123456,
        mid: "003OUlho2HcRHC",
        file: { media_mid: "003OUlho2HcRHC" },
        album: { mid: "000MkMni19ClKG" },
      }),
    ).toEqual({
      strMediaMid: "003OUlho2HcRHC",
      albumMid: "000MkMni19ClKG",
      songId: "123456",
    });
  });

  it("extracts from the playlist response shape (songinfo.file)", () => {
    expect(
      extractTxTrackMeta({
        songid: 987,
        songinfo: { file: { media_mid: "abc123" } },
        album: { pmid: "pm456" },
      }),
    ).toEqual({ strMediaMid: "abc123", albumMid: "pm456", songId: "987" });
  });

  it("accepts already-normalized field names", () => {
    expect(extractTxTrackMeta({ strMediaMid: "m1", albumMid: "a1", songId: "s1" })).toEqual({
      strMediaMid: "m1",
      albumMid: "a1",
      songId: "s1",
    });
  });

  it("coerces numeric songId to string so it never mixes with songmid", () => {
    const meta = extractTxTrackMeta({ id: 42, file: { media_mid: "m" } });
    expect(meta?.songId).toBe("42");
    expect(typeof meta?.songId).toBe("string");
  });

  it("omits absent fields instead of emitting empty strings", () => {
    expect(extractTxTrackMeta({ file: { media_mid: "only-media" } })).toEqual({
      strMediaMid: "only-media",
    });
  });

  it("returns undefined when nothing usable is present", () => {
    expect(extractTxTrackMeta({ name: "x" })).toBeUndefined();
    expect(extractTxTrackMeta(null)).toBeUndefined();
    expect(extractTxTrackMeta(undefined)).toBeUndefined();
  });
});
