import { describe, expect, it } from "vitest";
import type { LocalPlaylist } from "@/services/localPlaylistModel";
import {
  LOCAL_PLAYLIST_LIST_ACTIONS,
  buildLocalPlaylistListActionRequest,
} from "@/services/localPlaylistListActions";

describe("local playlist list actions", () => {
  it("exposes the desktop-equivalent management actions for local playlists", () => {
    expect(LOCAL_PLAYLIST_LIST_ACTIONS).toEqual([
      { type: "edit", label: "编辑信息", destructive: false },
      { type: "duplicate", label: "复制歌单", destructive: false },
      { type: "export", label: "导出歌单", destructive: false },
      { type: "delete", label: "删除歌单", destructive: true },
    ]);
  });

  it("keeps the selected playlist with the chosen action", () => {
    const playlist: LocalPlaylist = {
      id: "local-1",
      name: "本地歌单",
      songs: [],
      createdAt: 1000,
      updatedAt: 1000,
    };

    expect(buildLocalPlaylistListActionRequest(playlist, "duplicate")).toEqual({
      playlist,
      action: "duplicate",
    });
  });
});
