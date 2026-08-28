export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export interface ThemePalette {
  background: string;
  surface: string;
  surfaceMuted: string;
  surfaceStrong: string;
  border: string;
  text: string;
  textMuted: string;
  textSubtle: string;
  primary: string;
  primaryText: string;
  danger: string;
  dangerSurface: string;
  statusBar: "light-content" | "dark-content";
}

export const DEFAULT_ACCENT_COLOR = "#3bd877";
const LEGACY_DEFAULT_ACCENT_COLOR = "#1db954";
const LEGACY_RED_ACCENT_COLOR = "#d83b40";
const HEX_COLOR_PATTERN = /^#?[0-9a-f]{6}$/;

const lightBasePalette: Omit<ThemePalette, "primary" | "primaryText"> = {
  // 对齐桌面 --af-bg-page / elevated / surface
  background: "#f8f9fa",
  surface: "#ffffff",
  surfaceMuted: "#f1f3f5",
  surfaceStrong: "#e9ecef",
  border: "#e2e8f0",
  text: "#0f172a",
  textMuted: "#475569",
  textSubtle: "#94a3b8",
  danger: "#ef4444",
  dangerSurface: "rgba(239, 68, 68, 0.1)",
  statusBar: "dark-content",
};

const darkBasePalette: Omit<ThemePalette, "primary" | "primaryText"> = {
  // 对齐桌面 dark --af-bg-page / elevated / surface
  background: "#121212",
  surface: "#1a1a1a",
  surfaceMuted: "#1e1e1e",
  surfaceStrong: "#2a2a2a",
  // 对齐桌面 --af-border-primary：深色下边框必须比 surface 亮一档，否则卡片/列表边界不可见
  border: "#334155",
  text: "#f8fafc",
  textMuted: "#cbd5e1",
  textSubtle: "#64748b",
  danger: "#ef4444",
  dangerSurface: "rgba(239, 68, 68, 0.1)",
  statusBar: "light-content",
};

function hexToRgb(color: string): [number, number, number] {
  const normalized = normalizeAccentColor(color).slice(1);
  return [
    parseInt(normalized.slice(0, 2), 16),
    parseInt(normalized.slice(2, 4), 16),
    parseInt(normalized.slice(4, 6), 16),
  ];
}

function getReadableTextColor(background: string): string {
  const [red, green, blue] = hexToRgb(background);
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
  return luminance > 0.58 ? "#10241f" : "#ffffff";
}

export function normalizeAccentColor(color: string | null | undefined): string {
  return parseAccentColorInput(color) ?? DEFAULT_ACCENT_COLOR;
}

export function parseAccentColorInput(color: string | null | undefined): string | null {
  const normalized = (color ?? "").trim().toLowerCase();
  if (!HEX_COLOR_PATTERN.test(normalized)) return null;
  return normalized.startsWith("#") ? normalized : `#${normalized}`;
}

export function migrateAccentColor(color: string | null | undefined): string {
  const normalized = normalizeAccentColor(color);
  return normalized === LEGACY_DEFAULT_ACCENT_COLOR || normalized === LEGACY_RED_ACCENT_COLOR
    ? DEFAULT_ACCENT_COLOR
    : normalized;
}

// 调色板缓存：同一 (theme, accentColor) 恒返回同一引用。
// 调色板作为 prop 传入 memo 子组件（SongItem 等）时靠引用相等跳过重渲染，
// 每次调用都新建对象会让全局行级 memo 系统性失效。
const themePaletteCache = new Map<string, ThemePalette>();
const THEME_PALETTE_CACHE_LIMIT = 64;

export function buildThemePalette(theme: ResolvedTheme, accentColor = DEFAULT_ACCENT_COLOR): ThemePalette {
  const primary = normalizeAccentColor(accentColor);
  const cacheKey = `${theme}|${primary}`;
  const cached = themePaletteCache.get(cacheKey);
  if (cached) return cached;

  const base = theme === "light" ? lightBasePalette : darkBasePalette;
  const palette: ThemePalette = {
    ...base,
    primary,
    primaryText: getReadableTextColor(primary),
  };
  if (themePaletteCache.size >= THEME_PALETTE_CACHE_LIMIT) {
    themePaletteCache.clear();
  }
  themePaletteCache.set(cacheKey, palette);
  return palette;
}

/**
 * 给 6 位 hex 颜色叠加透明度（如主色的轻量背景 / 进度条缓冲色）。
 * 非 hex 输入（如 rgba）原样返回，避免破坏现有主题。
 */
export function withAlpha(color: string, alpha: number): string {
  const normalized = (color ?? "").trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return color;
  const red = parseInt(normalized.slice(0, 2), 16);
  const green = parseInt(normalized.slice(2, 4), 16);
  const blue = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}
