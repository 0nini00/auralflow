import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("library screen local music integration", () => {
  it("uses the local music action model for scan and refresh copy", () => {
    const source = readFileSync(resolve(process.cwd(), "src/screens/LibraryScreen.tsx"), "utf8");

    expect(source).toContain("import { buildLibraryLocalMusicActions } from \"@/services/libraryLocalMusicActions\";");
    expect(source).toContain("const localMusicActions = buildLibraryLocalMusicActions({");
    expect(source).toContain("disabled={localMusicActions.disabled}");
    expect(source).toContain("accessibilityLabel={localMusicActions.scanAccessibilityLabel}");
    expect(source).toContain("accessibilityHint={localMusicActions.scanHint}");
    expect(source).toContain("{localMusicActions.scanLabel}");
    expect(source).not.toContain(">重新扫描</Text>");
  });
});
