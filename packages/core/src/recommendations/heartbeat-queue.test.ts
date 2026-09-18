import { describe, expect, it } from "vitest";
import type { MusicInfo } from "../sources";
import {
  appendHeartbeatRefill,
  consumeHeartbeatNext,
  DEFAULT_HEARTBEAT_REFILL_THRESHOLD,
  shouldRefillHeartbeat,
} from "./heartbeat-queue";

const makeSong = (id: string, name = `Song ${id}`): MusicInfo => ({
  id,
  name,
  singer: "Singer",
  albumName: "Album",
  source: "wy" as const,
  interval: 180,
});

describe("shouldRefillHeartbeat", () => {
  it("buffer 长度低于默认阈值 (5) 时返回 true", () => {
    expect(shouldRefillHeartbeat(4)).toBe(true);
    expect(shouldRefillHeartbeat(0)).toBe(true);
  });

  it("buffer 长度大于等于阈值时返回 false", () => {
    expect(shouldRefillHeartbeat(5)).toBe(false);
    expect(shouldRefillHeartbeat(10)).toBe(false);
  });

  it("支持自定义阈值", () => {
    expect(shouldRefillHeartbeat(2, 3)).toBe(true);
    expect(shouldRefillHeartbeat(3, 3)).toBe(false);
  });
});

describe("consumeHeartbeatNext", () => {
  const s1 = makeSong("1");
  const s2 = makeSong("2");
  const s3 = makeSong("3");

  it("batch 内还有未播歌曲时直接切到 batch 下一首", () => {
    const result = consumeHeartbeatNext([s1, s2], 0, [s3]);
    expect(result.nextSong).toEqual(s2);
    expect(result.nextBatch).toEqual([s1, s2]);
    expect(result.nextBatchIndex).toBe(1);
    expect(result.nextBuffer).toEqual([s3]);
    expect(result.needsRefill).toBe(true); // buffer 只有 1 首，低于阈值 5
  });

  it("batch 播完时从 buffer 头部取一首追加到 batch", () => {
    const result = consumeHeartbeatNext([s1], 0, [s2, s3]);
    expect(result.nextSong).toEqual(s2);
    expect(result.nextBatch).toEqual([s1, s2]);
    expect(result.nextBatchIndex).toBe(1);
    expect(result.nextBuffer).toEqual([s3]);
  });

  it("batch 和 buffer 全空或无下一首时返回 null", () => {
    const result = consumeHeartbeatNext([s1], 0, []);
    expect(result.nextSong).toBeNull();
    expect(result.nextBatch).toEqual([s1]);
    expect(result.nextBatchIndex).toBe(0);
    expect(result.nextBuffer).toEqual([]);
    expect(result.needsRefill).toBe(true);
  });
});

describe("appendHeartbeatRefill", () => {
  const s1 = makeSong("1");
  const s2 = makeSong("2");
  const s3 = makeSong("3");
  const s4 = makeSong("4");

  it("去重追加新歌曲到 buffer", () => {
    const existing = new Set(["wy:1", "wy:2"]);
    const result = appendHeartbeatRefill([s2], [s2, s3, s4], existing);
    expect(result.addedCount).toBe(2);
    expect(result.nextBuffer.map((s) => s.id)).toEqual(["2", "3", "4"]);
  });

  it("全部重复时返回原 buffer", () => {
    const existing = new Set(["wy:1", "wy:2"]);
    const result = appendHeartbeatRefill([s1], [s1, s2], existing);
    expect(result.addedCount).toBe(0);
    expect(result.nextBuffer).toEqual([s1]);
  });
});
