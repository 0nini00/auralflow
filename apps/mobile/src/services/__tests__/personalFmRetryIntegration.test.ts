import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("personal FM retry integration", () => {
  it("offers an explicit retry action when mobile FM loading fails", () => {
    const source = readFileSync(resolve(process.cwd(), "src/screens/PersonalFmScreen.tsx"), "utf8");
    const screenStateSource = readFileSync(resolve(process.cwd(), "src/components/ScreenState.tsx"), "utf8");

    expect(source).toContain("const loadPreviewSongs = useCallback");
    expect(source).toContain("void loadPreviewSongs(() => mounted);");
    expect(source).toContain("const handleRetry = () => {");
    expect(source).toContain('<ErrorState message={error} onRetry={handleRetry} />');
    expect(screenStateSource).toContain("onPress={onRetry}");
    expect(screenStateSource).toContain(">重试</Text>");
  });
});
