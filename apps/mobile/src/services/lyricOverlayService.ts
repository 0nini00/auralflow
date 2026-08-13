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
  update(data: { current: string; next: string; progress: number }): Promise<boolean>;
  setLocked(locked: boolean): Promise<void>;
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
  progress: number,
): Promise<boolean> {
  return getNativeModule().update({ current, next, progress });
}

export async function setLyricOverlayLocked(locked: boolean): Promise<void> {
  return getNativeModule().setLocked(locked);
}
