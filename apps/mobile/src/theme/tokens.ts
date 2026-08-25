import { Platform } from "react-native";

/**
 * 移动端统一设计 token。
 * 目的：终结各组件自说自话的硬编码尺寸/圆角/字号，给全 app 一个共同基准。
 * 颜色一律走 themePaletteModel 的 palette，这里只放"几何"维度。
 */
export { control, controlHitSlop } from "./controlTokens";
export type {
  ButtonSize,
  ButtonVariant,
  ChipSize,
  IconButtonControlSize,
  IconButtonTone,
} from "./controlTokens";

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

/**
 * 图标按键统一规格（容器尺寸 + 图标字号成对定义）。
 * 统一前全 app 存在 36/40/44/56/64 五种容器与 12~48 共 13 种图标尺寸，
 * 各页自行硬编码导致同层级按键视觉不一致。这里收敛为四档语义层级：
 * - sm：列表行内/紧凑区域的次要操作（心、更多、清除）
 * - md：通用图标按键基准（顶栏、工具栏、弹窗关闭）
 * - lg：播放控制次级键（上一首/下一首/模式）
 * - xl：单页视觉重心（沉浸页播放/暂停）
 * 所有档位容器 >= 36，配合 hitSlop 保证实际可点区域不低于 44。
 */
export const iconButton = {
  sm: { size: 36, icon: 18 },
  md: { size: 44, icon: 20 },
  lg: { size: 56, icon: 26 },
  xl: { size: 64, icon: 32 },
} as const;

export type IconButtonSize = keyof typeof iconButton;

/** 容器小于 minTarget 时补足可点区域，数值为四边扩展量 */
export function iconButtonHitSlop(size: IconButtonSize) {
  const inset = Math.max(0, (touch.minTarget - iconButton[size].size) / 2);
  return { top: inset, bottom: inset, left: inset, right: inset };
}

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
