import { isPreviewStream } from "./stream-integrity";

export type PlaybackProbeResult =
  | { ok: true; totalBytes?: number }
  | { ok: false; reason: string; definitive: boolean };

export type PlaybackCandidateAssessment =
  | { status: "verified" }
  | { status: "uncertain"; reason: string }
  | { status: "rejected"; reason: string };

/** 网关和脚本共用同一判定；探活不确定与明确拒绝不能合并为“成功”或“死链”。 */
export function assessPlaybackCandidate(options: {
  probe: PlaybackProbeResult;
  quality?: unknown;
  expectedDurationSeconds?: number | null;
  mode?: "playback" | "download";
}): PlaybackCandidateAssessment {
  const { probe } = options;
  if (!probe.ok) {
    return { status: probe.definitive ? "rejected" : "uncertain", reason: probe.reason };
  }
  if (isPreviewStream({ ...options, totalBytes: probe.totalBytes })) {
    return { status: "rejected", reason: "解析到试听片段" };
  }
  return { status: "verified" };
}
