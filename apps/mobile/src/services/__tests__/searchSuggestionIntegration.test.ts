import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readMobileSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("search suggestion integration", () => {
  it("renders playlist suggestions with the playlist type label", () => {
    const source = readMobileSource("src/screens/SearchScreen.tsx");

    expect(source).toContain("suggestion.type === \"playlist\"");
    expect(source).toContain("? \"歌单\"");
  });
});
