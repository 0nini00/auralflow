import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PlaybackSnapshot } from "../src/services/playback/playbackSnapshot";

const mocks = vi.hoisted(() => ({
  loadSettings: vi.fn(),
  setEnabled: vi.fn(),
  updateTrack: vi.fn(),
  listen: vi.fn(),
  unlisten: vi.fn(),
  warn: vi.fn(),
  subscribers: new Set<() => void>(),
  snapshot: {} as Pick<PlaybackSnapshot, "current" | "status" | "progress">,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@lx/tauri-bridge", () => ({
  TASKBAR_ACTION_EVENT: "taskbar-action",
  loadSettings: mocks.loadSettings,
  taskbarSetEnabled: mocks.setEnabled,
  taskbarUpdateTrack: mocks.updateTrack,
}));
vi.mock("@/stores/playerStore", () => ({
  usePlayerStore: {
    subscribe: (callback: () => void) => {
      mocks.subscribers.add(callback);
      return () => mocks.subscribers.delete(callback);
    },
  },
}));
vi.mock("@/services/playback/playbackSnapshot", () => ({
  getPlaybackSnapshotFromStore: () => mocks.snapshot,
}));
vi.mock("@/services/logger", () => ({ logger: { warn: mocks.warn } }));
import { setupTaskbarThumbnails } from "../src/services/taskbarService";

let dispose: (() => void) | undefined;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

/** 改状态并通知订阅者（进度变化不影响任务栏按钮，这里只模拟状态与进度两种变化） */
function publish(status: PlaybackSnapshot["status"], progress = 0) {
  mocks.snapshot = { ...mocks.snapshot, status, progress };
  mocks.subscribers.forEach((callback) => callback());
}

async function settle() {
  await vi.advanceTimersByTimeAsync(0);
}

async function start() {
  dispose = setupTaskbarThumbnails();
  await settle();
}

async function changeEnabled(enabled: boolean) {
  mocks.loadSettings.mockResolvedValue({ taskbarThumbnails: enabled });
  window.dispatchEvent(new Event("af-taskbar-change"));
  await settle();
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.stubGlobal("window", new EventTarget());
  mocks.subscribers.clear();
  mocks.snapshot = { current: null, status: "playing", progress: 0 };
  mocks.loadSettings.mockResolvedValue({ taskbarThumbnails: true });
  mocks.setEnabled.mockResolvedValue(undefined);
  mocks.updateTrack.mockResolvedValue(undefined);
  mocks.listen.mockResolvedValue(mocks.unlisten);
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("挂载时按设置启用并推一次当前播放状态", async () => {
  await start();
  expect(mocks.setEnabled.mock.calls).toEqual([[true]]);
  expect(mocks.updateTrack.mock.calls).toEqual([[{ status: "playing" }]]);
});

it("只有状态变化才推送：纯进度变化不打扰原生侧", async () => {
  await start();
  expect(mocks.updateTrack).toHaveBeenCalledTimes(1);

  publish("playing", 1);
  await settle();
  expect(mocks.updateTrack).toHaveBeenCalledTimes(1);

  publish("paused");
  await settle();
  expect(mocks.updateTrack.mock.calls).toEqual([[{ status: "playing" }], [{ status: "paused" }]]);
});

it("关闭后不再推送状态", async () => {
  await start();
  await changeEnabled(false);
  expect(mocks.setEnabled.mock.calls).toEqual([[true], [false]]);
  expect(mocks.updateTrack).toHaveBeenCalledTimes(1);

  publish("paused");
  await settle();
  expect(mocks.updateTrack).toHaveBeenCalledTimes(1);
});

it("重新打开时按当时状态重推一次（状态字符串可能没变）", async () => {
  await start();
  await changeEnabled(false);
  await changeEnabled(true);
  expect(mocks.updateTrack.mock.calls).toEqual([[{ status: "playing" }], [{ status: "playing" }]]);
});

it("卸载后不再推送，并移除订阅与事件监听", async () => {
  await start();
  dispose?.();
  publish("paused");
  await settle();
  expect(mocks.updateTrack).toHaveBeenCalledTimes(1);
  expect(mocks.subscribers.size).toBe(0);
  expect(mocks.unlisten).toHaveBeenCalledOnce();
});

it("旧设置响应晚返回不能覆盖更新的设置响应", async () => {
  const old = deferred<{ taskbarThumbnails: boolean }>();
  mocks.loadSettings.mockReturnValueOnce(old.promise);
  await start();
  await changeEnabled(false);
  old.resolve({ taskbarThumbnails: true });
  await settle();
  // 只应用「关闭」这一次设置，旧响应被代次挡掉，也不会因此重新推送
  expect(mocks.setEnabled.mock.calls).toEqual([[false]]);
  expect(mocks.updateTrack).not.toHaveBeenCalled();
});

it("最新设置读取失败只记日志，不切换开关", async () => {
  const error = new Error("settings unavailable");
  mocks.loadSettings.mockRejectedValueOnce(error);
  await start();
  expect(mocks.warn).toHaveBeenCalledWith("[任务栏缩略图] 读取设置失败", error);
  expect(mocks.setEnabled).not.toHaveBeenCalled();
  expect(mocks.updateTrack).not.toHaveBeenCalled();
});
