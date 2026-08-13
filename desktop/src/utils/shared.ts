export function fisherYatesShuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function buildImportedPlaylistMarker(playlist: { source: string; id: string }): string {
  return `[af-imported-playlist:${playlist.source}:${playlist.id}]`;
}

export interface FormatByteSizeOptions {
  nullishLabel?: string;
  emptyLabel?: string;
  roundTens?: boolean;
}

export function formatByteSize(
  bytes: number | null | undefined,
  options?: FormatByteSizeOptions,
): string {
  if (bytes == null) return options?.nullishLabel ?? "计算中...";
  if (!Number.isFinite(bytes) || bytes <= 0) return options?.emptyLabel ?? "0 B";

  const units = ["B", "KB", "MB", "GB"] as const;
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const roundTens = options?.roundTens ?? true;
  const fractionDigits = roundTens
    ? (value >= 10 || unitIndex === 0 ? 0 : 1)
    : (unitIndex === 0 ? 0 : 1);
  return `${value.toFixed(fractionDigits)} ${units[unitIndex]}`;
}
