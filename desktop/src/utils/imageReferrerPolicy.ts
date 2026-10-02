import { coverTierForDisplay, resizeCoverUrl } from "@lx/core";

/**
 * 归一化图片地址：补协议。
 *
 * 这是**数据层**用法（写进 store / 传给缓存），不改写尺寸，避免把缩略图 URL
 * 当成原图存下来。显示时请改用 `coverSrc`。
 */
export function normalizeImageUrl(src?: string | null): string {
  const value = src?.trim() ?? "";
  if (!value) return "";

  const normalized = value.startsWith("//") ? `https:${value}` : value;
  try {
    return new URL(normalized).toString();
  } catch {
    return normalized;
  }
}

/**
 * 本机设备像素比。取图只需要这个数，读不到（非浏览器环境 / 异常）时按 1 处理。
 *
 * 刻意不监听显示器切换：封面 URL 每次渲染都会重算，档位只由 DPR 决定，
 * 换屏后的下一次渲染自然落到新档位，不需要额外的监听与失效逻辑。
 */
function currentDevicePixelRatio(): number {
  return typeof window === "undefined" ? 1 : window.devicePixelRatio;
}

/**
 * **显示层**封面地址：按「目标显示尺寸 × 设备像素比」向图床索取对应档位的图。
 *
 * 图床原图常有数 MB（实测 4MB 样本），列表直接拉原图再缩到 40px 显示，
 * 解码开销与带宽都浪费在不显示的像素上 —— 滚动与切歌的卡顿主要来自这里。
 *
 * `cssSize` 传该处封面实际渲染的 CSS 边长（px）。DPR 由本模块读取，
 * 取档规则（`coverTierForDisplay`）留在 core 里，可单独跑单测。
 * 本地 asset 路径与未知图床原样返回（`resizeCoverUrl` 只改写已知图床）。
 */
export function coverSrc(src: string | null | undefined, cssSize: number): string {
  return resizeCoverUrl(
    normalizeImageUrl(src),
    coverTierForDisplay(cssSize, currentDevicePixelRatio()),
  );
}

/** 播放条封面（`.af-track-cover`）的 CSS 边长。 */
export const PLAYER_COVER_CSS_SIZE = 56;
/** 歌曲行缩略图（`.af-song-cover` 等）的 CSS 边长。 */
export const ROW_COVER_CSS_SIZE = 40;
/** 卡片 / 列表项封面（`.af-music-card-cover`）的 CSS 边长。 */
export const CARD_COVER_CSS_SIZE = 150;
/** 详情页封面（`.af-playlist-detail-cover` 等）的 CSS 边长。 */
export const DETAIL_COVER_CSS_SIZE = 240;
/** 沉浸播放页封面（`.af-immersive-cover`）的 CSS 边长（最窄断点下为 128，按主尺寸取）。 */
export const IMMERSIVE_COVER_CSS_SIZE = 240;
