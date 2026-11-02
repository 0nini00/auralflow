import { describe, expect, it } from "vitest";
import {
  buildSongKey,
  buildSongGroupKey,
  buildVariantSearchKeyword,
  getSongVariants,
  groupHasSource,
  groupSongResults,
  isSameSong,
  matchVariantCandidates,
  normalizeSongName,
  orderPlaybackCandidates,
  pickSameSongCandidate,
  rankVariantCandidates,
  SONG_MATCH_INTERVAL_TOLERANCE,
  withSongVariants,
} from "./song-variant";
import type { MusicInfo } from "./sources/types";

function song(overrides: Partial<MusicInfo> = {}): MusicInfo {
  return {
    id: "wy1",
    name: "夜航",
    singer: "歌手甲",
    albumName: "专辑",
    source: "wy",
    interval: 200,
    ...overrides,
  };
}

describe("normalizeSongName", () => {
  it("去除各类括号及内容、统一 NFKC 与小写", () => {
    expect(normalizeSongName("夜航（Live）")).toBe("夜航");
    expect(normalizeSongName("夜航(remastered)")).toBe("夜航");
    expect(normalizeSongName("夜航【特别版】")).toBe("夜航");
    expect(normalizeSongName("夜航「现场」")).toBe("夜航");
    expect(normalizeSongName("Ｂad Girl")).toBe("badgirl");
  });
});

describe("isSameSong", () => {
  it("歌名规整相等 + 歌手重合 + 时长差在容差内判同一首", () => {
    expect(isSameSong(song(), song({ id: "tx1", source: "tx", interval: 203 }))).toBe(true);
  });

  it("时长差恰好等于容差通过，超出则否决", () => {
    expect(
      isSameSong(song(), song({ id: "tx1", source: "tx", interval: 200 + SONG_MATCH_INTERVAL_TOLERANCE })),
    ).toBe(true);
    expect(
      isSameSong(song(), song({ id: "tx1", source: "tx", interval: 200 + SONG_MATCH_INTERVAL_TOLERANCE + 1 })),
    ).toBe(false);
  });

  it("Live/重录版因时长差异被否决", () => {
    expect(isSameSong(song(), song({ id: "tx1", source: "tx", name: "夜航 (Live)", interval: 260 }))).toBe(false);
  });

  it("歌手完全不重合否决，部分重合通过", () => {
    expect(isSameSong(song({ singer: "歌手甲" }), song({ id: "tx1", source: "tx", singer: "歌手乙" }))).toBe(false);
    expect(isSameSong(song({ singer: "歌手甲、歌手乙" }), song({ id: "tx1", source: "tx", singer: "歌手乙" }))).toBe(
      true,
    );
  });

  it("一方缺时长时退化为歌名 + 歌手两重校验", () => {
    expect(isSameSong(song({ interval: undefined }), song({ id: "tx1", source: "tx", interval: 999 }))).toBe(true);
  });
});

describe("pickSameSongCandidate", () => {
  const cloud = song({ id: "2117337923", name: "雨下一整晚", singer: "周杰伦", interval: 256 });

  it("翻唱排在最前面时也能跳过，命中官方曲", () => {
    // 实测：未登录 cloudsearch 搜「雨下一整晚 周杰伦」，前几条全是翻唱。
    const candidates = [
      song({ id: "901", name: "雨下一整晚", singer: "叶湘伦", interval: 256 }),
      song({ id: "902", name: "雨下一整晚", singer: "思琪", interval: 254 }),
      song({ id: "2160518331", name: "雨下一整晚", singer: "周杰伦", interval: 255 }),
    ];
    expect(pickSameSongCandidate(cloud, candidates)?.id).toBe("2160518331");
  });

  it("同名不同曲（歌手不重合 / 时长差超容差）一律不选", () => {
    expect(pickSameSongCandidate(cloud, [song({ id: "903", name: "雨下一整晚", singer: "别人" })])).toBeNull();
    expect(
      pickSameSongCandidate(cloud, [
        song({ id: "904", name: "雨下一整晚", singer: "周杰伦", interval: 256 + SONG_MATCH_INTERVAL_TOLERANCE + 1 }),
      ]),
    ).toBeNull();
  });

  it("跳过自身与其它来源的候选", () => {
    expect(pickSameSongCandidate(cloud, [cloud])).toBeNull();
    expect(
      pickSameSongCandidate(cloud, [song({ id: "904", source: "tx", name: "雨下一整晚", singer: "周杰伦", interval: 256 })]),
    ).toBeNull();
  });

  it("歌名只有标点/括号时不作匹配", () => {
    expect(pickSameSongCandidate(song({ name: "（伴奏）" }), [song({ id: "905" })])).toBeNull();
  });
});

