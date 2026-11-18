import { convertFileSrc } from "@tauri-apps/api/core";

/** 背景图路径的唯一来源是设置里的 appBackgroundImagePath（stores/settingsStore.ts）；这里只做路径到图片的转换。 */

export function normalizeAppBackgroundPath(path: string | null | undefined): string | null {
  const trimmed = path?.trim();
  return trimmed ? trimmed : null;
}

export function toAppBackgroundImageUrl(path: string | null | undefined): string | null {
  const normalized = normalizeAppBackgroundPath(path);
  return normalized ? convertFileSrc(normalized) : null;
}

export async function preloadAppBackground(path: string): Promise<void> {
  const url = toAppBackgroundImageUrl(path);
  if (!url || typeof Image === "undefined") return;

  await new Promise<void>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("无法预加载背景图片：" + path));
    image.src = url;
  });
}
