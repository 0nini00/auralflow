import type { MusicInfo } from "@lx/core";
import type { LibrarySection } from "./librarySectionModel";

export type LibrarySongDeleteRequest =
  | {
      type: "history";
      songId: string;
      source: string;
    }
  | {
      type: "local";
      song: Pick<MusicInfo, "id" | "source">;
      title: string;
      message: string;
      confirmLabel: string;
    }
  | { type: "none" };

export interface LibrarySongActionsModel {
  show: boolean;
  playAllLabel: string;
  shuffleLabel: string;
  canDeleteSongs: boolean;
  deleteTarget: LibrarySongDeleteTarget | null;
}

const SONG_ACTION_SECTIONS = new Set<LibrarySection>(["history", "local"]);

export type LibrarySongDeleteTarget = "history" | "local";

export function getLibrarySongDeleteTarget(section: LibrarySection): LibrarySongDeleteTarget | null {
  if (section === "history" || section === "local") return section;
  return null;
}

export function buildLibrarySongDeleteRequest(section: LibrarySection, song: MusicInfo): LibrarySongDeleteRequest {
  const deleteTarget = getLibrarySongDeleteTarget(section);
  if (!deleteTarget) return { type: "none" };
  if (deleteTarget === "history") {
    return {
      type: "history",
      songId: song.id,
      source: song.source,
    };
  }
  return {
    type: "local",
    song: { id: song.id, source: song.source },
    title: "移除本地音乐",
    message: `确定从本地音乐列表中移除「${song.name}」？不会删除设备上的文件。`,
    confirmLabel: "移除",
  };
}

export function buildLibrarySongActions(section: LibrarySection, songCount: number): LibrarySongActionsModel {
  const deleteTarget = getLibrarySongDeleteTarget(section);
  return {
    show: SONG_ACTION_SECTIONS.has(section) && songCount > 0,
    playAllLabel: "播放全部",
    shuffleLabel: "随机播放",
    canDeleteSongs: deleteTarget !== null,
    deleteTarget,
  };
}

export function shuffleLibrarySongs(songs: MusicInfo[], random: () => number = Math.random): MusicInfo[] {
  const next = [...songs];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}
