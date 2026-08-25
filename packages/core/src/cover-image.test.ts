import { describe, expect, it } from "vitest";
import { COVER_SIZE_THUMB, resizeCoverUrl } from "./cover-image";

describe("resizeCoverUrl", () => {
  it("appends param for netease image hosts", () => {
    expect(resizeCoverUrl("https://p1.music.126.net/abc/109951165936741.jpg", 200)).toBe(
      "https://p1.music.126.net/abc/109951165936741.jpg?param=200y200",
    );
    expect(resizeCoverUrl("https://p4.music.126.net/x/y.jpg", COVER_SIZE_THUMB)).toContain(
      "param=200y200",
    );
  });

  it("keeps an explicit param untouched", () => {
    const url = "https://p1.music.126.net/abc/1.jpg?param=640y640";
    expect(resizeCoverUrl(url, 200)).toBe(url);
  });

  it("appends bilibili size suffix", () => {
    expect(resizeCoverUrl("https://i0.hdslb.com/bfs/archive/abc.jpg", 200)).toBe(
      "https://i0.hdslb.com/bfs/archive/abc.jpg@200w_200h.webp",
    );
  });

  it("keeps bilibili urls that already carry options", () => {
    const url = "https://i0.hdslb.com/bfs/archive/abc.jpg@320w_320h.webp";
    expect(resizeCoverUrl(url, 200)).toBe(url);
  });

  it("leaves unknown hosts and non-http urls untouched", () => {
    const cases = [
      "https://y.gtimg.cn/music/photo_new/T002R300x300M000abc.jpg",
      "file:///data/user/0/cover.jpg",
      "data:image/png;base64,AAAA",
      "",
    ];
    for (const value of cases) {
      expect(resizeCoverUrl(value, 200)).toBe(value);
    }
  });

  it("returns input unchanged for invalid size", () => {
    const url = "https://p1.music.126.net/abc/1.jpg";
    expect(resizeCoverUrl(url, 0)).toBe(url);
  });

  it("handles null and undefined", () => {
    expect(resizeCoverUrl(null, 200)).toBe("");
    expect(resizeCoverUrl(undefined, 200)).toBe("");
  });
});

describe("resizeCoverUrl url parts", () => {
  it("keeps existing query and hash", () => {
    expect(resizeCoverUrl("https://p1.music.126.net/a/b.jpg?v=2", 200)).toBe(
      "https://p1.music.126.net/a/b.jpg?v=2&param=200y200",
    );
    expect(resizeCoverUrl("https://p1.music.126.net/a/b.jpg#frag", 200)).toBe(
      "https://p1.music.126.net/a/b.jpg?param=200y200#frag",
    );
    expect(resizeCoverUrl("https://i0.hdslb.com/bfs/a.jpg?x=1", 200)).toBe(
      "https://i0.hdslb.com/bfs/a.jpg@200w_200h.webp?x=1",
    );
  });
});
