import { describe, expect, it } from "vitest";
import { getLibraryContentModel } from "@/services/libraryContentModel";

describe("library content model", () => {
  it("models playlist content states", () => {
    expect(getLibraryContentModel({ section: "playlists", playlistLoading: true, isLoggedIn: true })).toEqual({
      kind: "playlistLoading",
      showClearHistory: false,
      showLocalScan: false,
      error: null,
    });
    expect(getLibraryContentModel({ section: "playlists", playlistLoading: false, isLoggedIn: false })).toEqual({
      kind: "playlistLoginRequired",
      emptyText: "登录后自动同步你的网易云歌单",
      showClearHistory: false,
      showLocalScan: false,
      error: null,
    });
    expect(getLibraryContentModel({ section: "playlists", playlistLoading: false, isLoggedIn: true })).toEqual({
      kind: "playlistList",
      emptyText: "还没有歌单，去网易云创建吧",
      showClearHistory: false,
      showLocalScan: false,
      error: null,
    });
  });

  it("models history and local song list states", () => {
    expect(getLibraryContentModel({ section: "history", historyCount: 0 })).toEqual({
      kind: "songList",
      songSource: "history",
      emptyText: "播放歌曲后会自动记录到这里",
      showClearHistory: false,
      showLocalScan: false,
      error: null,
    });
    expect(getLibraryContentModel({ section: "history", historyCount: 3 })).toMatchObject({
      kind: "songList",
      songSource: "history",
      showClearHistory: true,
    });
    expect(getLibraryContentModel({ section: "local", localLoading: false, localError: "扫描失败" })).toEqual({
      kind: "songList",
      songSource: "local",
      emptyText: "还没有扫描本地音乐",
      showClearHistory: false,
      showLocalScan: true,
      error: "扫描失败",
    });
  });

  it("models downloads and Bili content states", () => {
    expect(getLibraryContentModel({ section: "downloads", downloadError: "下载失败" })).toEqual({
      kind: "downloads",
      showClearHistory: false,
      showLocalScan: false,
      error: "下载失败",
    });
    expect(getLibraryContentModel({ section: "bili" })).toEqual({
      kind: "biliCollections",
      showClearHistory: false,
      showLocalScan: false,
      error: null,
    });
  });
});