import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Theme = "light" | "dark" | "auto";

interface ThemeStore {
  theme: Theme;
  effectiveTheme: "light" | "dark";
  setTheme: (theme: Theme) => void;
}

const getSystemTheme = (): "light" | "dark" => {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
};

const applyTheme = (theme: "light" | "dark") => {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
};

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set, get) => {
      // Listen to system theme changes
      if (typeof window !== "undefined") {
        const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
        mediaQuery.addEventListener("change", (e) => {
          const { theme } = get();
          if (theme === "auto") {
            const newTheme = e.matches ? "dark" : "light";
            set({ effectiveTheme: newTheme });
            applyTheme(newTheme);
          }
        });
      }

      return {
        theme: "auto",
        effectiveTheme: getSystemTheme(),

        setTheme: (theme) => {
          const effectiveTheme = theme === "auto" ? getSystemTheme() : theme;
          set({ theme, effectiveTheme });
          applyTheme(effectiveTheme);
        },
      };
    },
    {
      name: "af-theme",
      partialize: (state) => ({ theme: state.theme }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          const effectiveTheme =
            state.theme === "auto" ? getSystemTheme() : state.theme;
          state.effectiveTheme = effectiveTheme;
          applyTheme(effectiveTheme);
        }
      },
    }
  )
);
