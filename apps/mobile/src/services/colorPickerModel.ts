import { DEFAULT_ACCENT_COLOR, parseAccentColorInput } from "./themePaletteModel";

export interface HsvColor {
  /** 0–360 */
  h: number;
  /** 0–1 */
  s: number;
  /** 0–1 */
  v: number;
}

const FALLBACK_HSV: HsvColor = { h: 152, s: 0.9, v: 0.48 };

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function toHex(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value * 255))).toString(16).padStart(2, "0");
}

/** #RRGGBB → HSV；非法输入回退到默认绿。 */
export function hexToHsv(input: string | null | undefined): HsvColor {
  const hex = parseAccentColorInput(input ?? "") ?? DEFAULT_ACCENT_COLOR;
  const red = parseInt(hex.slice(1, 3), 16) / 255;
  const green = parseInt(hex.slice(3, 5), 16) / 255;
  const blue = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;

  let hue = 0;
  if (delta > 0) {
    if (max === red) hue = ((green - blue) / delta) % 6;
    else if (max === green) hue = (blue - red) / delta + 2;
    else hue = (red - green) / delta + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }

  return {
    h: hue,
    s: max === 0 ? 0 : delta / max,
    v: max,
  };
}

/** HSV → #RRGGBB。h 可为任意角度，s/v 自动钳制到 0–1。 */
export function hsvToHex(hue: number, saturation: number, value: number): string {
  const h = ((hue % 360) + 360) % 360;
  const s = clamp01(saturation);
  const v = clamp01(value);
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;

  let red = 0;
  let green = 0;
  let blue = 0;
  if (h < 60) [red, green, blue] = [c, x, 0];
  else if (h < 120) [red, green, blue] = [x, c, 0];
  else if (h < 180) [red, green, blue] = [0, c, x];
  else if (h < 240) [red, green, blue] = [0, x, c];
  else if (h < 300) [red, green, blue] = [x, 0, c];
  else [red, green, blue] = [c, 0, x];

  return `#${toHex(red + m)}${toHex(green + m)}${toHex(blue + m)}`;
}

/** 调色盘初始色：默认绿。 */
export const COLOR_PICKER_FALLBACK = FALLBACK_HSV;
