import type { LocalPlaylist } from "./localPlaylistModel";
import { getLocalPlaylistTrackCount } from "./localPlaylistModel";

function formatLocalPlaylistDate(timestamp: number): string | null {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return null;

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

export function buildLocalPlaylistListMeta(playlist: LocalPlaylist): string {
  const countText = `${getLocalPlaylistTrackCount(playlist)} 首`;
  const dateText = formatLocalPlaylistDate(playlist.updatedAt);
  return dateText ? `${countText} · ${dateText}` : countText;
}
