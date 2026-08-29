export type LibraryQuickActionType = "openLikedPlaylist";

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
  ];
}
