import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS_CATEGORY,
  SETTINGS_CATEGORIES,
  getSettingsCategory,
} from "@/navigation/settingsRouteModel";

describe("settings route model", () => {
  it("defines the eight approved categories in order", () => {
    expect(SETTINGS_CATEGORIES.map((item) => item.name)).toEqual([
      "Account",
      "Appearance",
      "Playback",
      "Sources",
      "Lyrics",
      "Sync",
      "Data",
      "About",
    ]);
    expect(DEFAULT_SETTINGS_CATEGORY).toBe("Account");
  });

  it("returns the matching category metadata", () => {
    expect(getSettingsCategory("Playback").label).toBe("播放与音效");
  });
});
