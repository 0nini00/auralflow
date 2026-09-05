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

export type { ResolvedTheme, ThemeMode, ThemePalette } from "@/services/themePaletteModel";

const THEME_STORAGE_KEY = "auralflow.mobile.theme";

interface PersistedThemeState {
  mode?: ThemeMode;
  accentColor?: string;
}

interface ThemeState {
  mode: ThemeMode;
  systemTheme: ResolvedTheme;
  accentColor: string;
  loaded: boolean;
  loadTheme: () => Promise<void>;
  setMode: (mode: ThemeMode) => Promise<void>;
  setSystemTheme: (theme: ResolvedTheme) => void;
  setAccentColor: (color: string) => Promise<void>;
  resetAccentColor: () => Promise<void>;
}

const getSystemTheme = (): ResolvedTheme => {
  return Appearance.getColorScheme() === "light" ? "light" : "dark";
};

async function persistTheme(state: {
  mode: ThemeMode;
  accentColor: string;
}): Promise<void> {
  await AsyncStorage.setItem(
    THEME_STORAGE_KEY,
    JSON.stringify({
      mode: state.mode,
      accentColor: state.accentColor,
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
    };
  } catch {
    return {};
  }
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: "system",
  systemTheme: getSystemTheme(),
  accentColor: DEFAULT_ACCENT_COLOR,
  loaded: false,

  loadTheme: async () => {
    if (get().loaded) return;
    const persisted = parseThemeState(await AsyncStorage.getItem(THEME_STORAGE_KEY));
    set({
      mode: persisted.mode ?? "system",
      accentColor: persisted.accentColor ?? DEFAULT_ACCENT_COLOR,
      loaded: true,
    });
  },

  setMode: async (mode) => {
    set({ mode });
    const state = get();
    await persistTheme({
      mode,
      accentColor: state.accentColor,
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
    });
  },

  resetAccentColor: async () => {
    set({ accentColor: DEFAULT_ACCENT_COLOR });
    const state = get();
    await persistTheme({
      mode: state.mode,
      accentColor: DEFAULT_ACCENT_COLOR,
    });
  },

}));

export function getResolvedTheme(mode: ThemeMode, systemTheme: ResolvedTheme): ResolvedTheme {
  return mode === "system" ? systemTheme : mode;
}

export function getThemePalette(theme: ResolvedTheme, accentColor = DEFAULT_ACCENT_COLOR): ThemePalette {
  return buildThemePalette(theme, accentColor);
}
