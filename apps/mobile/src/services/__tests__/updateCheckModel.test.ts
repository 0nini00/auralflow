import { describe, expect, it } from "vitest";
import { getUpdateCheckStatus } from "@/services/updateCheckModel";

describe("update check model", () => {
  it("formats manual update check status for latest versions", () => {
    expect(getUpdateCheckStatus({
      hasUpdate: false,
      currentVersion: "0.1.0",
      latestVersion: "0.1.0",
      releaseUrl: "",
      releaseName: "0.1.0",
      changelog: "",
    })).toBe(
      "已是最新版本",
    );
  });

  it("formats manual update check status for available versions", () => {
    expect(getUpdateCheckStatus({
      hasUpdate: true,
      currentVersion: "0.1.0",
      latestVersion: "v0.2.0",
      releaseUrl: "https://example.test",
      releaseName: "AuralFlow Mobile 0.2.0",
      changelog: "",
    })).toBe(
      "发现新版本 v0.2.0",
    );
  });
});
