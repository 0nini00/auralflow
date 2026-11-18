import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PlaybackSnapshot } from "../src/services/playback/playbackSnapshot";

const mocks = vi.hoisted(() => ({
  setEnabled: vi.fn(),
  updateTrack: vi.fn(),
  listen: vi.fn(),
  unlisten: vi.fn(),
  warn: vi.fn(),
  subscribers: new Set<() => void>(),
  snapshot: {} as Pick<PlaybackSnapshot, "current" | "status" | "progress">,
}));
vi.mock("@lx/tauri-bridge", async (importOriginal) => ({
  TAURI_EVENTS: (await importOriginal<typeof import("@lx/tauri-bridge")>()).TAURI_EVENTS,
  listenTauriEvent: mocks.listen,
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
import { __resetSettingsStoreForTests } from "../src/stores/settingsStore";
import { seedSettings } from "./helpers/settingsFixture";

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
  seedSettings({ taskbarThumbnails: enabled });
  await settle();
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  __resetSettingsStoreForTests();
  seedSettings({ taskbarThumbnails: true });
  mocks.subscribers.clear();
  mocks.snapshot = { current: null, status: "playing", progress: 0 };
  mocks.setEnabled.mockResolvedValue(undefined);
  mocks.updateTrack.mockResolvedValue(undefined);
  mocks.listen.mockResolvedValue(mocks.unlisten);
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.clearAllTimers();
  vi.useRealTimers();
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
  await changeEnabled(false);
  expect(mocks.setEnabled.mock.calls).toEqual([[true]]);
  expect(mocks.updateTrack).toHaveBeenCalledTimes(1);
  expect(mocks.subscribers.size).toBe(0);
  expect(mocks.unlisten).toHaveBeenCalledOnce();
});

it("较早一次开关的原生调用晚返回，不会按它重推状态", async () => {
  const old = deferred<void>();
  mocks.setEnabled.mockReturnValueOnce(old.promise);
  await start();
  await changeEnabled(false);
  old.resolve();
  await settle();
  // 「打开」那次调用返回时开关已经关了：被代次挡掉，不再推送
  expect(mocks.setEnabled.mock.calls).toEqual([[true], [false]]);
  expect(mocks.updateTrack).not.toHaveBeenCalled();
});

it("设置还没读到时不切换开关，读到后按真实值应用", async () => {
  __resetSettingsStoreForTests();
  await start();
  expect(mocks.setEnabled).not.toHaveBeenCalled();
  expect(mocks.updateTrack).not.toHaveBeenCalled();

  await changeEnabled(false);
  expect(mocks.setEnabled.mock.calls).toEqual([[false]]);
});
