import { describe, expect, it } from "vitest";

import { parseMobileDeepLink } from "@/services/mobileDeepLinkService";

describe("mobile deep link service", () => {
  it("parses search deep links with decoded keywords", () => {
    expect(parseMobileDeepLink("auralflow://search/%E5%91%A8%E6%9D%B0%E4%BC%A6")).toEqual({
      type: "search",
      keyword: "周杰伦",
    });
  });

  it("parses discovery deep links", () => {
    expect(parseMobileDeepLink("auralflow://daily")).toEqual({ type: "homeMode", mode: "daily" });
    expect(parseMobileDeepLink("auralflow://fm")).toEqual({ type: "homeMode", mode: "fm" });
  });

  it("parses desktop-compatible search detail deep links as Netease routes", () => {
    expect(parseMobileDeepLink("auralflow://playlist/123")).toEqual({
      type: "searchDetail",
      route: {
        type: "playlist",
        playlist: {
          id: "123",
          name: "网易云歌单",
          author: "未知创建者",
          trackCount: 0,
          source: "wy",
        },
      },
    });
    expect(parseMobileDeepLink("auralflow://album/456")).toEqual({
      type: "searchDetail",
      route: {
        type: "album",
        album: {
          id: "456",
          name: "网易云专辑",
          artistName: "未知歌手",
          source: "wy",
        },
        parentArtist: null,
      },
    });
    expect(parseMobileDeepLink("auralflow://artist/789")).toEqual({
      type: "searchDetail",
      route: {
        type: "artist",
        artist: {
          id: "789",
          name: "网易云歌手",
          source: "wy",
        },
        parentAlbum: null,
      },
    });
  });

  it("ignores unsupported or malformed urls", () => {
    expect(parseMobileDeepLink("https://example.com/search/test")).toBeNull();
    expect(parseMobileDeepLink("auralflow://song/123")).toBeNull();
    expect(parseMobileDeepLink("not a url")).toBeNull();
  });
});
