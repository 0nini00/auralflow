/**
 * 底部导航布局高度常量（px）。
 *
 * - MAIN_TAB_BAR_HEIGHT：四个导航键的 Tab 栏高度。
 * - PLAYER_BAR_HEIGHT：迷你播放器高度。
 * - MINI_PLAYER_GAP：迷你播放器与标签栏之间的间隙（浮起效果）。
 *
 * Tab 页时迷你播放器作为自定义 tabBar 的上一行（文档流）渲染在导航键上方，
 * 因此 tabBar 总高度 = MAIN_TAB_BAR_HEIGHT + MINI_PLAYER_GAP + (有歌时 PLAYER_BAR_HEIGHT)，
 * react-navigation 据此为内容区让位，导航键布局完全不变、零遮挡。
 */
export const MAIN_TAB_BAR_HEIGHT = 64;
export const PLAYER_BAR_HEIGHT = 64;
export const MINI_PLAYER_GAP = 6;
