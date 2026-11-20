import { describe, expect, it } from "vitest";
import { assessPlaybackCandidate } from "./index";

describe("候选可播放性判定", () => {
  it("明确死链被拒绝并保留原始原因", () => {
    expect(assessPlaybackCandidate({ probe: { ok: false, definitive: true, reason: "HTTP 404" } }))
      .toEqual({ status: "rejected", reason: "HTTP 404" });
  });
  it("522及网络超时保持不确定，不冒充已经验证成功", () => {
    expect(assessPlaybackCandidate({ probe: { ok: false, definitive: false, reason: "HTTP 522" } }))
      .toEqual({ status: "uncertain", reason: "HTTP 522" });
  });
  it("HTTP成功但只有30秒试听时拒绝", () => {
    expect(assessPlaybackCandidate({ probe: { ok: true, totalBytes: 360000 }, quality: "flac", expectedDurationSeconds: 240 }).status)
      .toBe("rejected");
  });
  it("完整低码率歌曲不会因请求flac被误判为试听", () => {
    expect(assessPlaybackCandidate({ probe: { ok: true, totalBytes: 2880000 }, quality: "flac", expectedDurationSeconds: 240 }))
      .toEqual({ status: "verified" });
  });
  it("缺少大小或歌曲时长时不捏造试听结论", () => {
    expect(assessPlaybackCandidate({ probe: { ok: true }, expectedDurationSeconds: 240 })).toEqual({ status: "verified" });
    expect(assessPlaybackCandidate({ probe: { ok: true, totalBytes: 360000 } })).toEqual({ status: "verified" });
  });
  it("下载仍按实际音质严格识别过短的资源", () => {
    expect(assessPlaybackCandidate({ probe: { ok: true, totalBytes: 2880000 }, quality: "flac", expectedDurationSeconds: 240, mode: "download" }).status)
      .toBe("rejected");
  });
});
