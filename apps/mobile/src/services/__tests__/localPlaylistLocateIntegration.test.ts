import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("local playlist locate current song integration", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/screens/LocalPlaylistDetailScreen.tsx"),
    "utf8",
  );

  it("wires locate-current playback into local playlist details", () => {
    expect(source).toContain("type ScrollView as ScrollViewType");
    expect(source).toContain("const scrollRef = React.useRef<ScrollViewType>(null);");
    expect(source).toContain("const currentSong = usePlayerStore((state) => state.currentSong);");
    expect(source).toContain("const [locatedSongIndex, setLocatedSongIndex] = useState<number | null>(null);");
    expect(source).toContain("findPlaylistCurrentSongIndex(playlist.songs, currentSong)");
    expect(source).toContain("getContentDetailLocateScrollOffset(currentSongIndex)");
    expect(source).toContain("定位当前播放");
    expect(source).toContain("highlightedIndex={locatedSongIndex}");
  });
});
