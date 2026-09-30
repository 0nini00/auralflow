import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Theme = "light" | "dark" | "auto";
export type EffectiveTheme = "light" | "dark";
/** 封面取色的作用范围：仅播放条 / 播放条与沉浸歌词页 */
export type ArtworkAmbienceScope = "player" | "player-immersive";

/**
 * 外观设置。这里是外观默认值的**唯一来源**：
 * theme.css 不再重复这些字面量，启动时 applyInitialAppearance()（main.tsx 里早于 React
 * 渲染执行）会把它们写成根节点上的 CSS 变量，CSS 侧只负责消费。
 */
export interface AppearanceSettings {
  theme: Theme;
  accentColor: string;
  /** 是否用封面主色驱动氛围光；关闭时氛围光退回主题强调色，从不改写 accentColor */
  artworkAmbienceEnabled: boolean;
  /** 氛围光强度（0-100） */
  artworkAmbienceIntensity: number;
  artworkAmbienceScope: ArtworkAmbienceScope;
  /** 面板毛玻璃模糊半径（px） */
  backgroundBlur: number;
  /** 背景亮度系数，乘在主题预设上（1 = 预设） */
  backgroundBrightness: number;
  /** 蒙层不透明度（0-100，100 = 预设厚度） */
  backgroundMaskOpacity: number;
  /** 整窗 CSS 渐变（mesh）动态背景 */
  gradientBackgroundEnabled: boolean;
  /** 渐变背景跟随封面主色（关闭则只用强调色系） */
  gradientBackgroundFollowArtwork: boolean;
}

export const APPEARANCE_DEFAULTS: AppearanceSettings = {
  theme: "auto",
  accentColor: "#3bd877",
  artworkAmbienceEnabled: true,
  artworkAmbienceIntensity: 100,
  artworkAmbienceScope: "player-immersive",
  backgroundBlur: 16,
  backgroundBrightness: 1,
  backgroundMaskOpacity: 100,
  gradientBackgroundEnabled: false,
  gradientBackgroundFollowArtwork: true,
};

/** 滑块的取值范围：设置行与归一化共用同一份，避免两处各写一套边界。 */
export const APPEARANCE_LIMITS = {
  artworkAmbienceIntensity: { min: 0, max: 100, step: 5 },
  backgroundBlur: { min: 0, max: 40, step: 2 },
  backgroundBrightness: { min: 0.7, max: 1.3, step: 0.02 },
  backgroundMaskOpacity: { min: 0, max: 100, step: 5 },
} as const;

/** 氛围光强度 100% 时播放条氛围光的 alpha（与改造前观感一致） */
const AMBIENCE_BASE_ALPHA = 0.16;
/** 强调色填充上的文字二选一，取对比度更高的那个 */
const ACCENT_TEXT_DARK = "#0f172a";
const ACCENT_TEXT_LIGHT = "#ffffff";
const LEGACY_DEFAULT_ACCENT_COLOR = "#1db954";
const LEGACY_RED_ACCENT_COLOR = "#d83b40";

interface ThemeStore extends AppearanceSettings {
  effectiveTheme: EffectiveTheme;
  setTheme: (theme: Theme) => void;
  setAccentColor: (color: string) => void;
  resetAccentColor: () => void;
  /** 批量改外观设置：各设置行、单项与整体恢复默认都走这里，状态与 CSS 一次对齐 */
  patchAppearance: (patch: Partial<AppearanceSettings>) => void;
  /** 外观全部恢复默认（不含主界面背景图片，那一项由它自己的按钮清除） */
  resetAppearance: () => void;
  /** 只把强调色刷进 CSS：hex 输入的实时预览，不改状态也不落盘；刷回存档值即回滚 */
  previewAccentColor: (color: string) => void;
}

