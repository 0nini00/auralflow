/**
 * 跨端设计令牌 —— 唯一真相源。
 *
 * 桌面端（`desktop/src/styles/theme.css` 的 `--af-*`）与移动端
 * （`apps/mobile/src/theme/tokens.ts`）都从这里取值，不允许各自另抄一份。
 * `desktop/tests/design-tokens-contract.test.ts` 会解析 theme.css 逐项比对：
 * 改了一边忘了另一边，测试直接红。
 *
 * 唯一**有意分叉**的是字号阶梯：手机视距更近，正文必须比桌面大一档。
 * 两张表并列放在这里，而不是让两端各自维护一套「没对齐」的数值。
 */

/** 圆角：相邻档差 ≥2px，两端共用同一张表。 */
export const RADIUS = {
  xs: 6,
  sm: 8,
  md: 10,
  lg: 14,
  xl: 20,
  /** 移动端底部弹层 / 大卡片；桌面目前没有消费方 */
  xxl: 28,
  pill: 9999,
} as const;

/** 间距：只允许落在 2px 网格的这些取值上。 */
export const SPACING_STEPS = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 32, 40] as const;

/** 字号阶梯：桌面按 CSS 变量命名，移动端按语义命名。 */
export const TYPE_SCALE = {
  desktop: { xs: 12, sm: 13, base: 14, lg: 16, xl: 18, xxl: 24, xxxl: 32 },
  mobile: { micro: 11, caption: 12, meta: 13, body: 15, title: 17, heading: 20, display: 28, displayLg: 34 },
} as const;

/**
 * 品牌绿三档，两端共用：
 * - vivid 只做渐变/装饰，不承载文字；
 * - accent 用于图标、选中态、链接；
 * - action 用于按钮填充与强调文字（白字 5.4:1）。
 */
export const BRAND = {
  vivid: "#3bd877",
  accent: "#17a34a",
  action: "#0d7a42",
} as const;

/** 画布底色：两端同值，是「同一个产品」的视觉锚点。 */
export const CANVAS = {
  light: "#f3f3ef",
  dark: "#0b0f0d",
} as const;
