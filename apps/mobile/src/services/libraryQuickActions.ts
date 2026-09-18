export type LibraryQuickActionType =
  | "openLikedPlaylist"
  | "openFollowedArtists"
  | "openSubscribedAlbums";

export interface LibraryQuickAction {
  action: LibraryQuickActionType;
  title: string;
  subtitle: string;
  disabled: boolean;
  coverUri?: string | null;
}

export interface BuildLibraryQuickActionsInput {
  favoritesCount: number;
  likedCoverUri?: string | null;
  historyCoverUri?: string | null;
  isWyLoggedIn?: boolean;
}

export function buildLibraryQuickActions(input: BuildLibraryQuickActionsInput): LibraryQuickAction[] {
  return [
    {
      action: "openLikedPlaylist",
      title: "我喜欢",
      // 本地收藏（对齐桌面端）：与登录态无关，空态也能进页面看引导
      subtitle: input.favoritesCount > 0 ? `${input.favoritesCount} 首歌曲` : "还没有喜欢的歌曲",
      disabled: false,
      ...(input.likedCoverUri ? { coverUri: input.likedCoverUri } : {}),
    },
    {
      action: "openFollowedArtists",
      title: "关注歌手",
      subtitle: input.isWyLoggedIn ? "网易云关注列表" : "登录网易云查看",
      disabled: !input.isWyLoggedIn,
    },
    {
      action: "openSubscribedAlbums",
      title: "收藏专辑",
      subtitle: input.isWyLoggedIn ? "网易云收藏列表" : "登录网易云查看",
      disabled: !input.isWyLoggedIn,
    },
  ];
}
