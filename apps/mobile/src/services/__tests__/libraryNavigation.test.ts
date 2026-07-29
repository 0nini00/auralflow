import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/screens/LibraryScreen.tsx"), "utf8");

describe("library root navigation integration", () => {
  it("does not render detail screens from local sub-route state", () => {
    expect(source).not.toContain("subRoute");
    expect(source).not.toContain("setSubRoute");
    expect(source).not.toContain("<PlaylistDetailScreen");
    expect(source).not.toContain("<LocalPlaylistDetailScreen");
    expect(source).not.toContain("<BiliCollectionDetailScreen");
    expect(source).not.toContain("<LikedSongsScreen");
  });

  it("opens every detail through Root navigation helpers", () => {
    expect(source).toContain("openPlaylistDetailScreen");
    expect(source).toContain("openLocalPlaylistDetailScreen");
    expect(source).toContain("openBiliCollectionDetailScreen");
    expect(source).toContain("openLikedSongsScreen");
    expect(source).toContain("openDailyRecommendScreen");
  });
});
