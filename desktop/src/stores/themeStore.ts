import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Theme = "light" | "dark" | "auto";

const DEFAULT_ACCENT_COLOR = "#3bd877";
const LEGACY_DEFAULT_ACCENT_COLOR = "#1db954";
const LEGACY_RED_ACCENT_COLOR = "#d83b40";

interface ThemeStore {
  theme: Theme;
  effectiveTheme: "light" | "dark";
  accentColor: string;
  setTheme: (theme: Theme) => void;
  setAccentColor: (color: string) => void;
  resetAccentColor: () => void;
}

const getSystemTheme = (): "light" | "dark" => {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
};

function normalizeHexColor(color: string): string {
  const normalized = color.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(normalized) ? normalized : DEFAULT_ACCENT_COLOR;
}

function migrateAccentColor(color: string): string {
  const normalized = normalizeHexColor(color);
  return normalized === LEGACY_DEFAULT_ACCENT_COLOR || normalized === LEGACY_RED_ACCENT_COLOR
    ? DEFAULT_ACCENT_COLOR
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

const applyAppearance = (theme: "light" | "dark", accentColor = DEFAULT_ACCENT_COLOR) => {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
  const root = document.documentElement;
  const normalizedAccent = normalizeHexColor(accentColor);
  const [red, green, blue] = hexToRgb(normalizedAccent);
  const secondary = mixColor(normalizedAccent, [255, 255, 255], theme === "dark" ? 0.18 : 0.1);
  const hover = mixColor(normalizedAccent, [0, 0, 0], theme === "dark" ? 0.14 : 0.1);

  root.style.setProperty("--af-accent-primary", normalizedAccent);
  root.style.setProperty("--af-accent-primary-rgb", `${red}, ${green}, ${blue}`);
  root.style.setProperty("--af-accent-secondary", secondary);
  root.style.setProperty("--af-accent-hover", hover);
  root.style.setProperty("--af-accent-gradient", `linear-gradient(135deg, ${normalizedAccent} 0%, ${secondary} 100%)`);
  root.style.setProperty("--af-accent-gradient-hover", `linear-gradient(135deg, ${hover} 0%, ${normalizedAccent} 100%)`);
  root.style.setProperty("--af-border-focus", `rgba(${red}, ${green}, ${blue}, ${theme === "dark" ? 0.5 : 0.4})`);
};

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set, get) => {
      // Listen to system theme changes
      if (typeof window !== "undefined") {
        const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
        mediaQuery.addEventListener("change", (e) => {
          const { theme, accentColor } = get();
          if (theme === "auto") {
            const newTheme = e.matches ? "dark" : "light";
            set({ effectiveTheme: newTheme });
            applyAppearance(newTheme, accentColor);
          }
        });
      }

      return {
        theme: "auto",
        effectiveTheme: getSystemTheme(),
        accentColor: DEFAULT_ACCENT_COLOR,

        setTheme: (theme) => {
          const effectiveTheme = theme === "auto" ? getSystemTheme() : theme;
          set({ theme, effectiveTheme });
          const { accentColor } = get();
          applyAppearance(effectiveTheme, accentColor);
        },

        setAccentColor: (color) => {
          const accentColor = normalizeHexColor(color);
          set({ accentColor });
          const { effectiveTheme } = get();
          applyAppearance(effectiveTheme, accentColor);
        },

        resetAccentColor: () => {
          set({ accentColor: DEFAULT_ACCENT_COLOR });
          const { effectiveTheme } = get();
          applyAppearance(effectiveTheme, DEFAULT_ACCENT_COLOR);
        },
      };
    },
    {
      name: "af-theme",
      partialize: (state) => ({
        theme: state.theme,
        accentColor: state.accentColor,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          const effectiveTheme =
            state.theme === "auto" ? getSystemTheme() : state.theme;
          state.effectiveTheme = effectiveTheme;
          state.accentColor = migrateAccentColor(state.accentColor || DEFAULT_ACCENT_COLOR);
          applyAppearance(effectiveTheme, state.accentColor);
        }
      },
    }
  )
);

export function applyInitialAppearance() {
  const state = useThemeStore.getState();
  applyAppearance(state.effectiveTheme, state.accentColor);
}
