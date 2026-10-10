import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MusicInfo } from "@lx/core";

// 只测纯逻辑：把 store / 桥接挡掉，避免把引擎与 Tauri 运行时拖进测试。
vi.mock("@lx/tauri-bridge", () => ({
  libraryLoad: vi.fn(async () => null),
  librarySave: vi.fn(async () => undefined),
  libraryReset: vi.fn(async () => undefined),
}));
vi.mock("../src/stores/playerStore", () => ({
  usePlayerStore: Object.assign(() => undefined, {
    getState: () => ({}),
    subscribe: () => () => undefined,
  }),
}));

import {
  PROGRESS_SAVE_STEP_SECONDS,
  applyPlaybackSession,
  parsePlaybackSession,
  shouldPersistPlaybackSession,
} from "../src/stores/playerPersistence";
import { clearResumeTarget, takeResumeProgress } from "../src/stores/playerResumeTarget";

type State = Parameters<typeof shouldPersistPlaybackSession>[0];

function track(id: string): MusicInfo {
  return { id, source: "wy", name: `歌曲 ${id}`, singer: "歌手" } as MusicInfo;
}

function state(partial: Record<string, unknown>): State {
  return partial as unknown as State;
}

function base() {
  return state({
    current: track("a"),
    queue: [track("a")],
    currentIndex: 0,
    progress: 12,
    duration: 200,
    repeatMode: "all",
    isShuffle: false,
    playbackRate: 1,
    status: "playing",
  });
}

describe("播放会话读盘校验", () => {
  it("形状不对就整份丢弃", () => {
    expect(parsePlaybackSession(null)).toBeNull();
    expect(parsePlaybackSession("nope")).toBeNull();
    // 既没有当前曲也没有队列：没什么可恢复的
    expect(parsePlaybackSession({})).toBeNull();
    expect(parsePlaybackSession({ music: { id: 1 }, queue: [{ nope: true }] })).toBeNull();
  });

  it("过滤队列里的非法项并规范化数值", () => {
    const parsed = parsePlaybackSession({
      music: track("a"),
      queue: [track("a"), { bad: 1 }, track("b")],
      currentIndex: -5,
      progress: -3,
      duration: "oops",
      repeatMode: "bogus",
      playbackRate: 0,
    });
    expect(parsed?.queue.map((item) => item.id)).toEqual(["a", "b"]);
    expect(parsed?.currentIndex).toBe(-1);
    expect(parsed?.progress).toBe(0);
    expect(parsed?.duration).toBe(0);
    expect(parsed?.repeatMode).toBe("all");
    expect(parsed?.playbackRate).toBe(1);
  });
});

describe("播放会话写盘时机", () => {
  it("同一 10 秒刻度内的进度变化不写盘，跨刻度才写", () => {
    const previous = base();
    expect(shouldPersistPlaybackSession(state({ ...previous, progress: 12.4 }), previous)).toBe(false);
    expect(shouldPersistPlaybackSession(state({ ...previous, progress: 19.9 }), previous)).toBe(false);
    // 12 秒位于 [10, 20) 这一格；跨到下一格（20.1 秒）才需要写盘
    expect(
      shouldPersistPlaybackSession(
        state({ ...previous, progress: PROGRESS_SAVE_STEP_SECONDS * 2 + 0.1 }),
        previous,
      ),
    ).toBe(true);
  });

  it("切歌 / 暂停 / 改模式 / 队列变化都立刻写盘", () => {
    const previous = base();
    expect(shouldPersistPlaybackSession(state({ ...previous, current: track("b") }), previous)).toBe(true);
    expect(shouldPersistPlaybackSession(state({ ...previous, status: "paused" }), previous)).toBe(true);
    expect(shouldPersistPlaybackSession(state({ ...previous, isShuffle: true }), previous)).toBe(true);
    expect(shouldPersistPlaybackSession(state({ ...previous, playbackRate: 1.5 }), previous)).toBe(true);
    expect(
      shouldPersistPlaybackSession(state({ ...previous, queue: [track("a"), track("b")] }), previous),
    ).toBe(true);
    expect(shouldPersistPlaybackSession(state({ ...previous, currentIndex: 1 }), previous)).toBe(true);
  });
});

describe("播放会话恢复语义", () => {
  beforeEach(() => {
    clearResumeTarget();
  });

  it("恢复成 idle（不自动播放），并把位置记为待恢复", () => {
    const partials: Record<string, unknown>[] = [];
    const slice = parsePlaybackSession({
      music: track("a"),
      queue: [track("a")],
      currentIndex: 0,
      progress: 42,
      duration: 200,
    });
    applyPlaybackSession(slice!, (partial) => partials.push(partial as Record<string, unknown>));

    expect(partials[0]).toMatchObject({ status: "idle", error: null, progress: 42 });
    // 待恢复位置：只对同一首歌生效，且取一次即消费
    expect(takeResumeProgress(track("a"))).toBe(42);
    expect(takeResumeProgress(track("a"))).toBeNull();
    expect(takeResumeProgress(track("b"))).toBeNull();
  });

  it("位置贴近结尾时按「这首已听完」处理，从头开始", () => {
    const partials: Record<string, unknown>[] = [];
    const slice = parsePlaybackSession({ music: track("a"), progress: 198, duration: 200 });
    applyPlaybackSession(slice!, (partial) => partials.push(partial as Record<string, unknown>));
    expect(takeResumeProgress(track("a"))).toBeNull();
  });
});
