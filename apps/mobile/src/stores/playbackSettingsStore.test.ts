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

import { DEFAULT_PLAYBACK_QUALITY } from "@/services/playbackQualityModel";
import {
  PLAYBACK_SETTINGS_KEY,
  usePlaybackSettingsStore,
} from "@/stores/playbackSettingsStore";

describe("playback settings store", () => {
  beforeEach(() => {
    storage.clear();
    storage.getItem.mockClear();
    storage.setItem.mockClear();
    usePlaybackSettingsStore.setState({
      defaultQuality: DEFAULT_PLAYBACK_QUALITY,
      pauseOnExternalPlayback: true,
      loaded: false,
    } as any);
  });

  it("loads persisted playback quality and external playback policy", async () => {
    storage.data.set(PLAYBACK_SETTINGS_KEY, JSON.stringify({
      defaultQuality: "flac",
      pauseOnExternalPlayback: false,
    }));

    await usePlaybackSettingsStore.getState().loadFromStorage();

    expect(usePlaybackSettingsStore.getState().defaultQuality).toBe("flac");
    expect(usePlaybackSettingsStore.getState().pauseOnExternalPlayback).toBe(false);
    expect(usePlaybackSettingsStore.getState().loaded).toBe(true);
  });

  it("defaults to pausing when external playback policy is missing", async () => {
    storage.data.set(PLAYBACK_SETTINGS_KEY, JSON.stringify({ defaultQuality: "flac" }));

    await usePlaybackSettingsStore.getState().loadFromStorage();

    expect(usePlaybackSettingsStore.getState().pauseOnExternalPlayback).toBe(true);
  });

  it("normalizes and persists default playback quality changes", async () => {
    await usePlaybackSettingsStore.getState().setDefaultQuality("hires");

    expect(usePlaybackSettingsStore.getState().defaultQuality).toBe("flac24bit");
    expect(storage.setItem).toHaveBeenCalledWith(
      PLAYBACK_SETTINGS_KEY,
      JSON.stringify({ defaultQuality: "flac24bit", pauseOnExternalPlayback: true }),
    );
  });

  it("persists external playback policy changes without changing quality", async () => {
    usePlaybackSettingsStore.setState({ defaultQuality: "flac" } as any);

    await usePlaybackSettingsStore.getState().setPauseOnExternalPlayback(false);

    expect(usePlaybackSettingsStore.getState().pauseOnExternalPlayback).toBe(false);
    expect(storage.setItem).toHaveBeenCalledWith(
      PLAYBACK_SETTINGS_KEY,
      JSON.stringify({ defaultQuality: "flac", pauseOnExternalPlayback: false }),
    );
  });
});
