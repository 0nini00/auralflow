import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => {
  const absolutePath = resolve(process.cwd(), path);
  return existsSync(absolutePath) ? readFileSync(absolutePath, "utf8") : "";
};

describe("app header integration", () => {
  it("renders menu, back, and forward together", () => {
    const source = read("src/components/AppHeader.tsx");

    expect(source).toContain("Menu");
    expect(source).toContain("ChevronLeft");
    expect(source).toContain("ChevronRight");
    expect(source).toContain('accessibilityLabel="打开菜单"');
    expect(source).toContain('accessibilityLabel="后退"');
    expect(source).toContain('accessibilityLabel="前进"');
    expect(source).not.toContain("leftAction");
  });

  it("uses history availability for disabled states", () => {
    const source = read("src/components/AppHeader.tsx");

    expect(source).toContain("disabled={!canGoBack}");
    expect(source).toContain("disabled={!canGoForward}");
    expect(source).toContain("onPress={onGoBack}");
    expect(source).toContain("onPress={onGoForward}");
  });

  it("uses the minimum touch target", () => {
    const source = read("src/components/AppHeader.tsx");

    expect(source).toContain("minWidth: touch.minTarget");
    expect(source).toContain("minHeight: touch.minTarget");
  });
});
