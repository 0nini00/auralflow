interface MenuAnchor {
  right: number;
  top: number;
  bottom: number;
}

interface Size {
  width: number;
  height: number;
}

const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 6;

export function getMenuPosition(anchor: MenuAnchor, menu: Size, viewport: Size) {
  const left = Math.max(VIEWPORT_MARGIN, Math.min(anchor.right - menu.width, viewport.width - menu.width - VIEWPORT_MARGIN));
  const belowTop = anchor.bottom + ANCHOR_GAP;
  const top = belowTop + menu.height > viewport.height
    ? Math.max(VIEWPORT_MARGIN, anchor.top - menu.height - ANCHOR_GAP)
    : belowTop;
  return { top, left };
}

interface SelectAnchor {
  top: number;
  bottom: number;
  left: number;
  width: number;
}

export interface SelectMenuPosition {
  top: number | "auto";
  bottom: number | "auto";
  left: number;
  width: number;
  maxHeight: number;
}

/** 菜单最窄这么宽：触发器再窄，选项文字也要放得下 */
const SELECT_MENU_MIN_WIDTH = 180;
/** 菜单最高这么多，超出后改为内部滚动 —— 选项一多不能把底部顶到屏幕外 */
const SELECT_MENU_MAX_HEIGHT = 320;
/** 空间再挤也留这么高，至少露出两三项 */
const SELECT_MENU_MIN_HEIGHT = 120;
/** 单项高度（.af-dropdown-menu button 实测 42px）与菜单上下内边距之和，只用于估算要不要翻面 */
const SELECT_ITEM_HEIGHT = 42;
const SELECT_MENU_PADDING = 16;

/**
 * 下拉选择（components/ui/Select）的菜单定位：与触发器左对齐、至少同宽，限高后在内部滚动。
 *
 * 下方放不下完整列表时翻到空间更大的一侧。向上展开时钉住下边缘而不是算 top：
 * 菜单的实际高度由内容决定，靠估算的高度去对齐，会和触发器之间留缝或压上去。
 */
export function getSelectMenuPosition(anchor: SelectAnchor, optionCount: number, viewport: Size): SelectMenuPosition {
  const width = Math.max(SELECT_MENU_MIN_WIDTH, Math.round(anchor.width));
  const wanted = Math.min(optionCount * SELECT_ITEM_HEIGHT + SELECT_MENU_PADDING, SELECT_MENU_MAX_HEIGHT);
  const spaceBelow = viewport.height - anchor.bottom - ANCHOR_GAP - VIEWPORT_MARGIN;
  const spaceAbove = anchor.top - ANCHOR_GAP - VIEWPORT_MARGIN;
  const openUp = spaceBelow < wanted && spaceAbove > spaceBelow;
  const available = openUp ? spaceAbove : spaceBelow;
  return {
    top: openUp ? "auto" : anchor.bottom + ANCHOR_GAP,
    bottom: openUp ? viewport.height - anchor.top + ANCHOR_GAP : "auto",
    left: Math.max(VIEWPORT_MARGIN, Math.min(anchor.left, viewport.width - width - VIEWPORT_MARGIN)),
    width,
    maxHeight: Math.max(SELECT_MENU_MIN_HEIGHT, Math.min(SELECT_MENU_MAX_HEIGHT, available)),
  };
}
