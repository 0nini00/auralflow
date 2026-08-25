import { convertFileSrc } from "@tauri-apps/api/core";

export const APP_BACKGROUND_CHANGE_EVENT = "af-app-background-change";
const APP_BACKGROUND_STORAGE_KEY = "af-app-background-path";

export interface AppBackgroundChangeDetail {
  path: string | null;
}

export interface AppBackgroundStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface PrepareInitialAppBackgroundOptions {
  storage?: AppBackgroundStorage | null;
  loadPersistedPath: () => Promise<string | null | undefined>;
  preload?: (path: string) => Promise<void>;
}

function getAppBackgroundStorage(): AppBackgroundStorage | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

export function normalizeAppBackgroundPath(path: string | null | undefined): string | null {
  const trimmed = path?.trim();
  return trimmed ? trimmed : null;
}

export function readCachedAppBackgroundPath(
  storage: AppBackgroundStorage | null = getAppBackgroundStorage(),
): string | null | undefined {
  if (!storage) return undefined;
  const cached = storage.getItem(APP_BACKGROUND_STORAGE_KEY);
  if (cached == null) return undefined;
  return normalizeAppBackgroundPath(cached);
}

export function cacheAppBackgroundPath(
  path: string | null | undefined,
  storage: AppBackgroundStorage | null = getAppBackgroundStorage(),
): void {
  if (!storage) return;
  storage.setItem(APP_BACKGROUND_STORAGE_KEY, normalizeAppBackgroundPath(path) ?? "");
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

export async function prepareInitialAppBackground({
  storage = getAppBackgroundStorage(),
  loadPersistedPath,
  preload = preloadAppBackground,
}: PrepareInitialAppBackgroundOptions): Promise<string | null> {
  const cached = readCachedAppBackgroundPath(storage);
  if (cached !== undefined) {
    if (cached) await preload(cached);
    return cached;
  }

  const persisted = normalizeAppBackgroundPath(await loadPersistedPath());
  cacheAppBackgroundPath(persisted, storage);
  if (persisted) await preload(persisted);
  return persisted;
}

export function notifyAppBackgroundChanged(path: string | null): void {
  const normalized = normalizeAppBackgroundPath(path);
  cacheAppBackgroundPath(normalized);
  window.dispatchEvent(
    new CustomEvent<AppBackgroundChangeDetail>(APP_BACKGROUND_CHANGE_EVENT, {
      detail: { path: normalized },
    }),
  );
}
