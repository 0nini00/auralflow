import type { MusicInfo } from "@lx/core";

export interface LocalMusicMetadataInput {
  name: string;
  singer: string;
  albumName: string;
  localLyrics?: string;
}

export type LocalMusicMetadataUpdate = Pick<MusicInfo, "name" | "singer" | "albumName"> &
  Partial<Pick<MusicInfo, "localLyrics">>;

/** 文本归一化：空串 = 「没有文本」。 */
function normalizeOptionalText(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function buildLocalMusicMetadataUpdate(input: LocalMusicMetadataInput): LocalMusicMetadataUpdate {
  const name = input.name.trim();
  if (!name) {
    throw new Error("歌曲标题不能为空");
  }

  const update: LocalMusicMetadataUpdate = {
    name,
    singer: input.singer.trim() || "未知歌手",
    albumName: input.albumName.trim() || "未知专辑",
  };

  if ("localLyrics" in input) {
    update.localLyrics = normalizeOptionalText(input.localLyrics);
  }

  return update;
}
