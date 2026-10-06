export interface ImmersiveLayoutInput {
  width: number;
  height: number;
  fontScale: number;
  insets: { top: number; bottom: number; left: number; right: number };
}

const MIN_PRIMARY_WIDTH = 304;
const MIN_LYRICS_WIDTH = 280;
const SCALED_LYRICS_WIDTH = 200;
const COLUMN_GAP = 24;
const SPLIT_PADDING = 16;
const MAX_PRIMARY_WIDTH = 480;
const MIN_MEDIA_HEIGHT = 96;
const COVER_BOTTOM_SPACE = 24;
const PRIMARY_WIDTH_SHARE = 0.45;
const COVER_WIDTH_SHARE = 0.85;
const COMPACT_SAFE_HEIGHT = 552;

/** 根容器只决定分栏和密度；纵向分配交给原生 flex，不回写子级测量高度。 */
export function resolveImmersiveLayout(input: ImmersiveLayoutInput) {
  const { width, height, insets, fontScale } = input;
  const dimensions = { width, height, ...insets };
  for (const [name, value] of Object.entries(dimensions)) {
    if (!Number.isFinite(value) || value < 0) throw new RangeError(`Invalid immersive layout ${name}: ${value}`);
  }
  if (!Number.isFinite(fontScale) || fontScale <= 0) throw new RangeError("Invalid immersive fontScale");

  const safeWidth = Math.max(0, width - insets.left - insets.right);
  const safeHeight = Math.max(0, height - insets.top - insets.bottom);
  const minLyricsWidth = Math.max(MIN_LYRICS_WIDTH, SCALED_LYRICS_WIDTH * fontScale);
  const split = safeWidth >= MIN_PRIMARY_WIDTH + minLyricsWidth + COLUMN_GAP + 2 * SPLIT_PADDING;
  const horizontalPadding = split ? SPLIT_PADDING : 0;
  const columnGap = split ? COLUMN_GAP : 0;
  const columnsWidth = safeWidth - 2 * horizontalPadding - columnGap;
  const primaryWidth = split
    ? Math.min(MAX_PRIMARY_WIDTH, columnsWidth - minLyricsWidth, Math.max(MIN_PRIMARY_WIDTH, columnsWidth * PRIMARY_WIDTH_SHARE))
    : safeWidth;
  const lyricsWidth = split ? columnsWidth - primaryWidth : 0;
  return {
    mode: split ? "split" as const : "pager" as const,
    safeWidth, safeHeight, primaryWidth, lyricsWidth, horizontalPadding, columnGap,
    compact: safeHeight < COMPACT_SAFE_HEIGHT,
  };
}

/** 媒体视口的原生实测值仅影响封面内部，不参与父级高度分配。 */
export function resolveImmersiveCoverLayout(input: { width: number; height: number; miniLyricHeight: number }) {
  const { width, height, miniLyricHeight } = input;
  for (const [name, value] of Object.entries(input)) {
    if (!Number.isFinite(value) || value < 0) throw new RangeError(`Invalid immersive media ${name}: ${value}`);
  }
  const showMiniLyric = miniLyricHeight > 0 && height >= MIN_MEDIA_HEIGHT + miniLyricHeight;
  const coverBottomSpace = Math.min(height, showMiniLyric ? miniLyricHeight : COVER_BOTTOM_SPACE);
  const coverSize = Math.max(0, Math.min(width * COVER_WIDTH_SHARE, MAX_PRIMARY_WIDTH, height - coverBottomSpace));
  return { coverSize, coverBottomSpace, showMiniLyric };
}
