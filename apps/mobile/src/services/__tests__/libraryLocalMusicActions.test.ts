import { describe, expect, it } from "vitest";

import { buildLibraryLocalMusicActions } from "@/services/libraryLocalMusicActions";

describe("library local music actions", () => {
  it("uses scan copy before any local songs have been found", () => {
    expect(buildLibraryLocalMusicActions({ localSongCount: 0, loading: false })).toEqual({
      scanLabel: "扫描",
      scanAccessibilityLabel: "扫描本地音乐",
      scanHint: "扫描设备音乐库",
      importLabel: "添加文件",
      importAccessibilityLabel: "从文件选择器添加本地音乐",
      importHint: "手动选择音频文件加入曲库",
      disabled: false,
    });
  });

  it("uses refresh copy after local songs exist", () => {
    expect(buildLibraryLocalMusicActions({ localSongCount: 12, loading: false })).toEqual({
      scanLabel: "刷新",
      scanAccessibilityLabel: "刷新本地音乐",
      scanHint: "重新扫描设备音乐库",
      importLabel: "添加文件",
      importAccessibilityLabel: "从文件选择器添加本地音乐",
      importHint: "手动选择音频文件加入曲库",
      disabled: false,
    });
  });

  it("shows an in-progress label while scanning", () => {
    expect(buildLibraryLocalMusicActions({ localSongCount: 12, loading: true })).toMatchObject({
      scanLabel: "扫描中",
      scanAccessibilityLabel: "正在扫描本地音乐",
      importLabel: "添加中",
      disabled: true,
    });
  });
});
