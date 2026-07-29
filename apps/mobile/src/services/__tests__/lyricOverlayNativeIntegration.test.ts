import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const nativeOverlay = vi.hoisted(() => ({
  canDrawOverlays: vi.fn(),
  requestOverlayPermission: vi.fn(),
  show: vi.fn(),
  hide: vi.fn(),
  update: vi.fn(),
  setLocked: vi.fn(),
}));

vi.mock("react-native", () => ({
  NativeModules: { LyricOverlayModule: nativeOverlay },
  Platform: { OS: "android" },
}));

import { showLyricOverlay } from "@/services/lyricOverlayService";

const read = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

const typescriptService = read("src/services/lyricOverlayService.ts");
const javaModule = read(
  "android/app/src/main/java/cn/chenle/auralflow/mobile/LyricOverlayModule.java",
);
const javaService = read(
  "android/app/src/main/java/cn/chenle/auralflow/mobile/LyricOverlayService.java",
);
const manifest = read("android/app/src/main/AndroidManifest.xml");

describe("lyric overlay native integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps one promise-based method contract across TypeScript and Java", () => {
    for (const signature of [
      /public void canDrawOverlays\(Promise \w+\)/,
      /public void requestOverlayPermission\(Promise \w+\)/,
      /public void show\(Promise \w+\)/,
      /public void hide\(Promise \w+\)/,
      /public void update\(ReadableMap \w+, Promise \w+\)/,
      /public void setLocked\(boolean \w+, Promise \w+\)/,
    ]) {
      expect(javaModule).toMatch(signature);
    }

    expect(typescriptService).not.toMatch(/\bcatch\b/);
    expect(typescriptService).toContain("throw new Error");
  });

  it("settles package-scoped permission requests from the activity result", () => {
    expect(javaModule).toContain("Settings.ACTION_MANAGE_OVERLAY_PERMISSION");
    expect(javaModule).toContain('Uri.parse("package:" + context.getPackageName())');
    expect(javaModule).toContain("onActivityResult");
    expect(javaModule).toContain("Settings.canDrawOverlays(context)");
    for (const errorCode of [
      "E_OVERLAY_NO_ACTIVITY",
      "E_OVERLAY_REQUEST_PENDING",
      "E_OVERLAY_PERMISSION_LAUNCH",
    ]) {
      expect(javaModule).toContain(errorCode);
    }
  });

  it("registers one service that updates two lines, progress, lock state, and dragging", () => {
    expect(manifest).toMatch(
      /<service\s+android:name="\.LyricOverlayService"\s+android:exported="false"\s*\/>/,
    );
    for (const token of [
      "EXTRA_CURRENT",
      "EXTRA_NEXT",
      "EXTRA_PROGRESS",
      "EXTRA_LOCKED",
      "FLAG_NOT_TOUCHABLE",
      "setOnTouchListener",
      "updateViewLayout",
    ]) {
      expect(javaService).toContain(token);
    }
  });

  it("settles each operation from the real service result with errors and a timeout", () => {
    for (const token of [
      "ResultReceiver",
      "EXTRA_RESULT_RECEIVER",
      "OVERLAY_OPERATION_TIMEOUT_MS",
      "E_OVERLAY_OPERATION_TIMEOUT",
      "compareAndSet(false, true)",
    ]) {
      expect(javaModule).toContain(token);
    }
    for (const token of [
      "sendSuccess",
      "sendFailure",
      "E_OVERLAY_PERMISSION_REVOKED",
      "E_OVERLAY_WINDOW_SHOW",
      "E_OVERLAY_WINDOW_UPDATE",
      "E_OVERLAY_WINDOW_LOCK",
      "E_OVERLAY_WINDOW_HIDE",
    ]) {
      expect(javaService).toContain(token);
    }

    expect(javaService).toMatch(/ensureWindow\(\);\s+sendSuccess\(receiver\)/);
    expect(javaService).toMatch(/applyLockedState\(\);\s+sendSuccess\(receiver\)/);
    expect(javaService).toMatch(/removeOverlayWindow\(\);\s+sendSuccess\(receiver\)/);
  });

  it("uses a legacy alert window on API 24 and 25", () => {
    expect(javaService).toContain("Build.VERSION.SDK_INT >= Build.VERSION_CODES.O");
    expect(javaService).toContain("WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY");
    expect(javaService).toContain("WindowManager.LayoutParams.TYPE_SYSTEM_ALERT");
  });

  it("propagates native bridge failures instead of returning a silent false", async () => {
    nativeOverlay.show.mockRejectedValueOnce(new Error("native show failed"));

    await expect(showLyricOverlay()).rejects.toThrow("native show failed");
  });
});