const getSystemTheme = (): EffectiveTheme => {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function normalizeHexColor(color: string): string {
  const normalized = color.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(normalized) ? normalized : APPEARANCE_DEFAULTS.accentColor;
}

function migrateAccentColor(color: string): string {
  const normalized = normalizeHexColor(color);
  return normalized === LEGACY_DEFAULT_ACCENT_COLOR || normalized === LEGACY_RED_ACCENT_COLOR
    ? APPEARANCE_DEFAULTS.accentColor
    : normalized;
}

function hexToRgb(color: string): [number, number, number] {
  const normalized = normalizeHexColor(color).slice(1);
  return [
    parseInt(normalized.slice(0, 2), 16),
    parseInt(normalized.slice(2, 4), 16),
    parseInt(normalized.slice(4, 6), 16),
  ];
}

function rgbToHex([red, green, blue]: [number, number, number]): string {
  return `#${[red, green, blue]
    .map((channel) => Math.round(Math.max(0, Math.min(255, channel))).toString(16).padStart(2, "0"))
    .join("")}`;
}

function mixColor(color: string, target: [number, number, number], amount: number): string {
  const source = hexToRgb(color);
  return rgbToHex([
    source[0] + (target[0] - source[0]) * amount,
    source[1] + (target[1] - source[1]) * amount,
    source[2] + (target[2] - source[2]) * amount,
  ]);
}

/** sRGB 相对亮度（WCAG 2.1） */
function relativeLuminance([red, green, blue]: [number, number, number]): number {
  const channel = (value: number) => {
    const normalized = value / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
}

function contrastRatio(luminanceA: number, luminanceB: number): number {
  const lighter = Math.max(luminanceA, luminanceB);
  const darker = Math.min(luminanceA, luminanceB);
  return (lighter + 0.05) / (darker + 0.05);
}

/** 强调色填充控件上的文字：黑/白里取对比度更高的一个（浅色强调色不再配白字） */
function pickOnAccentText(rgb: [number, number, number]): string {
  const background = relativeLuminance(rgb);
  const darkContrast = contrastRatio(background, relativeLuminance(hexToRgb(ACCENT_TEXT_DARK)));
  const lightContrast = contrastRatio(background, 1);
  return darkContrast >= lightContrast ? ACCENT_TEXT_DARK : ACCENT_TEXT_LIGHT;
}

/** 强调色派生的全部变量（含强调色填充上的文字色）。hex 预览与正式写入共用这一段。 */
const applyAccentColor = (color: string, effectiveTheme: EffectiveTheme) => {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const normalizedAccent = normalizeHexColor(color);
  const rgb = hexToRgb(normalizedAccent);
  const [red, green, blue] = rgb;
  const secondary = mixColor(normalizedAccent, [255, 255, 255], effectiveTheme === "dark" ? 0.18 : 0.1);
  const hover = mixColor(normalizedAccent, [0, 0, 0], effectiveTheme === "dark" ? 0.14 : 0.1);

  root.style.setProperty("--af-accent-primary", normalizedAccent);
  root.style.setProperty("--af-accent-primary-rgb", `${red}, ${green}, ${blue}`);
  root.style.setProperty("--af-accent-secondary", secondary);
  root.style.setProperty("--af-accent-hover", hover);
  root.style.setProperty("--af-accent-gradient", `linear-gradient(135deg, ${normalizedAccent} 0%, ${secondary} 100%)`);
  root.style.setProperty("--af-accent-gradient-hover", `linear-gradient(135deg, ${hover} 0%, ${normalizedAccent} 100%)`);
  root.style.setProperty("--af-border-focus", `rgba(${red}, ${green}, ${blue}, ${effectiveTheme === "dark" ? 0.5 : 0.4})`);
  // 旧 token --af-accent-text 在 theme.css 里指向这个变量，两个名字共用一个值
  root.style.setProperty("--af-text-on-accent", pickOnAccentText(rgb));
};

/** 布尔外观开关用根节点属性是否存在表达：关闭时 CSS 里对应的整层根本不渲染 */
const setRootFlag = (name: string, enabled: boolean) => {
  document.documentElement.toggleAttribute(name, enabled);
};

const applyAppearanceEffects = (settings: AppearanceSettings) => {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  // 背景图面板效果：index.css 里的面板毛玻璃都读这三个变量
  root.style.setProperty("--af-app-bg-blur", `${settings.backgroundBlur}px`);
  root.style.setProperty("--af-app-bg-brightness", String(settings.backgroundBrightness));
  root.style.setProperty("--af-app-bg-mask", String(settings.backgroundMaskOpacity / 100));
  // 氛围光强度：0 时播放条的氛围光层完全透明
  root.style.setProperty(
    "--af-ambience-alpha",
    String((AMBIENCE_BASE_ALPHA * settings.artworkAmbienceIntensity) / 100),
  );
  setRootFlag("data-gradient-background", settings.gradientBackgroundEnabled);
  setRootFlag("data-gradient-artwork", settings.gradientBackgroundFollowArtwork);
};

const applyAppearance = (settings: AppearanceSettings, effectiveTheme: EffectiveTheme) => {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", effectiveTheme);
  applyAccentColor(settings.accentColor, effectiveTheme);
  applyAppearanceEffects(settings);
};

const isTheme = (value: unknown): value is Theme =>
  value === "light" || value === "dark" || value === "auto";

const isScope = (value: unknown): value is ArtworkAmbienceScope =>
  value === "player" || value === "player-immersive";

const readBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

const readNumber = (value: unknown, fallback: number, min: number, max: number): number => {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numeric * 100) / 100));
};

