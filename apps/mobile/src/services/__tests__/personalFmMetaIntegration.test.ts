import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("personal FM meta integration", () => {
  it("renders desktop-aligned account metadata on the mobile FM screen", () => {
    const source = readFileSync(resolve(process.cwd(), "src/screens/PersonalFmScreen.tsx"), "utf8");

    expect(source).toContain("buildPersonalFmMeta");
    expect(source).toContain("const user = useAccountStore((state) => state.user);");
    expect(source).toContain("const personalFmMeta = buildPersonalFmMeta(isLoggedIn, user);");
    expect(source).toContain("personalFmMeta.title");
    expect(source).toContain("personalFmMeta.subtitle");
  });
});
