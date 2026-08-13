export type LibraryQuickActionType = "openLikedPlaylist";

export interface LibraryQuickAction {
  action: LibraryQuickActionType;
  title: string;
  subtitle: string;
  disabled: boolean;
  coverUri?: string | null;
}

export interface BuildLibraryQuickActionsInput {
  isLoggedIn: boolean;
  likedPlaylistTrackCount: number | null;
  likedSongsCount: number;
  likedCoverUri?: string | null;
  historyCoverUri?: string | null;
}

function getLikedSubtitle(input: BuildLibraryQuickActionsInput): string {
  if (input.likedSongsCount > 0) {
    return `${input.likedSongsCount} 首歌曲`;
  }

  if (input.likedPlaylistTrackCount == null) {
    return input.isLoggedIn ? "同步中" : "登录后查看";
  }

  return `${input.likedPlaylistTrackCount} 首歌曲`;
}

export function buildLibraryQuickActions(input: BuildLibraryQuickActionsInput): LibraryQuickAction[] {
  const likedDisabled = input.likedPlaylistTrackCount == null && input.likedSongsCount === 0;

  return [
    {
      action: "openLikedPlaylist",
      title: "我喜欢",
      subtitle: getLikedSubtitle(input),
      disabled: likedDisabled,
      ...(input.likedCoverUri ? { coverUri: input.likedCoverUri } : {}),
    },
  ];
}
