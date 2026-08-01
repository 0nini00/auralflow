import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const playerBarPath = resolve(process.cwd(), "src/components/PlayerBar.tsx");
const source = existsSync(playerBarPath) ? readFileSync(playerBarPath, "utf8") : "";

describe("player bar integration", () => {
  it("exposes the mobile player bar capability set", () => {
    for (const token of [
      "formatTime(position)",
      "formatTime(duration)",
      "toggleMute",
      "startSleepTimer",
      "startSongSleepTimer",
      "cancelSleepTimer",
      "SoundEffectPanel",
    ]) {
      expect(source).toContain(token);
    }
  });

  it("uses Lucide controls and accessible touch targets", () => {
    for (const label of [
      "播放",
      "暂停",
      "更多",
      "静音",
    ]) {
      expect(source).toContain(`accessibilityLabel="${label}`);
    }
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
