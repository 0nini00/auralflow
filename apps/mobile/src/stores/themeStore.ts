import AsyncStorage from "@react-native-async-storage/async-storage";
import { Appearance } from "react-native";
import { create } from "zustand";

import {
  DEFAULT_ACCENT_COLOR,
  buildThemePalette,
  migrateAccentColor,
  normalizeAccentColor,
  type ResolvedTheme,
  type ThemeMode,
  type ThemePalette,
} from "@/services/themePaletteModel";
import { releasePersistedImageUri } from "@/services/imagePickerService";

export type { ResolvedTheme, ThemeMode, ThemePalette } from "@/services/themePaletteModel";

const THEME_STORAGE_KEY = "auralflow.mobile.theme";

interface PersistedThemeState {
  mode?: ThemeMode;
  accentColor?: string;
  backgroundImageUri?: string | null;
  backgroundOpacity?: number;
}

interface ThemeState {
  mode: ThemeMode;
  systemTheme: ResolvedTheme;
  accentColor: string;
  /** 用户选择的自定义应用背景图 URI（content://），null=使用主题背景 */
  backgroundImageUri: string | null;
  /** 背景图上的遮罩不透明度，0=纯背景图，1=完全被主题色覆盖 */
  backgroundOpacity: number;
  loaded: boolean;
  loadTheme: () => Promise<void>;
  setMode: (mode: ThemeMode) => Promise<void>;
  setSystemTheme: (theme: ResolvedTheme) => void;
  setAccentColor: (color: string) => Promise<void>;
  resetAccentColor: () => Promise<void>;
  setBackgroundImageUri: (uri: string | null) => Promise<void>;
  setBackgroundOpacity: (value: number) => Promise<void>;
}

const getSystemTheme = (): ResolvedTheme => {
  return Appearance.getColorScheme() === "light" ? "light" : "dark";
};

const DEFAULT_BACKGROUND_OPACITY = 0.5;

function clampOpacity(value: number | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value)) return DEFAULT_BACKGROUND_OPACITY;
  return Math.max(0, Math.min(1, value));
}

async function persistTheme(state: {
  mode: ThemeMode;
  accentColor: string;
  backgroundImageUri: string | null;
  backgroundOpacity: number;
}): Promise<void> {
  await AsyncStorage.setItem(
    THEME_STORAGE_KEY,
    JSON.stringify({
      mode: state.mode,
      accentColor: state.accentColor,
      backgroundImageUri: state.backgroundImageUri,
      backgroundOpacity: state.backgroundOpacity,
    })
  );
}

function parseThemeState(raw: string | null): PersistedThemeState {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as PersistedThemeState;
    const mode = parsed.mode === "light" || parsed.mode === "dark" || parsed.mode === "system"
      ? parsed.mode
      : undefined;
    return {
      mode,
      accentColor: migrateAccentColor(parsed.accentColor),
      backgroundImageUri: typeof parsed.backgroundImageUri === "string" && parsed.backgroundImageUri.length > 0
        ? parsed.backgroundImageUri
        : null,
      backgroundOpacity: clampOpacity(parsed.backgroundOpacity),
    };
  } catch {
    return {};
  }
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: "system",
  systemTheme: getSystemTheme(),
  accentColor: DEFAULT_ACCENT_COLOR,
  backgroundImageUri: null,
  backgroundOpacity: DEFAULT_BACKGROUND_OPACITY,
  loaded: false,

  loadTheme: async () => {
    const persisted = parseThemeState(await AsyncStorage.getItem(THEME_STORAGE_KEY));
    set({
      mode: persisted.mode ?? "system",
      accentColor: persisted.accentColor ?? DEFAULT_ACCENT_COLOR,
      backgroundImageUri: persisted.backgroundImageUri ?? null,
      backgroundOpacity: clampOpacity(persisted.backgroundOpacity),
      loaded: true,
    });
  },

  setMode: async (mode) => {
    set({ mode });
    const state = get();
    await persistTheme({
      mode,
      accentColor: state.accentColor,
      backgroundImageUri: state.backgroundImageUri,
      backgroundOpacity: state.backgroundOpacity,
    });
  },

  setSystemTheme: (systemTheme) => set({ systemTheme }),

  setAccentColor: async (color) => {
    const accentColor = normalizeAccentColor(color);
    set({ accentColor });
    const state = get();
    await persistTheme({
      mode: state.mode,
      accentColor,
      backgroundImageUri: state.backgroundImageUri,
      backgroundOpacity: state.backgroundOpacity,
    });
  },

  resetAccentColor: async () => {
    set({ accentColor: DEFAULT_ACCENT_COLOR });
    const state = get();
    await persistTheme({
      mode: state.mode,
      accentColor: DEFAULT_ACCENT_COLOR,
      backgroundImageUri: state.backgroundImageUri,
      backgroundOpacity: state.backgroundOpacity,
    });
  },

  setBackgroundImageUri: async (uri) => {
    const previous = get().backgroundImageUri;
    if (previous && previous !== uri) {
      // 释放旧图的持久化权限，避免 URI 泄漏
      void releasePersistedImageUri(previous);
    }
    set({ backgroundImageUri: uri });
    const state = get();
    await persistTheme({
      mode: state.mode,
      accentColor: state.accentColor,
      backgroundImageUri: uri,
      backgroundOpacity: state.backgroundOpacity,
    });
  },

  setBackgroundOpacity: async (value) => {
    const clamped = clampOpacity(value);
    set({ backgroundOpacity: clamped });
    const state = get();
    await persistTheme({
      mode: state.mode,
      accentColor: state.accentColor,
      backgroundImageUri: state.backgroundImageUri,
      backgroundOpacity: clamped,
    });
  },
}));

export function getResolvedTheme(mode: ThemeMode, systemTheme: ResolvedTheme): ResolvedTheme {
  return mode === "system" ? systemTheme : mode;
}

export function getThemePalette(theme: ResolvedTheme, accentColor = DEFAULT_ACCENT_COLOR): ThemePalette {
  return buildThemePalette(theme, accentColor);
}
