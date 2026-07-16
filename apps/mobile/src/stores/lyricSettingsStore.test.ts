import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: vi.fn((key: string) => Promise.resolve(data.get(key) ?? null)),
    setItem: vi.fn((key: string, value: string) => {
      data.set(key, value);
      return Promise.resolve();
    }),
    clear: () => data.clear(),
  };
});

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: storage,
}));

import {
  DEFAULT_LYRIC_SETTINGS,
  useLyricSettingsStore,
} from "@/stores/lyricSettingsStore";

const STORAGE_KEY = "auralflow-lyric-settings";

describe("lyric settings store", () => {
  beforeEach(() => {
    storage.clear();
    storage.getItem.mockClear();
    storage.setItem.mockClear();
    useLyricSettingsStore.setState({ ...DEFAULT_LYRIC_SETTINGS } as any);
  });

  it("resets every lyric style setting to the mobile defaults", async () => {
    useLyricSettingsStore.setState({
      fontSize: 24,
      showTranslation: false,
      activeColor: "#ff9f43",
      inactiveColor: "#ffffff",
      lineGap: 18,
      fontFamily: "LXGW WenKai",
      enableAnimation: false,
      animationIntensity: "enhanced",
    } as any);

    await useLyricSettingsStore.getState().resetSettings();

    expect(useLyricSettingsStore.getState()).toMatchObject(DEFAULT_LYRIC_SETTINGS);
    expect(storage.setItem).toHaveBeenCalledWith(
      STORAGE_KEY,
      JSON.stringify({ state: DEFAULT_LYRIC_SETTINGS, version: 0 }),
    );
  });

  it("persists lyric animation settings alongside typography settings", async () => {
    await useLyricSettingsStore.getState().setEnableAnimation(false);
    await useLyricSettingsStore.getState().setAnimationIntensity("reduced");

    expect(useLyricSettingsStore.getState()).toMatchObject({
      enableAnimation: false,
      animationIntensity: "reduced",
    });
    expect(storage.setItem).toHaveBeenLastCalledWith(
      STORAGE_KEY,
      JSON.stringify({
        state: {
          ...DEFAULT_LYRIC_SETTINGS,
          enableAnimation: false,
          animationIntensity: "reduced",
        },
        version: 0,
      }),
    );
  });
});
