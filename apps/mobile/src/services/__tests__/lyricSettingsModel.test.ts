import { describe, expect, it } from "vitest";
import {
  buildImmersiveTranslationControl,
  buildLyricAnimationModel,
  buildLyricTypographyStyleModel,
  getLyricAnimationIntensityScale,
  normalizeLyricAnimationIntensity,
} from "@/services/lyricSettingsModel";

describe("lyric settings model", () => {
  it("builds the immersive lyrics translation control from the persisted setting", () => {
    expect(buildImmersiveTranslationControl(true)).toEqual({
      label: "译 开",
      active: true,
      nextShowTranslation: false,
    });

    expect(buildImmersiveTranslationControl(false)).toEqual({
      label: "译 关",
      active: false,
      nextShowTranslation: true,
    });
  });

  it("builds mobile lyric typography styles with alignment, weight and opacity", () => {
    const inactiveModel = buildLyricTypographyStyleModel({
      active: false,
      fontSize: 18,
      lineGap: 10,
      fontFamily: "LXGW WenKai",
      activeColor: "#45e58d",
      inactiveColor: "#8fa79f",
      textAlign: "left",
      fontWeight: 800,
      textOpacity: 0.7,
      palette: {
        primary: "#45e58d",
        text: "#ffffff",
        textMuted: "#8fa79f",
        textSubtle: "#5a6a67",
      },
    });

    expect(inactiveModel.lineWrapStyle).toEqual({ paddingBottom: 10 });
    expect(inactiveModel.lineTextStyle).toMatchObject({
      color: "#8fa79f",
      fontSize: 18,
      fontFamily: "LXGW WenKai",
      fontWeight: "500",
      opacity: 0.7,
      textAlign: "left",
    });
    expect(inactiveModel.translationStyle).toMatchObject({
      marginTop: 5,
      textAlign: "left",
    });

    const activeModel = buildLyricTypographyStyleModel({
      active: true,
      fontSize: 18,
      lineGap: 10,
      fontFamily: "LXGW WenKai",
      activeColor: "#45e58d",
      inactiveColor: "#8fa79f",
      textAlign: "right",
      fontWeight: 800,
      textOpacity: 0.7,
      palette: {
        primary: "#45e58d",
        text: "#ffffff",
        textMuted: "#8fa79f",
        textSubtle: "#5a6a67",
      },
    });

    expect(activeModel.lineTextStyle).toMatchObject({
      color: "#45e58d",
      fontWeight: "800",
      opacity: 1,
      textAlign: "right",
    });
  });

  it("normalizes mobile lyric animation settings and builds row transition parameters", () => {
    expect(normalizeLyricAnimationIntensity("reduced")).toBe("reduced");
    expect(normalizeLyricAnimationIntensity("enhanced")).toBe("enhanced");
    expect(normalizeLyricAnimationIntensity("unexpected")).toBe("normal");
    expect(getLyricAnimationIntensityScale("reduced")).toBe(0.55);
    expect(getLyricAnimationIntensityScale("normal")).toBe(1);
    expect(getLyricAnimationIntensityScale("enhanced")).toBe(1.25);

    expect(buildLyricAnimationModel({ enabled: true, intensity: "enhanced" })).toEqual({
      enabled: true,
      scrollAnimated: true,
      lineTransitionDurationMs: 225,
      activeScale: 1.05,
      inactiveScale: 1,
    });

    expect(buildLyricAnimationModel({ enabled: false, intensity: "enhanced" })).toEqual({
      enabled: false,
      scrollAnimated: false,
      lineTransitionDurationMs: 0,
      activeScale: 1,
      inactiveScale: 1,
    });
  });
});
