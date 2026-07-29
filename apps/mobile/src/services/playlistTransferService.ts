import { usePlaylistStore } from "../stores/playlistStore";
import {
  buildImportedLocalPlaylists,
  buildPlaylistExportEnvelope,
  isValidPlaylistTransferJson,
  type PlaylistTransferEnvelope,
} from "./playlistTransferModel";
import type { LocalPlaylist } from "./localPlaylistModel";

export interface PlaylistImportResult {
  addedSongCount: number;
  imported: boolean;
}

/**
 * 导出本地歌单为 JSON 字符串。
 * 导出喜欢歌曲、移动端本地歌单，以及当前已加载的远端歌单。
 */
export async function exportPlaylists(): Promise<string> {
  const { likedSongs, localPlaylists, currentPlaylist, currentPlaylistSongs } = usePlaylistStore.getState();

  const envelope = buildPlaylistExportEnvelope({
    likedSongs,
    localPlaylists,
    currentPlaylist,
    currentPlaylistSongs,
  });

  return JSON.stringify(envelope, null, 2);
}

export async function exportLocalPlaylists(localPlaylists: LocalPlaylist[]): Promise<string> {
  const envelope = buildPlaylistExportEnvelope({
    likedSongs: [],
    localPlaylists,
    currentPlaylist: null,
    currentPlaylistSongs: [],
  });

  return JSON.stringify(envelope, null, 2);
}

export async function shareExportedPlaylists(): Promise<void> {
  const { Share } = await import("react-native");
  await Share.share({
    title: "导出 AuralFlow 歌单",
    message: await exportPlaylists(),
  });
}

export async function shareExportedLocalPlaylists(localPlaylists: LocalPlaylist[]): Promise<void> {
  const { Share } = await import("react-native");
  await Share.share({
    title: "导出 AuralFlow 歌单",
    message: await exportLocalPlaylists(localPlaylists),
  });
}

/**
 * 从 JSON 字符导入歌单。
 * 移动端将导入的歌单合并到本地歌单，保留歌单边界。
 * 返回新增歌曲数量；解析失败抛出错误。
 */
export async function importPlaylists(json: string): Promise<number> {
  const data = JSON.parse(json) as Partial<PlaylistTransferEnvelope>;
  const store = usePlaylistStore.getState();
  const { localPlaylists, addedSongCount } = buildImportedLocalPlaylists(store.localPlaylists, data);

  if (addedSongCount === 0) {
    return 0;
  }

  await store.replaceLocalPlaylists(localPlaylists);
  return addedSongCount;
}

export async function importPlaylistsFromJsonInput(json: string): Promise<PlaylistImportResult> {
  const trimmed = json.trim();
  if (!trimmed) throw new Error("请先粘贴歌单 JSON");
  const addedSongCount = await importPlaylists(trimmed);
  return {
    addedSongCount,
    imported: addedSongCount > 0,
  };
}

/** 校验 JSON 是否为合法的歌单导出格式。 */
export function validatePlaylistsJson(json: string): boolean {
  return isValidPlaylistTransferJson(json);
}
