import AsyncStorage from "@react-native-async-storage/async-storage";
import { Appearance } from "react-native";
import { create } from "zustand";

import { backupCorruptStorageValue } from "@/services/corruptStorageBackup";
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

function parseThemeState(raw: string): PersistedThemeState {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("主题配置数据格式错误");
  }
  const { mode, accentColor } = parsed as PersistedThemeState;
  return {
    mode: mode === "light" || mode === "dark" || mode === "system" ? mode : undefined,
    accentColor: migrateAccentColor(accentColor),
  };
}

/**
 * 读主题配置。键不存在是正常的首次启动，用默认值；键存在但读不懂是数据损坏。
 *
 * 主题在 App 启动的阻塞加载里：这里抛错应用就永远停在启动失败页（重试也还是同一份坏数据）。
 * 所以损坏时先备份原始值、落盘日志，再用默认主题启动——之后改主题会覆盖原键，原始值仍在备份键里。
 */
async function readPersistedTheme(): Promise<PersistedThemeState> {
  const raw = await AsyncStorage.getItem(THEME_STORAGE_KEY);
  if (raw === null) return {};
  try {
    return parseThemeState(raw);
  } catch (error) {
    await backupCorruptStorageValue(THEME_STORAGE_KEY, raw, error);
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
    const persisted = await readPersistedTheme();
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
