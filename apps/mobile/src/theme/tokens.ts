import { Platform } from "react-native";

/**
 * 移动端统一设计 token。
 * 目的：终结各组件自说自话的硬编码尺寸/圆角/字号，给全 app 一个共同基准。
 * 颜色一律走 themePaletteModel 的 palette，这里只放"几何"维度。
 *
 * 2026-10 重构：正文 14→15，标题阶梯 17/20/28；页面边距 16→20；
 * 标签栏与迷你播放器 56→64。旧键全部保留，避免一次性改全站样式。
 */
export { control, controlHitSlop } from "./controlTokens";
export type {
  ButtonSize,
  ButtonVariant,
  ChipSize,
  IconButtonControlSize,
  IconButtonTone,
} from "./controlTokens";

/**
 * 间距刻度。
 *
 * 事实：代码里最常用的值其实是 2 / 6 / 10 / 14 / 18（全仓 335 处裸值里
 * 这五个占 155 处），而原刻度只有 4 的倍数——它们无处可去，只能继续裸写。
 * 与其声明一套没人遵守的 4px 节奏，不如把真实的 2px 半步也纳入刻度：
 * 加进来之后，新代码至少有一个「正确的落点」，不必再硬编码。
 *
 * 命名按语义而不是倍率（4 的倍数仍保留 xxs/xs/s/m/l/xl/xxl/xxxl 旧键，
 * 避免一次性改全站 556 处引用）。
 */
export const spacing = {
  /** 2px：分隔线、光学微调 */
  line: 2,
  xxs: 4,
  /** 6px：紧凑控件内部的间隙 */
  tight: 6,
  xs: 8,
  /** 10px：两个控件之间（8 与 12 之间的高频值） */
  snug: 10,
  s: 12,
  /** 14px：卡片内边距（12 与 16 之间的高频值） */
  cozy: 14,
  m: 16,
  /** 18px：区块内边距 */
  roomy: 18,
  l: 20,
  xl: 24,
  xxl: 32,
  xxxl: 40,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  pill: 999,
} as const;

export const typography = {
  /** Tab 标签、角标，不承载关键信息 */
  micro: 11,
  caption: 12,
  meta: 13,
  body: 15,
  title: 17,
  heading: 20,
  display: 28,
  displayLg: 34,
} as const;

/** 触控目标与图标尺寸：保证最小可点区域符合移动端人体工学 */
export const touch = {
  minTarget: 44,
  iconButton: 36,
} as const;

/*
 * 图标按键规格只有一个来源：theme/controlTokens.ts 的 control.iconButton
 * （compact 36 / standard 44 / large 56）。
 * 这里曾并行定义过一套 sm/md/lg/xl（36/44/56/64）与 iconButtonHitSlop，
 * 两套只差一档却都在被引用，最终只有一处真正生效——留着只会让人抄错。
 * 需要 hitSlop 请用 controlHitSlop()。
 */

export const layout = {
  pagePadding: 20,
  songRowMinHeight: 60,
  songRowPadding: 8,
  artworkSize: 48,
  /** 紧凑列表（下载项）的封面边长 */
  compactArtworkSize: 36,
  headerHeight: 56,
  compactControlHeight: 36,
  playerBarHeight: 64,
  tabBarHeight: 64,
  miniPlayerGap: 6,
} as const;

/*
 * 这里曾有 breakpoints.tablet(768) 与 layout.tabletPagePadding(24)，
 * 但全仓引用数为 0——平板适配从未实现，读代码的人却会以为已经支持。
 * 需要的内容宽度阈值请写在消费处，用「控件可用宽度」判断，不要用整屏宽度。
 */

export const isAndroid = Platform.OS === "android";

/**
 * 按压/禁用反馈的统一取值。
 *
 * 统一前：Button 0.76/0.45、Chip 0.72/0.42、IconButton 0.68/0.42、
 * ListItemButton 换成底色 wash、Touchable 换成 scale——同一只手点下去，
 * 全 app 有五种「按到了」的语言。这里只收敛数值，不改变各组件用哪种方式
 * （列表行用底色 wash 是有意的，它比透明度更能标出整行）。
 */
export const interaction = {
  pressedOpacity: 0.72,
  disabledOpacity: 0.42,
} as const;
