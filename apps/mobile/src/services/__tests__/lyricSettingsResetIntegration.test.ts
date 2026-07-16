import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("lyric settings reset integration", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/screens/LyricSettingsScreen.tsx"),
    "utf8",
  );
  const storeSource = readFileSync(
    resolve(process.cwd(), "src/stores/lyricSettingsStore.ts"),
    "utf8",
  );

  it("exposes a mobile reset action from the lyric settings store", () => {
    expect(storeSource).toContain("DEFAULT_LYRIC_SETTINGS");
    expect(storeSource).toContain("resetSettings: () =>");
  });

  it("adds a lyrics style reset entry that calls the shared store action", () => {
    expect(source).toContain("const resetSettings = useLyricSettingsStore((s) => s.resetSettings);");
    expect(source).toContain("onPress={() => void resetSettings()}");
    expect(source).toContain("恢复默认样式");
  });
});