describe("rankVariantCandidates", () => {
  it("时长差小者优先，其次精确歌名，最后保持原搜索顺序", () => {
    const source = song({ interval: 200 });
    const far = song({ id: "tx-far", source: "tx", interval: 204, name: "夜航" });
    const near = song({ id: "tx-near", source: "tx", interval: 201, name: "夜航" });
    const ranked = rankVariantCandidates(source, [far, near]);
    expect(ranked.map((entry) => entry.song.id)).toEqual(["tx-near", "tx-far"]);
  });

  it("时长差并列时精确歌名优先", () => {
    const source = song({ interval: 200 });
    const decorated = song({ id: "tx-a", source: "tx", name: "夜航 特别版", interval: 201 });
    const exact = song({ id: "tx-b", source: "tx", name: "夜航", interval: 201 });
    const ranked = rankVariantCandidates(source, [decorated, exact]);
    expect(ranked[0].song.id).toBe("tx-b");
    expect(ranked[1].exactName).toBe(false);
  });
});

describe("groupSongResults", () => {
  it("跨源同名歌曲合并为一组，primary 取 sourceRank 最优", () => {
    const wy = song();
    const tx = song({ id: "tx1", source: "tx", interval: 202, picUrl: undefined });
    const groups = groupSongResults([tx, wy]);
    expect(groups).toHaveLength(1);
    expect(groups[0].primary.source).toBe("wy");
    expect(groups[0].variants.map((item) => item.source)).toEqual(["wy", "tx"]);
  });

  it("同一来源重复条目只保留第一条，不同歌曲各自成组", () => {
    const wy = song();
    const wyDup = song({ id: "wy1" });
    const other = song({ id: "wy2", name: "别的歌" });
    const groups = groupSongResults([wy, wyDup, other]);
    expect(groups).toHaveLength(2);
    expect(groups[0].variants).toHaveLength(1);
    expect(groups[0].key).toBe(buildSongGroupKey(wy));
  });
});

describe("buildVariantSearchKeyword", () => {
  it("拼歌名与首位歌手，多歌手只取第一位", () => {
    expect(buildVariantSearchKeyword(song({ singer: "歌手甲、歌手乙" }))).toBe("夜航 歌手甲");
  });

  it("无歌手时只返回歌名", () => {
    expect(buildVariantSearchKeyword(song({ singer: "" }))).toBe("夜航");
  });
});

describe("matchVariantCandidates", () => {
  it("过滤非目标来源与非同名曲，结果按时长差排序", () => {
    const source = song({ interval: 200 });
    const txNear = song({ id: "tx-near", source: "tx", interval: 201 });
    const txFar = song({ id: "tx-far", source: "tx", interval: 204 });
    const wyOther = song({ id: "wy-other" });
    const cover = song({ id: "tx-cover", source: "tx", singer: "翻唱歌手" });
    const matched = matchVariantCandidates(source, [txFar, wyOther, cover, txNear], "tx");
    expect(matched.map((item) => item.id)).toEqual(["tx-near", "tx-far"]);
  });

  it("超出上限的候选被截断", () => {
    const source = song({ interval: 200 });
    const candidates = Array.from({ length: 15 }, (_, index) =>
      song({ id: `tx-${index}`, source: "tx", interval: 200 + (index % 3) }),
    );
    expect(matchVariantCandidates(source, candidates, "tx", 12)).toHaveLength(12);
  });
});

describe("orderPlaybackCandidates", () => {
  it("pin 命中时置顶，主条目紧随其后，按身份键去重", () => {
    const wy = song();
    const tx = song({ id: "tx1", source: "tx", interval: 202 });
    const withVariants = withSongVariants(wy, [wy, tx]);
    const ordered = orderPlaybackCandidates(withVariants, buildSongKey(tx));
    expect(ordered.map((item) => buildSongKey(item))).toEqual(["tx:tx1", "wy:wy1"]);
  });

  it("无 pin 或 pin 未命中时主条目在前、变体保持原顺序", () => {
    const wy = song();
    const tx = song({ id: "tx1", source: "tx", interval: 202 });
    const withVariants = withSongVariants(wy, [wy, tx]);
    expect(orderPlaybackCandidates(withVariants).map((item) => item.id)).toEqual(["wy1", "tx1"]);
    expect(orderPlaybackCandidates(withVariants, "tx:missing").map((item) => item.id)).toEqual(["wy1", "tx1"]);
  });
});

describe("getSongVariants / withSongVariants", () => {
  it("未携带变体时返回空数组；空变体附加时原样返回", () => {
    const wy = song();
    expect(getSongVariants(wy)).toEqual([]);
    expect(withSongVariants(wy, [])).toBe(wy);
    expect(withSongVariants(wy, [wy]).variants).toHaveLength(1);
  });
});

describe("groupHasSource", () => {
  it("主条目来源命中；变体来源也命中；都不含时不命中", () => {
    const wy = song();
    const tx = song({ id: "tx1", source: "tx", interval: 202 });
    const [group] = groupSongResults([wy, tx]);
    expect(groupHasSource(group, "wy")).toBe(true);
    expect(groupHasSource(group, "tx")).toBe(true);
    expect(groupHasSource(group, "local")).toBe(false);
  });

  it("无变体时只看主条目来源", () => {
    const wy = song();
    const [group] = groupSongResults([wy]);
    expect(groupHasSource(group, "wy")).toBe(true);
    expect(groupHasSource(group, "tx")).toBe(false);
  });
});
