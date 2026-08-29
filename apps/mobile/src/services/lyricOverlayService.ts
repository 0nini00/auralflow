import { NativeModules, Platform } from "react-native";

/**
 * 桌面歌词悬浮窗原生桥接（对应桌面端独立歌词窗口）。
 *
 * 仅 Android 支持。调用方可先用 isLyricOverlaySupported() 探测能力；
 * 实际操作必须显式传播原生错误，避免把桥接故障伪装为正常结果。
 */
interface NativeLyricOverlayModule {
  canDrawOverlays(): Promise<boolean>;
  isVisible(): Promise<boolean>;
  setNotificationButtonEnabled(enabled: boolean): Promise<void>;
  requestOverlayPermission(): Promise<boolean>;
  show(): Promise<boolean>;
  hide(): Promise<boolean>;
  update(data: { current: string; next: string }): Promise<boolean>;
  setLocked(locked: boolean): Promise<void>;
  setStyle(style: LyricOverlayStyle): Promise<void>;
  getStyle(): Promise<Required<LyricOverlayStyle>>;
}

/** 悬浮歌词外观。字段留空表示保持原值。 */
export interface LyricOverlayStyle {
  /** 正在播放行的字号（sp），10-40 */
  fontSize?: number;
  /** 文字不透明度，10-100 */
  textOpacity?: number;
  /** 是否显示下一行 */
  showNextLine?: boolean;
  /** 文字投影。关掉后浅色壁纸上会难以辨认 */
  shadowEnabled?: boolean;
  /** 当前行文字颜色（#RRGGBB；空串=默认白），随歌词样式「当前行颜色」同步 */
  activeColor?: string;
  /** 其他行文字颜色（#RRGGBB；空串=默认白），随歌词样式「其他行颜色」同步 */
  inactiveColor?: string;
  /** 字体 family（空串=系统默认），随歌词样式「字体」同步 */
  fontFamily?: string;
}

const nativeModule = (NativeModules as Record<string, unknown>).LyricOverlayModule as
  | NativeLyricOverlayModule
  | undefined;

export function isLyricOverlaySupported(): boolean {
  return Platform.OS === "android" && nativeModule != null;
}

function getNativeModule(): NativeLyricOverlayModule {
  if (!nativeModule) {
    throw new Error("LyricOverlayModule is unavailable on this device");
  }
  return nativeModule;
}

export async function canDrawOverlays(): Promise<boolean> {
  return getNativeModule().canDrawOverlays();
}

export async function isLyricOverlayVisible(): Promise<boolean> {
  return getNativeModule().isVisible();
}

export async function setLyricNotificationButtonEnabled(enabled: boolean): Promise<void> {
  return getNativeModule().setNotificationButtonEnabled(enabled);
}

export async function requestOverlayPermission(): Promise<boolean> {
  return getNativeModule().requestOverlayPermission();
}

export async function showLyricOverlay(): Promise<boolean> {
  return getNativeModule().show();
}

export async function hideLyricOverlay(): Promise<boolean> {
  return getNativeModule().hide();
}

export async function updateLyricOverlay(
  current: string,
  next: string,
): Promise<boolean> {
  return getNativeModule().update({ current, next });
}

export async function setLyricOverlayStyle(style: LyricOverlayStyle): Promise<void> {
  return getNativeModule().setStyle(style);
}

/** 读回原生侧当前外观（Preferences 为唯一真相）。 */
export async function getLyricOverlayStyle(): Promise<Required<LyricOverlayStyle>> {
  return getNativeModule().getStyle();
}

export async function setLyricOverlayLocked(locked: boolean): Promise<void> {
  return getNativeModule().setLocked(locked);
}
