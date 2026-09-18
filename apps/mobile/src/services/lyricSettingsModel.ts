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
    fontFamily?: string;
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

export function normalizeLyricFontFamily(value: unknown): string {
  if (typeof value !== "string") return "";
  switch (value) {
    // 系统默认（空串）与打包字体文件名（不带扩展名），原样通过
    case "":
    case "SourceHanSerifSC":
    case "LXGWWenKai":
      return value;
    // 旧值迁移：历史 Android 系统字体族 / 旧裸字体名 → 打包字体
    case "serif":
    case "Source Han Serif SC":
      return "SourceHanSerifSC";
    case "sans-serif-medium":
    case "LXGW WenKai":
      return "LXGWWenKai";
    // 其余旧值（近似默认的黑体族、monospace、未知）一律回落系统默认
    case "sans-serif-condensed":
    case "monospace":
    case "Source Han Sans SC":
    case "Noto Sans CJK SC":
    default:
      return "";
  }
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
  // 自定义字体（如霞鹜文楷、思源宋体）打包在 assets/fonts 中，且仅包含 Regular 单字重。
  // Android 下若对单字重自定义字体设置 >= 600（如 700 / Bold）的字重，
  // React Native 的 ReactFontManager 会因找不到 Bold 变体而直接回退到系统默认字体。
  // 因此使用自定义字体时字重保持为 500（映射 Typeface.NORMAL），靠颜色与缩放区分高亮；
  // 仅在系统默认字体（未指定 fontFamily）时才应用加粗字重。
  const hasCustomFont = Boolean(input.fontFamily && input.fontFamily.trim().length > 0);
  const targetWeight = hasCustomFont ? 500 : (input.active ? input.fontWeight : 500);

  const lineTextStyle: LyricTypographyStyleModel["lineTextStyle"] = {
    color: input.active ? input.activeColor || input.palette.primary : input.inactiveColor || input.palette.textMuted,
    fontSize: input.fontSize,
    opacity: input.active ? 1 : opacity,
    fontWeight: String(targetWeight) as `${LyricFontWeight}`,
    textAlign: input.textAlign,
  };

  if (input.fontFamily) {
    lineTextStyle.fontFamily = input.fontFamily;
  }

  const translationStyle: LyricTypographyStyleModel["translationStyle"] = {
    color: input.active ? input.palette.text : input.palette.textSubtle,
    marginTop: input.lineGap / 2,
    opacity: input.active ? 0.9 : opacity,
    textAlign: input.textAlign,
  };

  if (input.fontFamily) {
    translationStyle.fontFamily = input.fontFamily;
  }

  return {
    lineWrapStyle: {
      paddingBottom: input.lineGap,
    },
    lineTextStyle,
    translationStyle,
  };
}
