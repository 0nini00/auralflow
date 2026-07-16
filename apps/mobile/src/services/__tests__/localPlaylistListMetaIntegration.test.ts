import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("local playlist list meta integration", () => {
  it("renders desktop-aligned update metadata in the local playlist list", () => {
    const source = readFileSync(resolve(process.cwd(), "src/components/LocalPlaylistList.tsx"), "utf8");

    expect(source).toContain("buildLocalPlaylistListMeta");
    expect(source).toContain("const metaText = buildLocalPlaylistListMeta(playlist);");
    expect(source).toContain("{metaText}");
  });
});