/**
 * 把任意来源（旧存档、被手改的 localStorage）读成完整可用的外观设置：
 * 缺字段与写坏的字段都回落到默认值，旧存档里只有 theme/accentColor 也能正常升级。
 * 同时用于 persist 的 partialize —— 落盘的永远只有外观字段。
 */
function normalizeAppearance(value: unknown): AppearanceSettings {
  const raw = asRecord(value);
  const defaults = APPEARANCE_DEFAULTS;
  const limits = APPEARANCE_LIMITS;
  return {
    theme: isTheme(raw.theme) ? raw.theme : defaults.theme,
    accentColor: migrateAccentColor(
      typeof raw.accentColor === "string" ? raw.accentColor : defaults.accentColor,
    ),
    artworkAmbienceEnabled: readBoolean(raw.artworkAmbienceEnabled, defaults.artworkAmbienceEnabled),
    artworkAmbienceIntensity: readNumber(
      raw.artworkAmbienceIntensity,
      defaults.artworkAmbienceIntensity,
      limits.artworkAmbienceIntensity.min,
      limits.artworkAmbienceIntensity.max,
    ),
    artworkAmbienceScope: isScope(raw.artworkAmbienceScope)
      ? raw.artworkAmbienceScope
      : defaults.artworkAmbienceScope,
    backgroundBlur: readNumber(
      raw.backgroundBlur,
      defaults.backgroundBlur,
      limits.backgroundBlur.min,
      limits.backgroundBlur.max,
    ),
    backgroundBrightness: readNumber(
      raw.backgroundBrightness,
      defaults.backgroundBrightness,
      limits.backgroundBrightness.min,
      limits.backgroundBrightness.max,
    ),
    backgroundMaskOpacity: readNumber(
      raw.backgroundMaskOpacity,
      defaults.backgroundMaskOpacity,
      limits.backgroundMaskOpacity.min,
      limits.backgroundMaskOpacity.max,
    ),
    gradientBackgroundEnabled: readBoolean(raw.gradientBackgroundEnabled, defaults.gradientBackgroundEnabled),
    gradientBackgroundFollowArtwork: readBoolean(
      raw.gradientBackgroundFollowArtwork,
      defaults.gradientBackgroundFollowArtwork,
    ),
  };
}

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set, get) => {
      // Listen to system theme changes
      if (typeof window !== "undefined") {
        const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
        mediaQuery.addEventListener("change", (e) => {
          const state = get();
          if (state.theme !== "auto") return;
          const effectiveTheme: EffectiveTheme = e.matches ? "dark" : "light";
          set({ effectiveTheme });
          applyAppearance(state, effectiveTheme);
        });
      }

      return {
        ...APPEARANCE_DEFAULTS,
        effectiveTheme: getSystemTheme(),

        setTheme: (theme) => {
          get().patchAppearance({ theme });
        },

        setAccentColor: (accentColor) => {
          get().patchAppearance({ accentColor });
        },

        resetAccentColor: () => {
          get().patchAppearance({ accentColor: APPEARANCE_DEFAULTS.accentColor });
        },

        patchAppearance: (patch) => {
          const next = normalizeAppearance({ ...get(), ...patch });
          const effectiveTheme: EffectiveTheme = next.theme === "auto" ? getSystemTheme() : next.theme;
          set({ ...next, effectiveTheme });
          applyAppearance(next, effectiveTheme);
        },

        resetAppearance: () => {
          get().patchAppearance({ ...APPEARANCE_DEFAULTS });
        },

        previewAccentColor: (color) => {
          applyAccentColor(color, get().effectiveTheme);
        },
      };
    },
    {
      name: "af-theme",
      partialize: (state) => normalizeAppearance(state),
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...normalizeAppearance(persistedState),
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const effectiveTheme: EffectiveTheme =
          state.theme === "auto" ? getSystemTheme() : state.theme;
        state.effectiveTheme = effectiveTheme;
        applyAppearance(state, effectiveTheme);
      },
    }
  )
);

export function applyInitialAppearance() {
  const state = useThemeStore.getState();
  applyAppearance(state, state.effectiveTheme);
}
