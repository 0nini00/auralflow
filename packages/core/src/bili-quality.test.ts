import { describe, expect, it } from "vitest";

import {
  classifyBiliDashAudio,
  hasBiliLossless,
  pickBiliDashAudioByQuality,
} from "./bili-quality";

const mkAudio = (id: number, bandwidth = 0) => ({
  id,
  bandwidth,
  baseUrl: `https://up.example.com/audio_${id}.m4s`,
});

describe("classifyBiliDashAudio", () => {
  it("按官方 id 精确分类", () => {
    expect(classifyBiliDashAudio(mkAudio(30232))).toBe("128k");
    expect(classifyBiliDashAudio(mkAudio(30280))).toBe("192k");
    expect(classifyBiliDashAudio(mkAudio(30250))).toBe("320k");
    expect(classifyBiliDashAudio(mkAudio(30251))).toBe("flac24bit");
  });

  it("未知 id 归到最低档兜底,不因 bandwidth 猜档", () => {
    // 30216 旧 64k 档 → 兜底最低档
    expect(classifyBiliDashAudio(mkAudio(30216, 90000))).toBe("128k");
  });

  it("缺失 id 判为不可用(不因 bandwidth 猜档)", () => {
    expect(classifyBiliDashAudio({ bandwidth: 500000, baseUrl: "x" })).toBeNull();
    // pick 会跳过它,不会把无 id 高码率流当 320k
    const mixed = [mkAudio(30250), { bandwidth: 500000, baseUrl: "x" }];
    expect(pickBiliDashAudioByQuality(mixed, "320k")?.id).toBe(30250);
  });
});

describe("pickBiliDashAudioByQuality", () => {
  const list = [
    mkAudio(30232, 130_000), // 128k
    mkAudio(30280, 200_000), // 192k
    mkAudio(30250, 320_000), // 320k
    mkAudio(30251, 500_000), // Hi-Res
  ];

  it("精确匹配目标档", () => {
    expect(pickBiliDashAudioByQuality(list, "128k")?.id).toBe(30232);
    expect(pickBiliDashAudioByQuality(list, "192k")?.id).toBe(30280);
    expect(pickBiliDashAudioByQuality(list, "320k")?.id).toBe(30250);
    expect(pickBiliDashAudioByQuality(list, "flac24bit")?.id).toBe(30251);
  });

  it("flac 目标退回最高可用(Hi-Res 也算无损可用)", () => {
    expect(pickBiliDashAudioByQuality(list, "flac")?.id).toBe(30251);
  });

  it("目标档缺失时退到不高于目标的最高档", () => {
    const no320 = list.filter((a) => a.id !== 30250);
    // 要 320k 但只有 192k/128k → 给 192k
    expect(pickBiliDashAudioByQuality(no320, "320k")?.id).toBe(30280);
    // 要 192k 但只有 128k → 给 128k
    const only128 = [mkAudio(30232)];
    expect(pickBiliDashAudioByQuality(only128, "192k")?.id).toBe(30232);
    // 要 128k 但只有 192k → 退到不高于目标:没有,给 null(不越档给 192k)
    const noLow = list.filter((a) => a.id !== 30232);
    expect(pickBiliDashAudioByQuality(noLow, "128k")).toBeNull();
  });

  it("空列表/不可用返回 null", () => {
    expect(pickBiliDashAudioByQuality([], "320k")).toBeNull();
    expect(pickBiliDashAudioByQuality([{ id: 30250 }], "320k")).toBeNull(); // 无 URL
  });

  it("忽略 backupUrl 之外的字段差异(兼容 snake_case)", () => {
    const snake = [{ id: 30250, base_url: "https://up.example.com/s.m4s" }];
    expect(pickBiliDashAudioByQuality(snake, "320k")?.base_url).toBeDefined();
  });
});

describe("hasBiliLossless", () => {
  it("识别 flac 流与 30251", () => {
    expect(hasBiliLossless({ dash: { flac: { audio: mkAudio(999999) } } })).toBe(true);
    expect(hasBiliLossless({ dash: { audio: [mkAudio(30251)] } })).toBe(true);
    expect(hasBiliLossless({ dash: { audio: [mkAudio(30250)] } })).toBe(false);
    expect(hasBiliLossless({})).toBe(false);
  });
});
