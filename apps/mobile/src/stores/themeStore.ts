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
}

interface ThemeState {
  mode: ThemeMode;
  systemTheme: ResolvedTheme;
  accentColor: string;
  /** 用户选择的自定义应用背景图 URI（content://），null=使用主题背景 */
  backgroundImageUri: string | null;
  loaded: boolean;
  loadTheme: () => Promise<void>;
  setMode: (mode: ThemeMode) => Promise<void>;
  setSystemTheme: (theme: ResolvedTheme) => void;
  setAccentColor: (color: string) => Promise<void>;
  resetAccentColor: () => Promise<void>;
  setBackgroundImageUri: (uri: string | null) => Promise<void>;
}

const getSystemTheme = (): ResolvedTheme => {
  return Appearance.getColorScheme() === "light" ? "light" : "dark";
};

async function persistTheme(state: {
  mode: ThemeMode;
  accentColor: string;
  backgroundImageUri: string | null;
}): Promise<void> {
  await AsyncStorage.setItem(
    THEME_STORAGE_KEY,
    JSON.stringify({
      mode: state.mode,
      accentColor: state.accentColor,
      backgroundImageUri: state.backgroundImageUri,
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
  loaded: false,

  loadTheme: async () => {
    if (get().loaded) return;
    const persisted = parseThemeState(await AsyncStorage.getItem(THEME_STORAGE_KEY));
    set({
      mode: persisted.mode ?? "system",
      accentColor: persisted.accentColor ?? DEFAULT_ACCENT_COLOR,
      backgroundImageUri: persisted.backgroundImageUri ?? null,
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
    });
  },

  resetAccentColor: async () => {
    set({ accentColor: DEFAULT_ACCENT_COLOR });
    const state = get();
    await persistTheme({
      mode: state.mode,
      accentColor: DEFAULT_ACCENT_COLOR,
      backgroundImageUri: state.backgroundImageUri,
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
    });
  },
}));

export function getResolvedTheme(mode: ThemeMode, systemTheme: ResolvedTheme): ResolvedTheme {
  return mode === "system" ? systemTheme : mode;
}

export function getThemePalette(theme: ResolvedTheme, accentColor = DEFAULT_ACCENT_COLOR): ThemePalette {
  return buildThemePalette(theme, accentColor);
}
