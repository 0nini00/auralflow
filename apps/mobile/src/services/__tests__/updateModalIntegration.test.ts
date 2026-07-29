import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("mobile update modal integration", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/components/UpdateModal.tsx"),
    "utf8",
  );

  it("shows the current-to-latest version transition and release name", () => {
    expect(source).toContain("info.currentVersion");
    expect(source).toContain("info.latestVersion");
    expect(source).toContain("info.releaseName");
    expect(source).toContain("当前");
    expect(source).toContain("最新");
  });

  it("opens the release page from the mobile update dialog", () => {
    expect(source).toContain("info.releaseUrl");
    expect(source).toContain("打开发布页");
  });
});
