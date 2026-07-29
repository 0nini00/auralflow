import type { LocalPlaylist } from "./localPlaylistModel";

export type LocalPlaylistListActionType = "edit" | "duplicate" | "export" | "delete";

export interface LocalPlaylistListAction {
  type: LocalPlaylistListActionType;
  label: string;
  destructive: boolean;
}

export interface LocalPlaylistListActionRequest {
  playlist: LocalPlaylist;
  action: LocalPlaylistListActionType;
}

export const LOCAL_PLAYLIST_LIST_ACTIONS: LocalPlaylistListAction[] = [
  { type: "edit", label: "编辑信息", destructive: false },
  { type: "duplicate", label: "复制歌单", destructive: false },
  { type: "export", label: "导出歌单", destructive: false },
  { type: "delete", label: "删除歌单", destructive: true },
];

export function buildLocalPlaylistListActionRequest(
  playlist: LocalPlaylist,
  action: LocalPlaylistListActionType,
): LocalPlaylistListActionRequest {
  return { playlist, action };
}
