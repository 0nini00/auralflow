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
  /** 强调色在文字/图标上的可读版本（浅色下压深、深色下提亮） */
  primaryInk: string;
  primaryText: string;
  danger: string;
  dangerSurface: string;
  statusBar: "light-content" | "dark-content";
  isDark: boolean;
}

export const DEFAULT_ACCENT_COLOR = "#3bd877";
const LEGACY_DEFAULT_ACCENT_COLOR = "#1db954";
const LEGACY_RED_ACCENT_COLOR = "#d83b40";
const HEX_COLOR_PATTERN = /^#?[0-9a-f]{6}$/;

/** 品牌绿在浅色/深色下的可读行动色（对比度见 PROPOSAL §5.1） */
const DEFAULT_ACCENT_INK_LIGHT = "#0d7a42";
const DEFAULT_ACCENT_INK_DARK = "#6fe7ac";

/** 来源色只用于 6px 圆点，不做整块标签 */
export const SOURCE_COLORS = {
  wy: "#ff5a5f",
  tx: "#2ecc8f",
  local: "#8b918a",
  custom: "#a78bfa",
} as const;

const lightBasePalette: Omit<ThemePalette, "primary" | "primaryInk" | "primaryText" | "isDark"> = {
  // 与桌面端重设计 A 方向共用同一张暖中性画布
  background: "#f3f3ef",
  surface: "#ffffff",
  surfaceMuted: "#ebebe4",
  surfaceStrong: "#e0e0d6",
  border: "#e3e3d9",
  text: "#161a16",
  textMuted: "#5b615a",
  textSubtle: "#8b918a",
  danger: "#ef4444",
  dangerSurface: "rgba(239, 68, 68, 0.1)",
  statusBar: "dark-content",
};

const darkBasePalette: Omit<ThemePalette, "primary" | "primaryInk" | "primaryText" | "isDark"> = {
  // 近黑带一点绿调：和品牌色同色相，避免纯黑在 OLED 上的拖影
  background: "#0b0f0d",
  surface: "#121815",
  surfaceMuted: "#19211d",
  surfaceStrong: "#222c27",
  border: "#26312c",
  text: "#f1f5f2",
  textMuted: "#a7b3ae",
  textSubtle: "#6e7c77",
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

function rgbToHex(red: number, green: number, blue: number): string {
  const toHex = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
}

function mixHex(from: string, to: string, amount: number): string {
  const [r1, g1, b1] = hexToRgb(from);
  const [r2, g2, b2] = hexToRgb(to);
  return rgbToHex(
    r1 + (r2 - r1) * amount,
    g1 + (g2 - g1) * amount,
    b1 + (b2 - b1) * amount,
  );
}

function relativeLuminance(color: string): number {
  const [red, green, blue] = hexToRgb(color).map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(foreground: string, background: string): number {
  const light = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const dark = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (light + 0.05) / (dark + 0.05);
}

function getReadableTextColor(background: string): string {
  const [red, green, blue] = hexToRgb(background);
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
  return luminance > 0.58 ? "#062a19" : "#ffffff";
}

/**
 * 强调色在文字/图标上的可读版本。
 * 默认品牌绿直接用设计稿给定的深绿/浅绿；自定义强调色按明暗压深或提亮，
 * 并保证与表面色至少 4.5:1，避免用户选到浅黄/浅粉后文字看不见。
 */
function buildPrimaryInk(primary: string, theme: ResolvedTheme, surface: string): string {
  if (primary === DEFAULT_ACCENT_COLOR) {
    return theme === "light" ? DEFAULT_ACCENT_INK_LIGHT : DEFAULT_ACCENT_INK_DARK;
  }
  let ink = theme === "light" ? mixHex(primary, "#000000", 0.45) : mixHex(primary, "#ffffff", 0.4);
  for (let step = 0; step < 8 && contrastRatio(ink, surface) < 4.5; step += 1) {
    ink = theme === "light" ? mixHex(ink, "#000000", 0.12) : mixHex(ink, "#ffffff", 0.12);
  }
  return ink;
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
    primaryInk: buildPrimaryInk(primary, theme, base.surface),
    primaryText: getReadableTextColor(primary),
    isDark: theme === "dark",
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
