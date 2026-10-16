import type { MusicInfo } from "@lx/core";

export interface LocalMusicMetadataInput {
  name: string;
  singer: string;
  albumName: string;
  localLyrics?: string;
}

export type LocalMusicMetadataUpdate = Pick<MusicInfo, "name" | "singer" | "albumName"> &
  Partial<Pick<MusicInfo, "localLyrics">>;

/**
 * 文本归一化：空串 = 「没有文本」。
 *
 * 它只处理文本，不再承担「明确不匹配」的语义——归一化会把空串变成 undefined，用户
 * 「不要匹配」的意志就此消失（这正是旧实现的缺陷）。三态改由 `localLyricsChoiceModel`
 * 的 `lyricsMode` 表达，空串与「不匹配」不再互相冒充。
 */
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
