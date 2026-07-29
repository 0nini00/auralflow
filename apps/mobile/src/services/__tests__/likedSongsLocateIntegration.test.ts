import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("liked songs locate current song integration", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/screens/LikedSongsScreen.tsx"),
    "utf8",
  );

  it("wires locate-current playback into liked songs details", () => {
    expect(source).toContain("type ScrollView as ScrollViewType");
    expect(source).toContain("const scrollRef = React.useRef<ScrollViewType>(null);");
    expect(source).toContain("const currentSong = usePlayerStore((state) => state.currentSong);");
    expect(source).toContain("const [locatedSongIndex, setLocatedSongIndex] = React.useState<number | null>(null);");
    expect(source).toContain("findPlaylistCurrentSongIndex(likedSongs, currentSong)");
    expect(source).toContain("getContentDetailLocateScrollOffset(currentSongIndex)");
    expect(source).toContain("定位当前播放");
    expect(source).toContain("highlightedIndex={locatedSongIndex}");
  });
});
