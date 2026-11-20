import { describe, expect, it } from "vitest";
import {
  PREVIEW_ESTIMATE_BITRATE_KBPS,
  estimateStreamDurationSeconds,
  isPreviewDuration,
  isPreviewStream,
} from "./stream-integrity";

/** 按时长与码率算完整文件字节数。 */
function bytesFor(seconds: number, bitrateKbps: number): number {
  return (seconds * bitrateKbps * 1000) / 8;
}

describe("isPreviewStream", () => {
  it("按最低真实码率估算，完整的 96k 文件不会被当成试听", () => {
    // QQ/网易云对无权限或降级回退返回 96k 完整文件；请求档位是 flac。
    const totalBytes = bytesFor(223, 96);
    expect(
      isPreviewStream({ totalBytes, quality: "flac", expectedDurationSeconds: 223 }),
    ).toBe(false);
    expect(
      isPreviewStream({ totalBytes, quality: "flac", expectedDurationSeconds: 223, mode: "playback" }),
    ).toBe(false);
  });

  it.each([
    ["320k", 320],
    ["flac", 900],
  ] as const)("下载按已解析的 %s 档位识别 30s 试听", (quality, bitrateKbps) => {
    expect(isPreviewStream({
      totalBytes: bytesFor(30, bitrateKbps),
      quality,
      expectedDurationSeconds: 200,
      mode: "download",
    })).toBe(true);
  });

  it("下载完整文件和短歌仍可通过标称码率校验", () => {
    for (const seconds of [200, 45]) {
      expect(isPreviewStream({
        totalBytes: bytesFor(seconds, 320),
        quality: "320k",
        expectedDurationSeconds: seconds,
        mode: "download",
      })).toBe(false);
    }
  });

  it("真正的 30s 试听片段仍会被识别", () => {
    const totalBytes = bytesFor(30, 128);
    expect(
      isPreviewStream({ totalBytes, quality: "flac", expectedDurationSeconds: 200 }),
    ).toBe(true);
  });

  it("短歌不因期望时长短被误判", () => {
    const totalBytes = bytesFor(45, 96);
    expect(
      isPreviewStream({ totalBytes, quality: "flac", expectedDurationSeconds: 45 }),
    ).toBe(false);
  });

  it("缺 expectedDurationSeconds / totalBytes 时不做判定", () => {
    expect(
      isPreviewStream({ totalBytes: bytesFor(30, 96), quality: "flac" }),
    ).toBe(false);
    expect(
      isPreviewStream({ totalBytes: null, quality: "flac", expectedDurationSeconds: 200 }),
    ).toBe(false);
  });

  it("估算码率下限覆盖标称档位（96kbps）", () => {
    const totalBytes = 1_000_000;
    const conservative = estimateStreamDurationSeconds(
      totalBytes,
      "flac24bit",
      PREVIEW_ESTIMATE_BITRATE_KBPS,
    );
    const nominal = estimateStreamDurationSeconds(totalBytes, "flac24bit");
    expect(conservative).toBeCloseTo((totalBytes * 8) / (96 * 1000));
    expect(conservative).toBeGreaterThan(nominal ?? 0);
  });
});

describe("isPreviewDuration", () => {
  it("播放器实际时长明显短于期望时判试听", () => {
    expect(isPreviewDuration({ actualDurationSeconds: 30, expectedDurationSeconds: 200 })).toBe(true);
  });

  it("实际时长达标或缺失时放行", () => {
    expect(isPreviewDuration({ actualDurationSeconds: 195, expectedDurationSeconds: 200 })).toBe(false);
    expect(isPreviewDuration({ actualDurationSeconds: null, expectedDurationSeconds: 200 })).toBe(false);
  });
});
