import { describe, expect, it } from "vitest";
import { buildLibraryQuickActions } from "@/services/libraryQuickActions";

describe("library quick actions", () => {
  it("builds the liked and daily shortcuts", () => {
    const actions = buildLibraryQuickActions({
      isLoggedIn: false,
      likedPlaylistTrackCount: null,
      likedSongsCount: 0,
    });

    expect(actions.map((action) => action.action)).toEqual([
      "openLikedPlaylist",
      "openDailyRecommend",
    ]);
  });

  it("builds daily subtitle based on login state", () => {
    expect(buildLibraryQuickActions({
      isLoggedIn: false,
      likedPlaylistTrackCount: null,
      likedSongsCount: 0,
    })[1]).toMatchObject({ title: "每日推荐", subtitle: "登录后查看", disabled: false });

    expect(buildLibraryQuickActions({
      isLoggedIn: true,
      likedPlaylistTrackCount: null,
      likedSongsCount: 0,
    })[1]).toMatchObject({ subtitle: "根据你的口味" });
  });

  it("builds account-dependent liked subtitles", () => {
    expect(buildLibraryQuickActions({
      isLoggedIn: false,
      likedPlaylistTrackCount: null,
      likedSongsCount: 0,
    })[0]).toEqual({
      action: "openLikedPlaylist",
      title: "我喜欢",
      subtitle: "登录后查看",
      disabled: true,
    });

    expect(buildLibraryQuickActions({
      isLoggedIn: true,
      likedPlaylistTrackCount: null,
      likedSongsCount: 0,
    })[0]).toMatchObject({ subtitle: "同步中", disabled: true });

    const actions = buildLibraryQuickActions({
      isLoggedIn: true,
      likedPlaylistTrackCount: 12,
      likedSongsCount: 8,
    });
    expect(actions[0]).toMatchObject({ subtitle: "8 首歌曲", disabled: false });
  });

  it("opens liked songs from the local liked cache when no account liked playlist exists", () => {
    expect(buildLibraryQuickActions({
      isLoggedIn: false,
      likedPlaylistTrackCount: null,
      likedSongsCount: 3,
    })[0]).toEqual({
      action: "openLikedPlaylist",
      title: "我喜欢",
      subtitle: "3 首歌曲",
      disabled: false,
    });
  });

  it("attaches the liked cover when available", () => {
    const actions = buildLibraryQuickActions({
      isLoggedIn: true,
      likedPlaylistTrackCount: 3,
      likedSongsCount: 3,
      likedCoverUri: "https://img.test/liked.jpg",
    });

    expect(actions[0]).toMatchObject({
      action: "openLikedPlaylist",
      coverUri: "https://img.test/liked.jpg",
    });
  });
});
