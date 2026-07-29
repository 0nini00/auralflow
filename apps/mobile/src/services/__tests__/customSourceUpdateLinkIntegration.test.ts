import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("custom source update link integration", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/screens/CustomSourceScreen.tsx"),
    "utf8",
  );

  it("opens the custom source update URL from the mobile source card", () => {
    expect(source).toContain("Linking,");
    expect(source).toContain("onOpenUpdateUrl: () => void;");
    expect(source).toContain("onOpenUpdateUrl={() => openCustomSourceUpdateUrl(source.updateUrl)}");
    expect(source).toContain("void Linking.openURL(updateUrl);");
    expect(source).toContain("打开更新地址");
  });
});
