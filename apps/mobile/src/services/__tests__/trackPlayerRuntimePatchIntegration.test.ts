import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("TrackPlayer Android runtime patch", () => {
  it("patches ReactHost event emission and null-intent service restarts", () => {
    const patchScript = readFileSync(
      resolve(process.cwd(), "apply-track-player-patch.js"),
      "utf8",
    );

    expect(patchScript).toContain("reactContext");
    expect(patchScript).toContain("intent == null");
    expect(patchScript).toContain("START_NOT_STICKY");
    expect(patchScript).toContain(
      "reactNativeHost.reactInstanceManager.currentReactContext",
    );
    expect(patchScript).toContain("split(from).join(to)");
  });
});
