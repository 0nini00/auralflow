import { describe, expect, it } from "vitest";
import {
  DEFAULT_ACCENT_COLOR,
  buildThemePalette,
  migrateAccentColor,
  normalizeAccentColor,
  parseAccentColorInput,
} from "@/services/themePaletteModel";

describe("theme palette model", () => {
  it("normalizes custom accent colors", () => {
    expect(normalizeAccentColor(" #ABCDEF ")).toBe("#abcdef");
    expect(normalizeAccentColor("3366FF")).toBe("#3366ff");
    expect(normalizeAccentColor("#abc")).toBe(DEFAULT_ACCENT_COLOR);
    expect(normalizeAccentColor("not-a-color")).toBe(DEFAULT_ACCENT_COLOR);
  });

  it("migrates legacy desktop accent colors to the current default", () => {
    expect(migrateAccentColor("#1db954")).toBe(DEFAULT_ACCENT_COLOR);
    expect(migrateAccentColor("#d83b40")).toBe(DEFAULT_ACCENT_COLOR);
    expect(migrateAccentColor("#3366ff")).toBe("#3366ff");
  });

  it("parses custom accent input without falling back on invalid text", () => {
    expect(parseAccentColorInput(" #ABCDEF ")).toBe("#abcdef");
    expect(parseAccentColorInput("3366FF")).toBe("#3366ff");
    expect(parseAccentColorInput("#abc")).toBeNull();
    expect(parseAccentColorInput("not-a-color")).toBeNull();
  });

  it("builds light and dark palettes using the selected accent color", () => {
    const light = buildThemePalette("light", "#3366ff");
    const dark = buildThemePalette("dark", "#3366ff");

    expect(light.primary).toBe("#3366ff");
    expect(light.primaryText).toBe("#ffffff");
    expect(dark.primary).toBe("#3366ff");
    expect(dark.primaryText).toBe("#ffffff");
    expect(light.surface).not.toBe(dark.surface);
  });
});
