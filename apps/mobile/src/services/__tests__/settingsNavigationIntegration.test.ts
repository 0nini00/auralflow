import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => {
  const absolutePath = resolve(process.cwd(), path);
  return existsSync(absolutePath) ? readFileSync(absolutePath, "utf8") : "";
};

describe("settings navigation integration", () => {
  it("uses a phone front drawer and tablet permanent drawer", () => {
    const navigator = read("src/navigation/SettingsNavigator.tsx");

    expect(navigator).toContain("width >= breakpoints.tablet");
    expect(navigator).toContain('drawerType: isTablet ? "permanent" : "front"');
    expect(navigator).toContain("swipeEnabled: false");
  });

  it("mounts settings navigation from the main drawer", () => {
    const drawer = read("src/navigation/MainDrawerNavigator.tsx");

    expect(drawer).toContain("SettingsNavigator");
    expect(drawer).not.toContain("<SettingsScreen");
  });

  it("renders one route-backed category at a time", () => {
    const navigator = read("src/navigation/SettingsNavigator.tsx");
    const account = read("src/screens/settings/AccountSettingsScreen.tsx");
    const playback = read("src/screens/settings/PlaybackSettingsScreen.tsx");

    expect(navigator).toContain('name="Account"');
    expect(navigator).toContain('name="About"');
    expect(account).toContain("<SettingsPage");
    expect(playback).toContain("<SoundEffectPanel");
  });

  it("uses stack routes for settings details", () => {
    const navigator = read("src/navigation/SettingsNavigator.tsx");

    expect(navigator).toContain('name="Login"');
    expect(navigator).toContain('name="WebDav"');
    expect(navigator).toContain('name="CustomSources"');
    expect(navigator).toContain('name="LyricDetail"');
    expect(navigator).not.toContain("showLoginModal");
    expect(navigator).not.toContain("showLyricSettings");
  });

  it("uses desktop-aligned settings card density", () => {
    const theme = read("src/components/ThemeModeCard.tsx");
    const sound = read("src/components/SoundEffectPanel.tsx");

    for (const source of [theme, sound]) {
      expect(source).toContain("borderRadius: radius.md");
      expect(source).toContain("borderWidth: StyleSheet.hairlineWidth");
      expect(source).toContain("padding: spacing.s");
      expect(source).not.toContain("borderStyle: \"dashed\"");
    }
  });

  it("keeps main and settings drawer actions targeted separately", () => {
    const shell = read("src/components/AppShell.tsx");

    expect(shell).toContain("function findMainDrawerKey");
    expect(shell).toContain("target: mainDrawerKey");
  });
});
