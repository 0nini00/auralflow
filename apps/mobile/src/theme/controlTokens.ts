export const control = {
  button: {
    small: { height: 36, minWidth: 72, horizontalPadding: 12, radius: 999, labelSize: 13 },
    medium: { height: 44, minWidth: 88, horizontalPadding: 16, radius: 999, labelSize: 14 },
    large: { height: 52, minWidth: 112, horizontalPadding: 20, radius: 999, labelSize: 16 },
  },
  iconButton: {
    compact: { size: 36, icon: 18 },
    standard: { size: 44, icon: 20 },
    large: { size: 56, icon: 26 },
  },
  chip: {
    compact: { height: 32, horizontalPadding: 12, labelSize: 13 },
    standard: { height: 36, horizontalPadding: 16, labelSize: 13 },
  },
  listItem: {
    minHeight: 56,
    horizontalPadding: 16,
    verticalPadding: 12,
    titleSize: 15,
    subtitleSize: 13,
  },
  modalActions: {
    gap: 8,
    topPadding: 16,
  },
} as const;

export type ButtonSize = keyof typeof control.button;
export type ButtonVariant = "primary" | "secondary" | "outline" | "danger" | "ghost";
export type IconButtonControlSize = keyof typeof control.iconButton;
export type IconButtonTone = "default" | "muted" | "inverse" | "danger" | "translucent";
export type ChipSize = keyof typeof control.chip;

export function controlHitSlop(size: IconButtonControlSize, minTarget = 44) {
  const inset = Math.max(0, (minTarget - control.iconButton[size].size) / 2);
  return { top: inset, bottom: inset, left: inset, right: inset };
}
