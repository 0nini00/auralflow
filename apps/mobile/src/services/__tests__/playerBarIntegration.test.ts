import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const playerBarPath = resolve(process.cwd(), "src/components/PlayerBar.tsx");
const source = existsSync(playerBarPath) ? readFileSync(playerBarPath, "utf8") : "";

describe("player bar integration", () => {
  it("exposes the desktop player capability set on every width", () => {
    for (const token of [
      "seekTo",
      "formatTime(position)",
      "formatTime(duration)",
      "togglePlayMode",
      "playPrevious",
      "playNext",
      "toggleMute",
      "setVolume",
      "startSleepTimer",
      "startSongSleepTimer",
      "cancelSleepTimer",
      "AddToLocalPlaylistModal",
    ]) {
      expect(source).toContain(token);
    }
    expect(source).not.toContain("isTablet ?");
  });

  it("uses Lucide controls and accessible touch targets", () => {
    for (const label of [
      "播放模式",
      "上一首",
      "播放",
      "暂停",
      "下一首",
      "静音",
      "歌词",
      "定时关闭",
    ]) {
      expect(source).toContain(`accessibilityLabel="${label}`);
    }
    expect(source).not.toMatch(
      /[\u{1F500}\u{1F502}\u{1F501}\u{1F507}\u{1F50A}\u{23EE}\u{23ED}\u{23F8}\u{25B6}]/u,
    );
  });

  it("hides a restored overlay before clearing state when there is no song", () => {
    expect(source).toContain("if (currentSong || !overlayVisible) return;");
    expect(source).toContain("await hideLyricOverlay()");
    expect(source).toContain("await setOverlayVisible(false)");
    expect(source.indexOf("await hideLyricOverlay()")).toBeLessThan(
      source.indexOf("await setOverlayVisible(false)"),
    );
    expect(source).toContain("关闭悬浮歌词失败");

    const guardedOverlayEffects = source.match(
      /if \(!overlayVisible \|\| !currentSong\) return;/g,
    );
    expect(guardedOverlayEffects).toHaveLength(2);
  });
});
