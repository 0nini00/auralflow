import { describe, expect, it } from "vitest";
import type { MusicInfo } from "@lx/core";
import { buildMobilePlayRequestKey } from "./playerRequestModel";

function song(overrides: Partial<MusicInfo> = {}): MusicInfo {
  return {
    id: "1",
    name: "song",
    singer: "singer",
    albumName: "album",
    source: "wy",
    ...overrides,
  };
}

describe("playerRequestModel", () => {
  it("uses source, id, local URL and quality as request identity", () => {
    expect(buildMobilePlayRequestKey(song())).toBe("wy:1::");
    expect(buildMobilePlayRequestKey(song({ quality: "320k" }))).toBe("wy:1::320k");
    expect(buildMobilePlayRequestKey(song({ isLocal: true, url: "file:///music.mp3" })))
      .toBe("wy:1:file:///music.mp3:");
  });

  it("ignores remote transient URLs for the same logical request", () => {
    expect(buildMobilePlayRequestKey(song({ url: "https://a.example/song" })))
      .toBe(buildMobilePlayRequestKey(song({ url: "https://b.example/song" })));
  });
});
