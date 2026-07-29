import { describe, expect, it } from "vitest";

import { buildScreenTheme } from "@/services/screenThemeModel";
import { buildThemePalette } from "@/services/themePaletteModel";

describe("screen theme model", () => {
  it("derives common screen colors from the active palette", () => {
    const light = buildThemePalette("light", "#3366ff");
    const dark = buildThemePalette("dark", "#3366ff");

    expect(buildScreenTheme(light)).toMatchObject({
      titleText: light.text,
      bodyText: light.textMuted,
      cardBackground: light.surface,
      cardBorder: light.border,
      primaryBackground: light.primary,
      primaryText: light.primaryText,
    });
    expect(buildScreenTheme(dark)).toMatchObject({
      titleText: dark.text,
      bodyText: dark.textMuted,
      cardBackground: dark.surface,
      cardBorder: dark.border,
      primaryBackground: dark.primary,
      primaryText: dark.primaryText,
    });
  });

  it("derives a subtle primary surface for badges and selected states", () => {
    const light = buildThemePalette("light", "#3366ff");
    const dark = buildThemePalette("dark", "#3366ff");

    expect(buildScreenTheme(light).primarySubtleBackground).toBe("rgba(51, 102, 255, 0.12)");
    expect(buildScreenTheme(dark).primarySubtleBackground).toBe("rgba(51, 102, 255, 0.16)");
  });

  it("derives shared progress bar colors from the active palette", () => {
    const light = buildThemePalette("light", "#3366ff");

    expect(buildScreenTheme(light)).toMatchObject({
      progressTrackBackground: light.surfaceStrong,
      progressFillBackground: light.primary,
      progressThumbBackground: light.primary,
    });
  });
});
