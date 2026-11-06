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
