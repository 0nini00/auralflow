import type { WyPlaylistInfo } from "./wyPlaylistService";

export type WyPlaylistOwnership = Pick<WyPlaylistInfo, "source" | "subscribed" | "creator">;

export function isOwnedWyPlaylist(
  playlist: WyPlaylistOwnership,
  userId: string | undefined,
): boolean {
  // 同步引用和公开歌单都可能没有 subscribed，只有创建者归属能确认写入目标。
  return Boolean(userId)
    && playlist.source === "wy"
    && playlist.creator?.userId === userId
    && playlist.subscribed !== true;
}
