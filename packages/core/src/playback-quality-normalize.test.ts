import { describe, expect, it } from "vitest";
import {
  classifyPlaybackQuality,
  DEFAULT_PLAYBACK_QUALITY,
  getPlaybackQualityRank,
  normalizePlaybackQuality,
  normalizeSourceQualityLabel,
  PLAYBACK_QUALITY_LADDER,
  pickHighestQuality,
} from "./playback-quality";

describe("normalizePlaybackQuality 别名表", () => {
  it.each([
    ["128", "128k"],
    ["128k", "128k"],
    ["LOW", "128k"],
    ["standard", "128k"],
    ["192", "192k"],
    ["medium", "192k"],
    ["320", "320k"],
    ["320k", "320k"],
    ["HQ", "320k"],
    ["hq", "320k"],
    ["flac", "flac"],
    ["FLAC", "flac"],
    ["lossless", "flac"],
    ["SQ", "flac"],
    ["740", "flac"],
    ["hires", "flac24bit"],
    ["hi-res", "flac24bit"],
    ["flac24", "flac24bit"],
    ["24bit", "flac24bit"],
    ["999", "flac24bit"],
    ["  flac  ", "flac"],
  ])("%s → %s", (input, expected) => {
    expect(normalizePlaybackQuality(input)).toBe(expected);
    expect(classifyPlaybackQuality(input)).toEqual({ quality: expected, known: true });
  });

  it("未收录的大写/小写变体都能命中（大小写不敏感）", () => {
    expect(normalizePlaybackQuality("Hi-Res")).toBe("flac24bit");
    expect(normalizePlaybackQuality("LossLess")).toBe("flac");
  });
});

describe("classifyPlaybackQuality 对未知标签的区分", () => {
  it.each(["aac", "opus", "AAC 256", "unknown", "", "  ", "0", "-1", "3229"])(
    "%s 标记为未知并回落到默认档",
    (input) => {
      expect(classifyPlaybackQuality(input)).toEqual({
        quality: DEFAULT_PLAYBACK_QUALITY,
        known: false,
      });
    },
  );

  it.each([undefined, null, 128, {}, []])("非字符串输入 %s 标记为未知", (input) => {
    expect(classifyPlaybackQuality(input).known).toBe(false);
  });

  it("未知标签的 rank 等同于 320k —— 这正是需要 known 的原因", () => {
    // 静默回落会把未知标签当成 320k 参与「不低于门槛」裁决，
    // 调用方必须靠 known 才能发现「这个源其实没自报音质」。
    expect(getPlaybackQualityRank("aac")).toBe(getPlaybackQualityRank("320k"));
    expect(classifyPlaybackQuality("aac").known).toBe(false);
  });
});

describe("normalizeSourceQualityLabel: 未知标签退回请求档位而非 320k", () => {
  it("可识别标签直接采信，忽略请求档位", () => {
    expect(normalizeSourceQualityLabel("flac", "320k")).toBe("flac");
    expect(normalizeSourceQualityLabel("lossless", "128k")).toBe("flac");
    expect(normalizeSourceQualityLabel("128k", "flac")).toBe("128k");
  });

  it("未识别标签退回请求档位（不会再凭空变成 320k）", () => {
    expect(normalizeSourceQualityLabel("aac", "128k")).toBe("128k");
    expect(normalizeSourceQualityLabel("opus", "flac")).toBe("flac");
    expect(normalizeSourceQualityLabel(undefined, "192k")).toBe("192k");
    expect(normalizeSourceQualityLabel("", "flac24bit")).toBe("flac24bit");
  });

  it("证据：旧写法在同样输入下会把 128k 请求抬成 320k", () => {
    // 旧实现 normalizePlaybackQuality(result.quality || requested) 中，
    // 只要脚本回了 "aac"，就会被当成 320k，比请求的 128k 更高——
    // 于是一个只给 AAC 的源在「不低于 128k」的竞速里反而胜出。
    expect(normalizePlaybackQuality("aac")).toBe("320k");
    expect(getPlaybackQualityRank("aac")).toBeGreaterThan(getPlaybackQualityRank("128k"));
    // 新规则不会。
    expect(getPlaybackQualityRank(normalizeSourceQualityLabel("aac", "128k"))).toBe(
      getPlaybackQualityRank("128k"),
    );
  });
});

describe("别名扩充没有破坏阶梯序关系", () => {
  it("lossless 与 SQ 与 flac 同级，不会被误判成 320k", () => {
    const flacRank = getPlaybackQualityRank("flac");
    expect(getPlaybackQualityRank("lossless")).toBe(flacRank);
    expect(getPlaybackQualityRank("SQ")).toBe(flacRank);
    expect(flacRank).toBeGreaterThan(getPlaybackQualityRank("320k"));
  });

  it("HQ 与 320k 同级，不被抬成无损", () => {
    expect(getPlaybackQualityRank("HQ")).toBe(getPlaybackQualityRank("320k"));
  });

  it("每个阶梯档位都是自身的别名（表覆盖完整）", () => {
    for (const quality of PLAYBACK_QUALITY_LADDER) {
      expect(normalizePlaybackQuality(quality)).toBe(quality);
    }
  });

  it("pickHighestQuality 能识别 lossless 而非视作默认档", () => {
    const items = [
      { name: "a", quality: "320k" },
      { name: "b", quality: "lossless" },
      { name: "c", quality: "128k" },
    ];
    expect(pickHighestQuality(items, (item) => item.quality)?.name).toBe("b");
  });
});
