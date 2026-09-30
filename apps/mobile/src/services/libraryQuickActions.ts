export type LibraryQuickActionType =
  | "openLikedPlaylist"
  | "openFollowedArtists"
  | "openSubscribedAlbums"
  | "openListeningStats";

export interface LibraryQuickAction {
  action: LibraryQuickActionType;
  title: string;
  subtitle: string;
  coverUri?: string | null;
}

export interface BuildLibraryQuickActionsInput {
  favoritesCount: number;
  likedCoverUri?: string | null;
  historyCoverUri?: string | null;
  /**
   * 网易云登录态。关注歌手 / 收藏专辑完全由网易云账号提供：
   * 未登录时**不产出**这两个入口（此前是置灰 +「登录网易云查看」副标题）。
   */
  isWyLoggedIn?: boolean;
}

export function buildLibraryQuickActions(input: BuildLibraryQuickActionsInput): LibraryQuickAction[] {
  const wyAccountActions: LibraryQuickAction[] = input.isWyLoggedIn
    ? [
        {
          action: "openFollowedArtists",
          title: "关注歌手",
          subtitle: "网易云关注列表",
        },
        {
          action: "openSubscribedAlbums",
          title: "收藏专辑",
          subtitle: "网易云收藏列表",
        },
      ]
    : [];

  return [
    {
      action: "openLikedPlaylist",
      title: "我喜欢",
      // 本地收藏（对齐桌面端）：与登录态无关，空态也能进页面看引导
      subtitle: input.favoritesCount > 0 ? `${input.favoritesCount} 首歌曲` : "还没有喜欢的歌曲",
      ...(input.likedCoverUri ? { coverUri: input.likedCoverUri } : {}),
    },
    ...wyAccountActions,
    {
      action: "openListeningStats",
      title: "听歌统计",
      // 本地播放记录统计：与登录态无关
      subtitle: "总时长、Top 歌曲与听歌趋势",
    },
  ];
}
