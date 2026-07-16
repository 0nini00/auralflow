import { NativeModules, Platform } from "react-native";

interface ArtworkColorModule {
  extractArtworkColors(imageUri: string): Promise<ArtworkColors>;
}

interface ArtworkColorNativeModules {
  ArtworkColorModule?: ArtworkColorModule;
}

const nativeModule = (NativeModules as ArtworkColorNativeModules).ArtworkColorModule;

/**
 * 从封面提取的调色板颜色（均为 #RRGGBB 或 null）。
 */
export interface ArtworkColors {
  /** 主要色，适合作为页面氛围背景 */
  dominant: string | null;
  vibrant: string | null;
  darkVibrant: string | null;
  muted: string | null;
  darkMuted: string | null;
}

/**
 * 从封面地址提取主色调（仅 Android，使用原生 Palette）。
 * 非 Android 或无封面时返回 null，调用方应回退到主题背景。
 */
export async function extractArtworkColors(imageUri?: string | null): Promise<ArtworkColors | null> {
  if (Platform.OS !== "android" || !imageUri) {
    return null;
  }
  if (!nativeModule || typeof nativeModule.extractArtworkColors !== "function") {
    throw new Error("ArtworkColorModule 未注册，请重新编译原生工程");
  }
  return nativeModule.extractArtworkColors(imageUri);
}

/**
 * 把 #RRGGBB 按 factor 压暗，返回 rgb() 字符串，用于保证文字可读的氛围背景。
 */
export function darkenHex(hex: string, factor: number): string {
  const normalized = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return "#000000";
  }
  const red = Math.round(parseInt(normalized.slice(0, 2), 16) * factor);
  const green = Math.round(parseInt(normalized.slice(2, 4), 16) * factor);
  const blue = Math.round(parseInt(normalized.slice(4, 6), 16) * factor);
  return `rgb(${red}, ${green}, ${blue})`;
}
