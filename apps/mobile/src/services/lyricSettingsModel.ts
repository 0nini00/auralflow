import {
  getNextChineseConversionMode,
  type ChineseConversionMode,
} from "@/services/chineseConversionService";

export interface ImmersiveTranslationControlModel {
  label: string;
  active: boolean;
  nextShowTranslation: boolean;
}

export type LyricTextAlign = "left" | "center" | "right";
export type LyricFontWeight = 500 | 700 | 800;
export type LyricAnimationIntensity = "reduced" | "normal" | "enhanced";

export interface LyricTypographyPalette {
  primary: string;
  text: string;
  textMuted: string;
  textSubtle: string;
}

export interface LyricTypographyStyleInput {
  active: boolean;
  fontSize: number;
  lineGap: number;
  fontFamily: string;
  activeColor: string;
  inactiveColor: string;
  textAlign: LyricTextAlign;
  fontWeight: LyricFontWeight;
  textOpacity: number;
  palette: LyricTypographyPalette;
}

export interface LyricTypographyStyleModel {
  lineWrapStyle: {
    paddingBottom: number;
  };
  lineTextStyle: {
    color: string;
    fontSize: number;
    fontFamily?: string;
    opacity: number;
    fontWeight: `${LyricFontWeight}`;
    textAlign: LyricTextAlign;
  };
  translationStyle: {
    color: string;
    marginTop: number;
    opacity: number;
    textAlign: LyricTextAlign;
  };
}

export interface LyricAnimationModelInput {
  enabled: boolean;
  intensity: unknown;
}

export interface LyricAnimationModel {
  enabled: boolean;
  scrollAnimated: boolean;
  lineTransitionDurationMs: number;
  activeScale: number;
  inactiveScale: number;
}

const ANIMATION_INTENSITIES = new Set<LyricAnimationIntensity>(["reduced", "normal", "enhanced"]);

export function buildImmersiveTranslationControl(showTranslation: boolean): ImmersiveTranslationControlModel {
  return {
    label: showTranslation ? "译 开" : "译 关",
    active: showTranslation,
    nextShowTranslation: !showTranslation,
  };
}

export interface ImmersiveChineseConversionControlModel {
  /** 显示在按钮上的短标签（3-4 字，与「译 开/关」保持同风格） */
  label: string;
  /** 是否处于非 off 态（用于按钮高亮/激活样式） */
  active: boolean;
  /** 循环切换到的下一个模式：off → 简→繁 → 繁→简 → off */
  nextMode: ChineseConversionMode;
}

const CHINESE_CONVERSION_LABELS: Record<ChineseConversionMode, string> = {
  off: "繁 关",
  s2t: "简→繁",
  t2s: "繁→简",
};

export function buildImmersiveChineseConversionControl(
  mode: ChineseConversionMode,
): ImmersiveChineseConversionControlModel {
  return {
    label: CHINESE_CONVERSION_LABELS[mode] ?? CHINESE_CONVERSION_LABELS.off,
    active: mode !== "off",
    nextMode: getNextChineseConversionMode(mode),
  };
}

export function normalizeLyricAnimationIntensity(value: unknown): LyricAnimationIntensity {
  return typeof value === "string" && ANIMATION_INTENSITIES.has(value as LyricAnimationIntensity)
    ? (value as LyricAnimationIntensity)
    : "normal";
}

export function getLyricAnimationIntensityScale(value: unknown): number {
  switch (normalizeLyricAnimationIntensity(value)) {
    case "reduced":
      return 0.55;
    case "enhanced":
      return 1.25;
    case "normal":
    default:
      return 1;
  }
}

export function buildLyricAnimationModel(input: LyricAnimationModelInput): LyricAnimationModel {
  if (!input.enabled) {
    return {
      enabled: false,
      scrollAnimated: false,
      lineTransitionDurationMs: 0,
      activeScale: 1,
      inactiveScale: 1,
    };
  }

  const scale = getLyricAnimationIntensityScale(input.intensity);

  return {
    enabled: true,
    scrollAnimated: true,
    lineTransitionDurationMs: Math.round(180 * scale),
    activeScale: Math.round((1 + 0.04 * scale) * 100) / 100,
    inactiveScale: 1,
  };
}

export function buildLyricTypographyStyleModel(
  input: LyricTypographyStyleInput,
): LyricTypographyStyleModel {
  const opacity = Math.max(0.2, Math.min(1, input.textOpacity));
  const lineTextStyle: LyricTypographyStyleModel["lineTextStyle"] = {
    color: input.active ? input.activeColor || input.palette.primary : input.inactiveColor || input.palette.textMuted,
    fontSize: input.fontSize,
    opacity: input.active ? 1 : opacity,
    fontWeight: String(input.active ? input.fontWeight : 500) as `${LyricFontWeight}`,
    textAlign: input.textAlign,
  };

  if (input.fontFamily) {
    lineTextStyle.fontFamily = input.fontFamily;
  }

  return {
    lineWrapStyle: {
      paddingBottom: input.lineGap,
    },
    lineTextStyle,
    translationStyle: {
      color: input.active ? input.palette.text : input.palette.textSubtle,
      marginTop: input.lineGap / 2,
      opacity: input.active ? 0.9 : opacity,
      textAlign: input.textAlign,
    },
  };
}
