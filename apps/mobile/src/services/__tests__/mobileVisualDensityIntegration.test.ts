import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

describe("mobile visual density", () => {
  it("uses desktop-aligned geometry without an outer phone card", () => {
    const tokens = read("src/theme/tokens.ts");
    const scaffold = read("src/components/ScreenScaffold.tsx");
    const header = read("src/components/AppHeader.tsx");

    expect(tokens).toContain("pagePadding: 16");
    expect(tokens).toContain("songRowMinHeight: 60");
    expect(tokens).toContain("artworkSize: 48");
    expect(tokens).toContain("tablet: 768");
    expect(scaffold).not.toContain("borderRadius: radius.xl");
    expect(scaffold).toContain("paddingHorizontal: layout.pagePadding");
    expect(header).toContain("minHeight: layout.headerHeight");
  });

  it("keeps accessible icon targets while using compact visual icons", () => {
    const tokens = read("src/theme/tokens.ts");
    const sidebar = read("src/components/AppSidebar.tsx");

    expect(tokens).toContain("minTarget: 44");
    expect(sidebar).toContain("minHeight: touch.minTarget");
  });
});
