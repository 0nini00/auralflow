import type { LibrarySection } from "./librarySectionModel";

export type LibraryContentModel =
  | {
      kind: "songList";
      songSource: "history" | "local";
      emptyText: string;
      showClearHistory: boolean;
      showLocalScan: boolean;
      error: string | null;
    }
  | {
      kind: "downloads";
      showClearHistory: false;
      showLocalScan: false;
      error: string | null;
    }
  | {
      kind: "biliCollections";
      showClearHistory: false;
      showLocalScan: false;
      error: null;
    };

export type LibraryContentModelInput =
  | { section: "history"; historyCount: number }
  | { section: "local"; localLoading: boolean; localError: string | null }
  | { section: "downloads"; downloadError: string | null }
  | { section: "bili" };

export function getLibraryContentModel(input: LibraryContentModelInput): LibraryContentModel {
  switch (input.section) {
    case "history":
      return {
        kind: "songList",
        songSource: "history",
        emptyText: "播放歌曲后会自动记录到这里",
        showClearHistory: input.historyCount > 0,
        showLocalScan: false,
        error: null,
      };
    case "local":
      return {
        kind: "songList",
        songSource: "local",
        emptyText: "还没有扫描本地音乐",
        showClearHistory: false,
        showLocalScan: true,
        error: input.localError,
      };
    case "downloads":
      return {
        kind: "downloads",
        showClearHistory: false,
        showLocalScan: false,
        error: input.downloadError,
      };
    case "bili":
      return {
        kind: "biliCollections",
        showClearHistory: false,
        showLocalScan: false,
        error: null,
      };
  }
}

export function buildLibraryContentModelInput({
  section,
  historyCount,
  localLoading,
  localError,
  downloadError,
}: {
  section: LibrarySection;
  historyCount: number;
  localLoading: boolean;
  localError: string | null;
  downloadError: string | null;
}): LibraryContentModelInput {
  switch (section) {
    case "history":
      return { section, historyCount };
    case "local":
      return { section, localLoading, localError };
    case "downloads":
      return { section, downloadError };
    case "bili":
      return { section };
  }
}