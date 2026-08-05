import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type {

  LyricAnimationIntensity,

  LyricFontWeight,

  LyricTextAlign,

} from "@/services/lyricSettingsModel";

import type { ChineseConversionMode } from "@/services/chineseConversionService";

/**
 * 移动端歌词样式设置 store。
 *
 * 持久化到 AsyncStorage，供 LyricView 与 LyricSettingsScreen 共享。
 * 字体相关字段使用与桌面端一致的 CSS font-family 字符串，便于后续统一。
 */

export interface LyricSettingsState {
  /** 正文字号（px），默认 16 */
  fontSize: number;
  /** 是否显示译文，默认 true */
  showTranslation: boolean;
  /** 当前行（高亮行）颜色；空字符串表示跟随主题 primary */
  activeColor: string;
  /** 其他行颜色；空字符串表示跟随主题 textMuted */
  inactiveColor: string;
  /** 行间距（px），默认 8 */
  lineGap: number;
  /** 字体 family 字符串，默认系统字体 */
  fontFamily: string;
  /** 歌词文本对齐方式 */
  textAlign: LyricTextAlign;
  /** 当前行字重 */
  fontWeight: LyricFontWeight;
  /** 非当前行与译文透明度 */
  textOpacity: number;
  /** 是否启用歌词切换动画 */
  enableAnimation: boolean;
  /** 歌词动效强度 */
  animationIntensity: LyricAnimationIntensity;
  /** 手动歌词偏移校准（毫秒）：正=歌词提前显示，负=延后，用于对齐音画不同步 */

  manualOffsetMs: number;

  /** 简繁转换模式：off=关闭 / s2t=简→繁 / t2s=繁→简。作用于正文与译文行。 */

  chineseConversion: ChineseConversionMode;



  setFontSize: (size: number) => void;

  setShowTranslation: (show: boolean) => void;

  setActiveColor: (color: string) => void;
  setInactiveColor: (color: string) => void;
  setLineGap: (gap: number) => void;
  setFontFamily: (family: string) => void;
  setTextAlign: (align: LyricTextAlign) => void;
  setFontWeight: (weight: LyricFontWeight) => void;
  setTextOpacity: (opacity: number) => void;
  setEnableAnimation: (enabled: boolean) => void;
  setAnimationIntensity: (intensity: LyricAnimationIntensity) => void;
  setManualOffset: (ms: number) => void;
  setChineseConversion: (mode: ChineseConversionMode) => void;
  resetSettings: () => void;
}

/** 歌词字号范围常量，供 LyricView 与 LyricSettingsScreen 共享 */
export const LYRIC_FONT_SIZE_MIN = 12;
export const LYRIC_FONT_SIZE_MAX = 32;

/** 系统默认字体（空串表示使用 RN 默认字体） */
export const DEFAULT_FONT_FAMILY = "";

/** 可选字体列表（label 展示用，value 为 fontFamily 值） */
export const FONT_OPTIONS: Array<{ label: string; value: string }> = [
  { label: "系统默认", value: DEFAULT_FONT_FAMILY },
  { label: "思源宋体", value: "Source Han Serif SC" },
  { label: "思源黑体", value: "Source Han Sans SC" },
  { label: "Noto Sans CJK", value: "Noto Sans CJK SC" },
  { label: "霞鹜文楷", value: "LXGW WenKai" },
];

/** 当前行颜色预设 */
export const ACTIVE_COLOR_PRESETS: Array<{ label: string; value: string }> = [
  { label: "主题绿", value: "" },
  { label: "亮绿", value: "#45e58d" },
  { label: "橙", value: "#ff9f43" },
  { label: "粉", value: "#ff6b9d" },
  { label: "蓝", value: "#54a0ff" },
  { label: "白", value: "#ffffff" },
];

/** 其他行颜色预设 */
export const INACTIVE_COLOR_PRESETS: Array<{ label: string; value: string }> = [
  { label: "主题灰", value: "" },
  { label: "浅灰", value: "#8fa79f" },
  { label: "白", value: "#ffffff" },
  { label: "深灰", value: "#5a6a67" },
];

export const DEFAULT_LYRIC_SETTINGS = {
  fontSize: 16,
  showTranslation: true,
  activeColor: "",
  inactiveColor: "",
  lineGap: 8,
  fontFamily: DEFAULT_FONT_FAMILY,
  textAlign: "center",
  fontWeight: 700,
  textOpacity: 0.45,
  enableAnimation: true,
  animationIntensity: "normal",

  manualOffsetMs: 0,

  chineseConversion: "off",

} as const;

export const useLyricSettingsStore = create<LyricSettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_LYRIC_SETTINGS,

      setFontSize: (fontSize) => set({ fontSize }),
      setShowTranslation: (showTranslation) => set({ showTranslation }),
      setActiveColor: (activeColor) => set({ activeColor }),
      setInactiveColor: (inactiveColor) => set({ inactiveColor }),
      setLineGap: (lineGap) => set({ lineGap }),
      setFontFamily: (fontFamily) => set({ fontFamily }),
      setTextAlign: (textAlign) => set({ textAlign }),
      setFontWeight: (fontWeight) => set({ fontWeight }),
      setTextOpacity: (textOpacity) => set({ textOpacity }),
      setEnableAnimation: (enableAnimation) => set({ enableAnimation }),
      setAnimationIntensity: (animationIntensity) => set({ animationIntensity }),
      setManualOffset: (manualOffsetMs) => set({ manualOffsetMs }),

      setChineseConversion: (chineseConversion) => set({ chineseConversion }),

      resetSettings: () => set({ ...DEFAULT_LYRIC_SETTINGS }),
    }),
    {
      name: "auralflow-lyric-settings",
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
