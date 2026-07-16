import { describe, expect, it } from "vitest";
import {
  LIBRARY_SECTIONS,
  getLibrarySectionHeader,
  getLibrarySectionTabLabel,
} from "@/services/librarySectionModel";

describe("library section model", () => {
  it("defines section order", () => {
    expect(LIBRARY_SECTIONS).toEqual(["playlists", "history", "local", "downloads", "bili"]);
  });

  it("builds tab labels with counts only when counts are positive", () => {
    expect(getLibrarySectionTabLabel("playlists", { count: 0 })).toBe("我的歌单");
    expect(getLibrarySectionTabLabel("playlists", { count: 3 })).toBe("我的歌单 (3)");
    expect(getLibrarySectionTabLabel("history", { count: 12 })).toBe("播放历史");
    expect(getLibrarySectionTabLabel("local", { count: 8 })).toBe("本地音乐 (8)");
    expect(getLibrarySectionTabLabel("downloads", { count: 2 })).toBe("下载 (2)");
    expect(getLibrarySectionTabLabel("bili", { count: 4 })).toBe("B站合集 (4)");
  });

  it("builds playlist section header by login state", () => {
    expect(getLibrarySectionHeader({ section: "playlists", isLoggedIn: false, playlistCount: 0 })).toEqual({
      title: "我的歌单",
      caption: "登录后同步网易云歌单",
    });
    expect(getLibrarySectionHeader({ section: "playlists", isLoggedIn: true, playlistCount: 0 })).toEqual({
      title: "我的歌单",
      caption: "暂无歌单",
    });
    expect(getLibrarySectionHeader({ section: "playlists", isLoggedIn: true, playlistCount: 2 })).toEqual({
      title: "我的歌单",
      caption: "2 个歌单",
    });
  });

  it("builds non-playlist section headers", () => {
    expect(getLibrarySectionHeader({ section: "history", historyCount: 0 })).toEqual({
      title: "播放历史",
      caption: "还没有播放记录",
    });
    expect(getLibrarySectionHeader({ section: "history", historyCount: 5 })).toEqual({
      title: "播放历史",
      caption: "最近播放的 5 首歌曲",
    });
    expect(getLibrarySectionHeader({ section: "local", localLoading: true, localSongCount: 0 })).toEqual({
      title: "本地音乐",
      caption: "正在扫描本地音乐",
    });
    expect(getLibrarySectionHeader({ section: "local", localLoading: false, localSongCount: 0 })).toEqual({
      title: "本地音乐",
      caption: "点击上方快捷入口扫描本地音乐",
    });
    expect(getLibrarySectionHeader({ section: "local", localLoading: false, localSongCount: 7 })).toEqual({
      title: "本地音乐",
      caption: "7 首本地歌曲",
    });
    expect(getLibrarySectionHeader({ section: "bili", hasBiliAccount: false, biliCollectionCount: 0 })).toEqual({
      title: "B站合集",
      caption: "粘贴 Cookie 登录后同步 B站合集",
    });
    expect(getLibrarySectionHeader({ section: "bili", hasBiliAccount: true, biliCollectionCount: 0 })).toEqual({
      title: "B站合集",
      caption: "暂无可见合集",
    });
    expect(getLibrarySectionHeader({ section: "bili", hasBiliAccount: true, biliCollectionCount: 3 })).toEqual({
      title: "B站合集",
      caption: "3 个合集",
    });
    expect(getLibrarySectionHeader({ section: "downloads", downloadsLoading: true, downloadCount: 0 })).toEqual({
      title: "下载管理",
      caption: "正在加载下载记录",
    });
    expect(getLibrarySectionHeader({ section: "downloads", downloadsLoading: false, downloadCount: 0 })).toEqual({
      title: "下载管理",
      caption: "从歌曲列表下载后会出现在这里",
    });
    expect(getLibrarySectionHeader({ section: "downloads", downloadsLoading: false, downloadCount: 6 })).toEqual({
      title: "下载管理",
      caption: "6 首已下载",
    });
  });
});