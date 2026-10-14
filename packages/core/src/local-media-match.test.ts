import { describe, expect, it } from "vitest";
import { durationDeltaSeconds, hasOriginalPerformerCandidate, selectLocalMediaMatch } from "./local-media-match";
import type { MusicInfo } from "./sources/types";

function song(overrides: Partial<MusicInfo> = {}): MusicInfo {
  return { id: "c1", name: "Bad Girl", singer: "夜航歌手", albumName: "夜航专辑", source: "wy", interval: 200, ...overrides };
}

const local = song({ id: "local-file", singer: "吴亦凡/Kris", albumName: "Bad Girl", interval: 201.56 });

describe("same-recording 档", () => {
  it("歌名、演唱者、时长都对得上时给出同一录音", () => {
    const result = selectLocalMediaMatch(local, [song({ singer: "吴亦凡/Kris", interval: 201 })]);

    expect(result.status).toBe("matched");
    expect(result.tier).toBe("same-recording");
    expect(result.candidates).toHaveLength(1);
    expect(result.issues).toEqual([]);
  });

  it("同名不同演唱者是硬否决，不是低分候选", () => {
    const result = selectLocalMediaMatch(local, [
      song({ id: "cover", singer: "翻唱者", interval: 201.5 }),
    ]);

    expect(result.status).toBe("not-found");
    expect(result.candidates).toEqual([]);
    expect(result.issues).toEqual(["match:no-compatible-candidate"]);
  });

  it("版本标记不一致不混为同一录音", () => {
    const live = song({ id: "live", singer: "吴亦凡/Kris", name: "Bad Girl (Live)", interval: 201 });
    const result = selectLocalMediaMatch(local, [live]);

    expect(result.status).toBe("not-found");
  });

  it("时长冲突超过 5s 直接出局", () => {
    const result = selectLocalMediaMatch(local, [song({ singer: "吴亦凡/Kris", interval: 260 })]);

    expect(result.status).toBe("not-found");
  });

  it("两个同演唱者但不同录音、领先不足时判歧义", () => {
    const result = selectLocalMediaMatch(local, [
      song({ id: "a", singer: "吴亦凡/Kris", albumName: "甲", interval: 204 }),
      song({ id: "b", singer: "吴亦凡/Kris", albumName: "乙", interval: 205 }),
    ]);

    expect(result.status).toBe("ambiguous");
    expect(result.issues).toEqual(["match:insufficient-lead"]);
  });
});

describe("other-performer 档的开关", () => {
  const cover = song({ id: "cover", singer: "小察", albumName: "翻唱辑", interval: 201.6 });

  it("默认关闭：不因为原唱缺席就拿别人的演唱版本顶上", () => {
    const result = selectLocalMediaMatch(local, [cover]);

    expect(result.status).toBe("not-found");
    expect(result.alternatives).toBeUndefined();
  });

  it("调用方确认原唱不可得后，时长几乎一致的翻唱可以被采用", () => {
    const result = selectLocalMediaMatch(local, [cover], { originalPerformerUnavailable: true });

    expect(result.status).toBe("matched");
    expect(result.tier).toBe("other-performer");
    expect(result.performer).toBe("小察");
    expect(result.corroboration).toBe("duration");
    expect(result.candidates).toEqual([cover]);
    expect(result.issues).toEqual(["match:other-performer-adopted"]);
  });

  it("召回里存在同一演唱者的候选时，即使调用方说不可得也不启用", () => {
    const original = song({ id: "original", singer: "吴亦凡/Kris", albumName: "别的专辑", interval: 260 });
    const result = selectLocalMediaMatch(local, [cover, original], { originalPerformerUnavailable: true });

    expect(result.status).not.toBe("matched");
    expect(result.tier).toBeUndefined();
  });
});

