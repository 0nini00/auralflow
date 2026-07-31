import { Platform } from "react-native";

/**
 * 移动端统一设计 token。
 * 目的：终结各组件自说自话的硬编码尺寸/圆角/字号，给全 app 一个共同基准。
 * 颜色一律走 themePaletteModel 的 palette，这里只放"几何"维度。
 */
export const spacing = {
  xxs: 4,
  xs: 8,
  s: 12,
  m: 16,
  l: 20,
  xl: 24,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
} as const;

export const typography = {
  caption: 12,
  meta: 13,
  body: 14,
  title: 16,
  heading: 18,
  display: 24,
  displayLg: 32,
} as const;

/** 触控目标与图标尺寸：保证最小可点区域符合移动端人体工学 */
export const touch = {
  minTarget: 44,
  iconButton: 36,
} as const;

export const layout = {
  pagePadding: 16,
  tabletPagePadding: 20,
  songRowMinHeight: 60,
  songRowPadding: 8,
  artworkSize: 48,
  headerHeight: 56,
  compactControlHeight: 36,
  playerBarHeight: 56,
} as const;

export const breakpoints = {
  tablet: 768,
} as const;

export const isAndroid = Platform.OS === "android";
