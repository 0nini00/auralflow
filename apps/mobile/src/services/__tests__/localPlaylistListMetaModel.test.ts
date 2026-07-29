import { describe, expect, it } from "vitest";

import { buildLocalPlaylistListMeta } from "@/services/localPlaylistListMetaModel";
import type { LocalPlaylist } from "@/services/localPlaylistModel";

function playlist(overrides: Partial<LocalPlaylist> = {}): LocalPlaylist {
  return {
    id: "local-1",
    name: "本地歌单",
    songs: [],
    createdAt: 1000,
    updatedAt: new Date(2026, 6, 7).getTime(),
    ...overrides,
  };
}

describe("local playlist list meta model", () => {
  it("builds desktop-aligned song count and update date copy", () => {
    expect(buildLocalPlaylistListMeta(playlist({ songs: [{ id: "1", source: "wy", name: "歌", singer: "人" }] as any }))).toBe(
      "1 首 · 2026/07/07",
    );
  });

  it("falls back to song count when the update date is invalid", () => {
    expect(buildLocalPlaylistListMeta(playlist({ updatedAt: Number.NaN }))).toBe("0 首");
  });
});
