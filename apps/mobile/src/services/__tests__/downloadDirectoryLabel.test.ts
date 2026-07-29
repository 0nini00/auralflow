import { describe, expect, it } from "vitest";

import { formatDownloadDirectoryLabel } from "@/services/downloadDirectoryModel";

describe("formatDownloadDirectoryLabel", () => {
  it("keeps short paths intact", () => {
    expect(formatDownloadDirectoryLabel("/data/auralflow/downloads")).toBe(
      "…/auralflow/downloads",
    );
  });

  it("shortens long sandbox paths around auralflow/downloads", () => {
    const path =
      "/data/user/0/cn.chenle.auralflow.mobile/files/auralflow/downloads";
    expect(formatDownloadDirectoryLabel(path)).toBe("…/auralflow/downloads");
  });

  it("falls back to trailing slice when marker is missing", () => {
    const path = "x".repeat(60);
    expect(formatDownloadDirectoryLabel(path).startsWith("…")).toBe(true);
    expect(formatDownloadDirectoryLabel(path).length).toBeLessThanOrEqual(46);
  });

  it("handles empty path", () => {
    expect(formatDownloadDirectoryLabel("")).toBe("未就绪");
  });
});
