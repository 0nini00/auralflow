import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const screens = [
  "SearchScreen.tsx",
  "DailyRecommendScreen.tsx",
  "LibraryScreen.tsx",
  "HomeScreen.tsx",
  "ArtistDetailScreen.tsx",
  "AlbumDetailScreen.tsx",
  "PlaylistDetailScreen.tsx",
  "LocalPlaylistDetailScreen.tsx",
  "BiliCollectionDetailScreen.tsx",
  "LikedSongsScreen.tsx",
  "SearchFallbackDetailScreen.tsx",
  "DownloadScreen.tsx",
] as const;

describe("playback UI integration", () => {
  it.each(screens)("routes %s playback through an explicit result", (screen) => {
    const source = readFileSync(
      resolve(process.cwd(), "src/screens", screen),
      "utf8",
    );

    expect(source).toContain("runPlaybackUiAction");
    expect(source).toContain("if (!result.ok)");
    expect(source).toContain("<PlaybackErrorState");
  });

  it.each(screens)("does not navigate before %s starts playback", (screen) => {
    const source = readFileSync(
      resolve(process.cwd(), "src/screens", screen),
      "utf8",
    );
    const navigateIndex = source.indexOf("onNavigateToPlayer();");
    const resultIndex = source.indexOf("if (!result.ok)");

    expect(navigateIndex).toBeGreaterThan(resultIndex);
  });

  it("keeps inline download playback failures visible", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/components/DownloadList.tsx"),
      "utf8",
    );

    expect(source).toContain("runPlaybackUiAction");
    expect(source).toContain("if (!result.ok)");
    expect(source).toContain("<PlaybackErrorState");
  });
});