describe("other-performer 档的证据门槛", () => {
  it("时长差超过 3s 的候选不作为同曲异唱", () => {
    const cover = song({ id: "cover", singer: "小察", interval: 205.5 });
    const result = selectLocalMediaMatch(local, [cover], { originalPerformerUnavailable: true });

    expect(result.status).toBe("not-found");
    expect(result.alternatives).toBeUndefined();
  });

  it("缺时长的候选一律出局", () => {
    const cover = song({ id: "cover", singer: "小察", interval: undefined });
    const result = selectLocalMediaMatch(local, [cover], { originalPerformerUnavailable: true });

    expect(result.status).toBe("not-found");
  });

  it("只知道一边是谁在唱时不进这一档", () => {
    // 本地歌手未知时，「同专辑 + 时长接近」只是 tier-1 的弱证据（判歧义）；
    // 无法证明「换人了」就不能拿别人的演唱版本顶上。
    const unknownLocal = song({ id: "l", singer: "未知歌手", interval: 201 });
    const cover = song({ id: "cover", singer: "小察", albumName: "合辑甲", interval: 201.5 });
    const result = selectLocalMediaMatch(unknownLocal, [cover], { originalPerformerUnavailable: true });

    expect(result.status).toBe("ambiguous");
    expect(result.tier).toBeUndefined();
    expect(result.alternatives).toBeUndefined();
  });

  it("时长差 2.5s 只有单源时只作为候选暴露，不自动采信", () => {
    const cover = song({ id: "cover", singer: "小察", interval: 204 });
    const result = selectLocalMediaMatch(local, [cover], { originalPerformerUnavailable: true });

    expect(result.status).toBe("not-found");
    expect(result.alternatives?.map(item => [item.performer, item.corroboration])).toEqual([["小察", "none"]]);
  });

  it("另一个平台有同名同版本且时长互证的候选时升级为 cross-source", () => {
    const wyCover = song({ id: "wy-cover", singer: "小察", interval: 204 });
    const txCover = song({ id: "tx-cover", singer: "另一个人", source: "tx", interval: 203.5 });
    const result = selectLocalMediaMatch(local, [wyCover, txCover], { originalPerformerUnavailable: true });

    expect(result.status).toBe("matched");
    expect(result.tier).toBe("other-performer");
    expect(result.corroboration).toBe("cross-source");
    // 两条候选都是 cross-source（彼此互证），谁更像原唱由时长说话：tx 那条（1.94s）比 wy 那条（2.44s）更近。
    expect(result.candidates).toEqual([txCover]);
    expect(result.alternatives?.map(item => item.song)).toEqual([txCover, wyCover]);
    expect(result.alternatives).toHaveLength(2);
  });

  it("同一录音档仍优先于异唱档", () => {
    const original = song({ id: "original", singer: "吴亦凡/Kris", albumName: "Bad Girl", interval: 201 });
    const cover = song({ id: "cover", singer: "小察", interval: 201.2 });
    const result = selectLocalMediaMatch(local, [original, cover], { originalPerformerUnavailable: true });

    expect(result.tier).toBe("same-recording");
    expect(result.candidates).toEqual([original]);
  });
});

describe("辅助判定", () => {
  it("hasOriginalPerformerCandidate 只看演唱者身份，不看其他字段", () => {
    expect(hasOriginalPerformerCandidate(local, [song({ singer: "吴亦凡" })])).toBe(true);
    expect(hasOriginalPerformerCandidate(local, [song({ singer: "小察" })])).toBe(false);
    expect(hasOriginalPerformerCandidate(song({ id: "x", singer: "未知歌手" }), [song({ singer: "小察" })])).toBe(false);
  });

  it("durationDeltaSeconds 在缺时长时返回 null", () => {
    expect(durationDeltaSeconds(song({ name: "a", interval: 200 }), song({ name: "b", interval: 205.5 }))).toBeCloseTo(5.5);
    expect(durationDeltaSeconds(song({ name: "a", interval: 200 }), song({ name: "b", interval: undefined }))).toBeNull();
  });
});
