import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("daily recommend cover integration", () => {
  it("renders a mobile daily cover from the first recommended song", () => {
    const source = readFileSync(resolve(process.cwd(), "src/screens/DailyRecommendScreen.tsx"), "utf8");

    expect(source).toContain("import { CachedImage } from \"@/components/CachedImage\";");
    expect(source).toContain("const dailyCoverUrl = songs[0]?.img || songs[0]?.picUrl;");
    expect(source).toContain("uri={dailyCoverUrl}");
    expect(source).toContain("styles.coverFallback");
  });
});
