import { afterEach, describe, expect, it, vi } from "vitest";
import { checkForUpdates, CURRENT_VERSION } from "@/services/updateService";

describe("mobile update service", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws when the latest release request fails", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({
      ok: false,
      status: 503,
      json: vi.fn(),
    })));

    await expect(checkForUpdates()).rejects.toThrow("检查更新失败: HTTP 503");
  });

  it("throws when the latest release cannot be fetched", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("network down"))));

    await expect(checkForUpdates()).rejects.toThrow("network down");
  });

  it("keeps current version, latest version and release name for update dialogs", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: vi.fn(() => Promise.resolve({
        tag_name: "v0.2.0",
        html_url: "https://example.test/releases/v0.2.0",
        name: "AuralFlow Mobile 0.2.0",
        body: "更新日志",
      })),
    })));

    await expect(checkForUpdates()).resolves.toEqual({
      hasUpdate: true,
      currentVersion: CURRENT_VERSION,
      latestVersion: "v0.2.0",
      releaseUrl: "https://example.test/releases/v0.2.0",
      releaseName: "AuralFlow Mobile 0.2.0",
      changelog: "更新日志",
    });
  });
});
