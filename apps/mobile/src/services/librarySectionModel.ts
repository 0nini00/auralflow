export type LibrarySection = "playlists" | "history" | "local" | "downloads" | "bili";

export interface LibrarySectionHeader {
  title: string;
  caption: string;
}

export type LibrarySectionHeaderInput =
  | { section: "playlists"; isLoggedIn: boolean; playlistCount: number }
  | { section: "history"; historyCount: number }
  | { section: "local"; localLoading: boolean; localSongCount: number }
  | { section: "downloads"; downloadsLoading: boolean; downloadCount: number }
  | { section: "bili"; hasBiliAccount: boolean; biliCollectionCount: number };

export const LIBRARY_SECTIONS: LibrarySection[] = ["playlists", "history", "local", "downloads", "bili"];

const SECTION_TITLES: Record<LibrarySection, string> = {
  playlists: "我的歌单",
  history: "播放历史",
  local: "本地音乐",
  downloads: "下载管理",
  bili: "B站合集",
};

const TAB_LABELS: Record<LibrarySection, string> = {
  playlists: "我的歌单",
  history: "播放历史",
  local: "本地音乐",
  downloads: "下载",
  bili: "B站合集",
};

export function getLibrarySectionTabLabel(section: LibrarySection, { count }: { count: number }): string {
  const label = TAB_LABELS[section];
  if (section === "history" || count <= 0) return label;
  return `${label} (${count})`;
}

export function getLibrarySectionHeader(input: LibrarySectionHeaderInput): LibrarySectionHeader {
  switch (input.section) {
    case "playlists":
      return {
        title: SECTION_TITLES.playlists,
        caption: input.isLoggedIn
          ? input.playlistCount === 0
            ? "暂无歌单"
            : `${input.playlistCount} 个歌单`
          : "登录后同步网易云歌单",
      };
    case "history":
      return {
        title: SECTION_TITLES.history,
        caption: input.historyCount === 0 ? "还没有播放记录" : `最近播放的 ${input.historyCount} 首歌曲`,
      };
    case "local":
      return {
        title: SECTION_TITLES.local,
        caption: input.localLoading
          ? "正在扫描本地音乐"
          : input.localSongCount === 0
          ? "点击上方快捷入口扫描本地音乐"
          : `${input.localSongCount} 首本地歌曲`,
      };
    case "bili":
      return {
        title: SECTION_TITLES.bili,
        caption: input.hasBiliAccount
          ? input.biliCollectionCount === 0
            ? "暂无可见合集"
            : `${input.biliCollectionCount} 个合集`
          : "粘贴 Cookie 登录后同步 B站合集",
      };
    case "downloads":
      return {
        title: SECTION_TITLES.downloads,
        caption: input.downloadCount === 0
          ? input.downloadsLoading
            ? "正在加载下载记录"
            : "从歌曲列表下载后会出现在这里"
          : `${input.downloadCount} 首已下载`,
      };
  }
}