// @vitest-environment jsdom
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  });
});
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@lx/tauri-bridge", () => ({
  loadSettings: vi.fn(async () => ({})),
  patchSettings: vi.fn(async () => ({})),
  getMediaCacheStats: vi.fn(async () => ({})),
  clearMediaCache: vi.fn(),
  libraryReset: vi.fn(),
}));
vi.mock("@/stores/historyStore", () => ({ useHistoryStore: { getState: vi.fn() } }));
vi.mock("@/components/ui/ConfirmDialog", () => ({ confirmAction: vi.fn() }));
vi.mock("@/stores/customSourceStore", () => ({ useCustomSourceStore: () => ({ sources: [] }) }));
vi.mock("@/stores/lyricSettingsSync", () => ({ broadcastLyricSettings: vi.fn() }));
vi.mock("@/services/playerEngine", () => ({ playerEngine: { setPauseOnExternalPlayback: vi.fn() } }));
vi.mock("@/services/persistentCache", () => ({
  getPersistentCacheSummary: vi.fn(async () => ({})),
  clearCachedLyrics: vi.fn(),
  clearCachedPlaybackUrls: vi.fn(),
  invalidateCachedLocalMedia: vi.fn(),
}));
vi.mock("@/services/lyricsService", () => ({ clearLyricsMemoryCache: vi.fn() }));
vi.mock("@/stores/playerStore", () => ({ setPlaybackFailedAutoNext: vi.fn() }));
vi.mock("@/services/playback/prefetchService", () => ({ clearPlaybackPrefetchCache: vi.fn() }));
vi.mock("@/services/appBackground", () => ({ notifyAppBackgroundChanged: vi.fn(), toAppBackgroundImageUrl: () => "" }));

import { APPEARANCE_DEFAULTS, IMMERSIVE_BACKGROUND_OPTIONS, useThemeStore } from "../src/stores/themeStore";
import { useSettingsViewModel } from "../src/views/useSettingsViewModel";
import { AppearanceSettingsSection } from "../src/views/settings/AppearanceSettingsSection";

let renderer: ReactTestRenderer | undefined;
beforeEach(() => {
  localStorage.clear();
  useThemeStore.getState().resetAppearance();
});
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  localStorage.clear();
});

async function mountSettings() {
  function Harness() {
    return <AppearanceSettingsSection model={useSettingsViewModel()} />;
  }
  await act(async () => { renderer = create(<Harness />); });
}

function backgroundSelect() {
  return renderer!.root.findByProps({ "aria-label": "沉浸式播放背景" });
}

function resetAllButton() {
  return renderer!.root.findAllByType("button")
    .find(button => button.children.includes("全部恢复默认"))!;
}

describe("沉浸式播放背景设置", () => {
  it("选项只有封面、液态渐变和极光光幕，新增设置不改已有默认值", () => {
    expect(IMMERSIVE_BACKGROUND_OPTIONS).toEqual([
      { value: "cover", label: "封面背景" },
      { value: "liquid", label: "液态渐变" },
      { value: "aurora", label: "极光光幕" },
    ]);
    const { immersiveBackground, ...existingDefaults } = APPEARANCE_DEFAULTS;
    expect(immersiveBackground).toBe("cover");
    expect(existingDefaults).toEqual({
      theme: "dark",
      accentColor: "#17a34a",
      artworkAmbienceEnabled: true,
      artworkAmbienceIntensity: 100,
      artworkAmbienceScope: "player-immersive",
      backgroundBlur: 16,
      backgroundBrightness: 1,
      backgroundMaskOpacity: 100,
      gradientBackgroundEnabled: false,
      gradientBackgroundFollowArtwork: true,
    });
  });

  it("旧存档缺字段时使用封面背景并保留其它自定义外观", async () => {
    localStorage.setItem("af-theme", JSON.stringify({
      version: 3,
      state: { theme: "light", accentColor: "#123456", backgroundBlur: 24, gradientBackgroundEnabled: true },
    }));
    await useThemeStore.persist.rehydrate();
    expect(useThemeStore.getState()).toMatchObject({
      immersiveBackground: "cover", theme: "light", accentColor: "#123456", backgroundBlur: 24,
      gradientBackgroundEnabled: true,
    });
  });

  it.each(["cover", "liquid", "aurora"] as const)("%s 经持久化与重新加载后保持选择", async mode => {
    useThemeStore.getState().patchAppearance({ immersiveBackground: mode, accentColor: "#123456" });
    const saved = localStorage.getItem("af-theme")!;
    expect(JSON.parse(saved).state.immersiveBackground).toBe(mode);
    useThemeStore.getState().resetAppearance();
    localStorage.setItem("af-theme", saved);
    await useThemeStore.persist.rehydrate();
    expect(useThemeStore.getState().immersiveBackground).toBe(mode);
    expect(useThemeStore.getState().accentColor).toBe("#123456");
  });

  it.each(["invalid", "", null, 123])("无效存档 %s 归一化为封面背景", async value => {
    localStorage.setItem("af-theme", JSON.stringify({ version: 3, state: { immersiveBackground: value } }));
    await useThemeStore.persist.rehydrate();
    expect(useThemeStore.getState().immersiveBackground).toBe("cover");
  });

  it("真实设置选择器通过 view model 即时更新 store 并落盘", async () => {
    await mountSettings();
    expect(backgroundSelect().props.value).toBe("cover");
    expect(backgroundSelect().findAllByType("option").map(option => ({
      value: option.props.value, label: option.children.join(""),
    }))).toEqual(IMMERSIVE_BACKGROUND_OPTIONS);
    for (const mode of ["liquid", "aurora"] as const) {
      act(() => backgroundSelect().props.onChange({ target: { value: mode } }));
      expect(backgroundSelect().props.value).toBe(mode);
      expect(useThemeStore.getState().immersiveBackground).toBe(mode);
      expect(JSON.parse(localStorage.getItem("af-theme")!).state.immersiveBackground).toBe(mode);
    }
  });

  it("单项恢复只重置沉浸背景，其它外观保持用户选择", async () => {
    useThemeStore.getState().patchAppearance({ immersiveBackground: "aurora", theme: "light", backgroundBlur: 24 });
    await mountSettings();
    const reset = () => renderer!.root.findByProps({ "aria-label": "恢复默认：沉浸式播放背景" });
    expect(reset().props.disabled).toBe(false);
    act(() => reset().props.onClick());
    expect(useThemeStore.getState()).toMatchObject({ immersiveBackground: "cover", theme: "light", backgroundBlur: 24 });
    expect(reset().props.disabled).toBe(true);
  });

  it("仅改变沉浸背景也启用全部恢复默认，恢复后控件重新禁用", async () => {
    await mountSettings();
    expect(resetAllButton().props.disabled).toBe(true);
    act(() => backgroundSelect().props.onChange({ target: { value: "liquid" } }));
    expect(resetAllButton().props.disabled).toBe(false);
    act(() => resetAllButton().props.onClick());
    expect(useThemeStore.getState().immersiveBackground).toBe("cover");
    expect(backgroundSelect().props.value).toBe("cover");
    expect(resetAllButton().props.disabled).toBe(true);
  });
});
