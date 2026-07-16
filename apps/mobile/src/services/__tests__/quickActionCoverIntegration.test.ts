import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("quick action cover integration", () => {
  it("passes liked and history covers into mobile quick action cards", () => {
    const screenSource = readFileSync(resolve(process.cwd(), "src/screens/LibraryScreen.tsx"), "utf8");
    const cardSource = readFileSync(resolve(process.cwd(), "src/components/QuickActionCard.tsx"), "utf8");

    expect(screenSource).toContain("likedCoverUri: likedSongs[0]?.img || likedSongs[0]?.picUrl || null");
    expect(screenSource).toContain("historyCoverUri: history[0]?.img || history[0]?.picUrl || null");
    expect(screenSource).toContain("coverUri={action.coverUri}");
    expect(cardSource).toContain("import { CachedImage } from \"@/components/CachedImage\";");
    expect(cardSource).toContain("coverUri?: string | null;");
    expect(cardSource).toContain("{coverUri ? (");
  });
});
