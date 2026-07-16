import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildSongListMetadata,
  shouldShowSongListDownloadAction,
} from "@/services/songListMetadataModel";

/**
 * 行为契约：本地音乐元数据编辑集成。
 * - LibraryScreen 在 local 分区必须暴露编辑入口
 * - SongList 必须通过 model 函数控制下载按钮可见性（本地歌曲不显示）
 * - model 函数本身的纯逻辑行为通过调用验证
 */
describe("local music edit integration", () => {
  it("hides download action for local songs (model contract)", () => {
    expect(shouldShowSongListDownloadAction({ source: "wy" })).toBe(true);
    expect(shouldShowSongListDownloadAction({ source: "tx" })).toBe(true);
    expect(shouldShowSongListDownloadAction({ source: "local" })).toBe(false);
  });

  it("builds metadata parts for song list rows (model contract)", () => {
    const meta = buildSongListMetadata({
      id: "1",
      name: "Test",
      singer: "Alice",
      albumName: "Wonderland",
      source: "wy",
      interval: 215,
    } as any);

    expect(meta.artistName).toBe("Alice");
    expect(meta.albumName).toBe("Wonderland");
    expect(meta.durationLabel).toBe("3:35");
    expect(meta.metaParts).toEqual(["Alice", "Wonderland", "3:35"]);
  });

  it("wires local song editing into the LibraryScreen", () => {
    const source = readFileSync(resolve(process.cwd(), "src/screens/LibraryScreen.tsx"), "utf8");
    expect(source).toContain("updateLocalSongMetadata");
    expect(source).toContain("handleSaveLocalSongMetadata");
    expect(source).toContain("编辑本地音乐");
    expect(source).toContain("activeSection === \"local\"");
  });

  it("wires edit and download visibility through SongList", () => {
    const source = readFileSync(resolve(process.cwd(), "src/components/SongList.tsx"), "utf8");
    expect(source).toContain("buildSongListMetadata");
    expect(source).toContain("shouldShowSongListDownloadAction");
    expect(source).toContain("onEdit");
  });
});
