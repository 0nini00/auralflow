import { describe, expect, it } from "vitest";
import { runPlaybackUiAction } from "@/services/playbackUiAction";

describe("playback UI action", () => {
  it("returns success only after the action resolves", async () => {
    await expect(
      runPlaybackUiAction(() => Promise.resolve()),
    ).resolves.toEqual({ ok: true });
  });

  it("preserves the thrown playback message", async () => {
    await expect(
      runPlaybackUiAction(() => Promise.reject(new Error("TrackPlayer failed"))),
    ).resolves.toEqual({ ok: false, message: "TrackPlayer failed" });
  });
});
