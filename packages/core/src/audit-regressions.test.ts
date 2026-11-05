import { describe, expect, it } from "vitest";
import { assertPublicOutboundUrl, isBlockedOutboundHost } from "./outbound-host";
import { matchVariantCandidates } from "./song-variant";
import type { MusicInfo } from "./sources/types";

describe("出站策略与客户端 IDNA 归一化一致", () => {
  for (const host of ["ｌｏｃａｌｈｏｓｔ", "１２７.０.０.１", "ⓛⓞⓒⓐⓛⓗⓞⓢⓣ", "local\u00adhost", "ｎａｓ．ｌｏｃａｌ"]) {
    it(`拒绝规范化后指向本地的 ${host}`, () => {
      expect(isBlockedOutboundHost(host)).toBe(true);
      expect(() => assertPublicOutboundUrl(`http://${host}/`, "音源")).toThrow();
    });
  }
  it("保留合法国际化公网域名", () => {
    expect(() => assertPublicOutboundUrl("https://例子.中国/audio", "音源")).not.toThrow();
  });
});

it("先对全部匹配候选排序再截断", () => {
  const target: MusicInfo = { id: "target", source: "wy", name: "Song", singer: "Artist", albumName: "Album", interval: 200 };
  const candidates: MusicInfo[] = Array.from({ length: 12 }, (_, i) => ({ ...target, id: String(i), source: "tx", interval: 205 }));
  candidates.push({ ...target, id: "best", source: "tx" });
  const selected = matchVariantCandidates(target, candidates, "tx");
  expect(selected).toHaveLength(12);
  expect(selected[0].id).toBe("best");
});
