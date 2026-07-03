import { convertFileSrc } from "@tauri-apps/api/core";

export const APP_BACKGROUND_CHANGE_EVENT = "af-app-background-change";

export interface AppBackgroundChangeDetail {
  path: string | null;
}

export function normalizeAppBackgroundPath(path: string | null | undefined): string | null {
  const trimmed = path?.trim();
  return trimmed ? trimmed : null;
}

export function toAppBackgroundImageUrl(path: string | null | undefined): string | null {
  const normalized = normalizeAppBackgroundPath(path);
  return normalized ? convertFileSrc(normalized) : null;
}

export function notifyAppBackgroundChanged(path: string | null): void {
  window.dispatchEvent(
    new CustomEvent<AppBackgroundChangeDetail>(APP_BACKGROUND_CHANGE_EVENT, {
      detail: { path: normalizeAppBackgroundPath(path) },
    }),
  );
}
