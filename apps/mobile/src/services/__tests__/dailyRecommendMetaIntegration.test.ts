import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("daily recommend meta integration", () => {
  it("renders desktop-aligned update metadata on the mobile daily screen", () => {
    const source = readFileSync(resolve(process.cwd(), "src/screens/DailyRecommendScreen.tsx"), "utf8");

    expect(source).toContain("buildDailyRecommendMeta");
    expect(source).toContain("dailyMeta.title");
    expect(source).toContain("dailyMeta.subtitle");
  });
});
