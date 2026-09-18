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
  setLyrics(lyricsJson: string, fallbackText: string): Promise<void>;
  playLyricClock(position: number): Promise<void>;
  pauseLyricClock(): Promise<void>;
  setLyricClockRate(rate: number): Promise<void>;
  clearLyrics(fallbackText: string): Promise<void>;
}

export interface OverlayLyricLine {
  time: number;
  text: string;
  tr?: string;
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

/**
 * 向原生悬浮歌词注入当前歌曲的歌词列表与未开始时的回退文本（歌名 - 歌手）。
 * 原生内部启动/准备时钟调度，App 退入后台后歌词仍可在原生 Service 中自行推进行号。
 */
export async function setLyricOverlayLyrics(
  lines: OverlayLyricLine[],
  fallbackText = "",
): Promise<void> {
  const json = JSON.stringify(
    lines.map((l) => ({
      time: l.time,
      text: l.text ?? "",
      tr: l.tr ?? "",
    })),
  );
  return getNativeModule().setLyrics(json, fallbackText);
}

/** 启动/校准原生悬浮歌词时钟（以秒为单位的当前播放位置）。 */
export async function playLyricOverlayClock(position: number): Promise<void> {
  return getNativeModule().playLyricClock(Math.max(0, position));
}

/** 暂停原生悬浮歌词时钟。 */
export async function pauseLyricOverlayClock(): Promise<void> {
  return getNativeModule().pauseLyricClock();
}

/** 更新原生悬浮歌词时钟倍速。 */
export async function setLyricOverlayClockRate(rate: number): Promise<void> {
  return getNativeModule().setLyricClockRate(rate);
}

/** 清空原生悬浮歌词（切歌或无歌词时），回退显示歌曲信息。 */
export async function clearLyricOverlayLyrics(fallbackText = ""): Promise<void> {
  return getNativeModule().clearLyrics(fallbackText);
}

