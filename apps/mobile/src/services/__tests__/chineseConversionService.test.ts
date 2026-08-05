import { describe, expect, it } from "vitest";
import {
  buildImmersiveChineseConversionControl,
  convertChineseText,
  getChineseConversionLabel,
  getNextChineseConversionMode,
} from "@/services/chineseConversionService";

describe("chineseConversionService", () => {
  it("returns identity when mode is off", () => {
    expect(convertChineseText("简体测试", "off")).toBe("简体测试");
  });

  it("returns empty string as-is regardless of mode", () => {
    expect(convertChineseText("", "s2t")).toBe("");
    expect(convertChineseText("", "t2s")).toBe("");
  });

  it("skips pure ASCII text without invoking converter", () => {
    // 纯英文歌词场景（常见），快速路径直接返回
    expect(convertChineseText("Hello World 123", "s2t")).toBe("Hello World 123");
  });

  it("converts simplified to traditional (s2t)", () => {
    // 「简体测试」→「簡體測試」；「记忆」→「記憶」
    expect(convertChineseText("简体测试", "s2t")).toBe("簡體測試");
    expect(convertChineseText("记忆", "s2t")).toBe("記憶");
  });

  it("converts traditional to simplified (t2s)", () => {
    expect(convertChineseText("簡體測試", "t2s")).toBe("简体测试");
    expect(convertChineseText("記憶", "t2s")).toBe("记忆");
  });

  it("cycles conversion mode: off → s2t → t2s → off", () => {
    expect(getNextChineseConversionMode("off")).toBe("s2t");
    expect(getNextChineseConversionMode("s2t")).toBe("t2s");
    expect(getNextChineseConversionMode("t2s")).toBe("off");
  });

  it("provides distinct labels for each mode", () => {
    expect(getChineseConversionLabel("off")).toBe("繁 关");
    expect(getChineseConversionLabel("s2t")).toBe("简→繁");
    expect(getChineseConversionLabel("t2s")).toBe("繁→简");
  });

  it("builds immersive control model with active flag and next mode", () => {
    expect(buildImmersiveChineseConversionControl("off")).toEqual({
      label: "繁 关",
      active: false,
      nextMode: "s2t",
    });
    expect(buildImmersiveChineseConversionControl("s2t")).toEqual({
      label: "简→繁",
      active: true,
      nextMode: "t2s",
    });
    expect(buildImmersiveChineseConversionControl("t2s")).toEqual({
      label: "繁→简",
      active: true,
      nextMode: "off",
    });
  });
});
