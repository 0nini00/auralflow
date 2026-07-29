import type { ThemePalette } from "@/services/themePaletteModel";

export interface ScreenThemeModel {
  pageBackground: string;
  titleText: string;
  bodyText: string;
  subtleText: string;
  cardBackground: string;
  mutedBackground: string;
  strongBackground: string;
  cardBorder: string;
  primaryBackground: string;
  primarySubtleBackground: string;
  primaryText: string;
  progressTrackBackground: string;
  progressFillBackground: string;
  progressThumbBackground: string;
  dangerText: string;
  dangerBackground: string;
}

function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    throw new Error(`Invalid theme color: ${hex}`);
  }

  const red = parseInt(normalized.slice(0, 2), 16);
  const green = parseInt(normalized.slice(2, 4), 16);
  const blue = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export function buildScreenTheme(palette: ThemePalette): ScreenThemeModel {
  const primarySubtleAlpha = palette.statusBar === "dark-content" ? 0.12 : 0.16;

  return {
    pageBackground: palette.background,
    titleText: palette.text,
    bodyText: palette.textMuted,
    subtleText: palette.textSubtle,
    cardBackground: palette.surface,
    mutedBackground: palette.surfaceMuted,
    strongBackground: palette.surfaceStrong,
    cardBorder: palette.border,
    primaryBackground: palette.primary,
    primarySubtleBackground: hexToRgba(palette.primary, primarySubtleAlpha),
    primaryText: palette.primaryText,
    progressTrackBackground: palette.surfaceStrong,
    progressFillBackground: palette.primary,
    progressThumbBackground: palette.primary,
    dangerText: palette.danger,
    dangerBackground: palette.dangerSurface,
  };
}
