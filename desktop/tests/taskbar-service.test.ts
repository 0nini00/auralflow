import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MusicInfo } from "@lx/core";
import type { PlaybackSnapshot } from "../src/services/playback/playbackSnapshot";

const mocks = vi.hoisted(() => ({
  loadSettings: vi.fn(),
  setEnabled: vi.fn(),
  updateTrack: vi.fn(),
  lookupCover: vi.fn(),
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
vi.mock("@/services/mediaCache", () => ({ lookupCachedCoverPath: mocks.lookupCover }));
vi.mock("@/services/logger", () => ({ logger: { warn: mocks.warn } }));
import { setupTaskbarThumbnails } from "../src/services/taskbarService";

const RETRY_DELAY_MS = 2000;
let dispose: (() => void) | undefined;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function track(id: string): MusicInfo {
  return { id, source: "wy", name: id, singer: "singer", albumName: "album" };
}

function publish(current: MusicInfo | null, status: PlaybackSnapshot["status"] = "playing") {
  mocks.snapshot = { ...mocks.snapshot, current, status };
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
  mocks.snapshot = { current: track("a"), status: "playing", progress: 0 };
  mocks.loadSettings.mockResolvedValue({ taskbarThumbnails: true });
  mocks.setEnabled.mockResolvedValue(undefined);
  mocks.updateTrack.mockResolvedValue(undefined);
  mocks.lookupCover.mockResolvedValue("cover-default");
  mocks.listen.mockResolvedValue(mocks.unlisten);
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("切歌后旧封面查询晚返回不能覆盖新歌", async () => {
  const old = deferred<string | null>();
  mocks.lookupCover.mockReturnValueOnce(old.promise).mockResolvedValueOnce("cover-b");
  await start();
  publish(track("b"));
  await settle();
  old.resolve("cover-a");
  await settle();
  expect(mocks.updateTrack.mock.calls).toEqual([[{ status: "playing", coverPath: "cover-b" }]]);
});

it("同曲状态更新使之前的播放态请求失效", async () => {
  const old = deferred<string | null>();
  mocks.lookupCover.mockReturnValueOnce(old.promise).mockResolvedValueOnce("cover-paused");
  await start();
  publish(track("a"), "paused");
  await settle();
  old.resolve("cover-playing");
  await settle();
  expect(mocks.updateTrack.mock.calls).toEqual([[{ status: "paused", coverPath: "cover-paused" }]]);
});

it("A到B再回A仍不能接受第一代A的封面", async () => {
  const old = deferred<string | null>();
  mocks.lookupCover.mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce("cover-b").mockResolvedValueOnce("cover-a-new");
  await start();
  publish(track("b"));
  await settle();
  publish(track("a"));
  await settle();
  old.resolve("cover-a-old");
  await settle();
  expect(mocks.updateTrack.mock.calls).toEqual([
    [{ status: "playing", coverPath: "cover-b" }],
    [{ status: "playing", coverPath: "cover-a-new" }],
  ]);
});

it("关闭立即使封面查询失效，不等待原生关闭完成", async () => {
  const cover = deferred<string | null>();
  const disabled = deferred<void>();
  mocks.lookupCover.mockReturnValueOnce(cover.promise);
  await start();
  mocks.setEnabled.mockReturnValueOnce(disabled.promise);
  await changeEnabled(false);
  cover.resolve("cover-stale");
  await settle();
  expect(mocks.updateTrack).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  disabled.resolve(undefined);
  await settle();
});

it("关闭后重开同曲时旧请求不能跨启用周期提交", async () => {
  const old = deferred<string | null>();
  mocks.lookupCover.mockReturnValueOnce(old.promise).mockResolvedValueOnce("cover-reopened");
  await start();
  await changeEnabled(false);
  await changeEnabled(true);
  old.resolve("cover-before-close");
  await settle();
  expect(mocks.updateTrack.mock.calls).toEqual([[{ status: "playing", coverPath: "cover-reopened" }]]);
});

it.each(["cover-retry", null])("当前无封面只在两秒后补推一次，补查结果为%s", async (coverPath) => {
  mocks.lookupCover.mockResolvedValueOnce(null).mockResolvedValueOnce(coverPath);
  await start();
  expect(mocks.updateTrack.mock.calls).toEqual([[{ status: "playing", coverPath: null }]]);
  await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS - 1);
  expect(mocks.lookupCover).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(mocks.updateTrack).toHaveBeenLastCalledWith({ status: "playing", coverPath });
  await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS * 2);
  expect(mocks.lookupCover).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

it("切歌清除尚未执行的重试", async () => {
  mocks.lookupCover.mockResolvedValueOnce(null).mockResolvedValueOnce("cover-b");
  await start();
  expect(vi.getTimerCount()).toBe(1);
  publish(track("b"));
  await settle();
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);
  expect(mocks.lookupCover).toHaveBeenCalledTimes(2);
});

it("已经进入封面查询的重试也不能覆盖新歌", async () => {
  const retry = deferred<string | null>();
  mocks.lookupCover.mockResolvedValueOnce(null).mockReturnValueOnce(retry.promise)
    .mockResolvedValueOnce("cover-b");
  await start();
  await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);
  publish(track("b"));
  await settle();
  retry.resolve("cover-a-late");
  await settle();
  expect(mocks.updateTrack.mock.calls).toEqual([
    [{ status: "playing", coverPath: null }],
    [{ status: "playing", coverPath: "cover-b" }],
  ]);
});

it("旧原生提交晚完成不能替换新歌的重试计时器", async () => {
  const submitted = deferred<void>();
  mocks.updateTrack.mockReturnValueOnce(submitted.promise);
  mocks.lookupCover.mockResolvedValueOnce(null).mockResolvedValueOnce(null)
    .mockResolvedValueOnce("cover-b-retry");
  await start();
  publish(track("b"));
  await settle();
  await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS / 2);
  submitted.resolve(undefined);
  await settle();
  await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS / 2);
  expect(mocks.lookupCover).toHaveBeenCalledTimes(3);
  expect(mocks.lookupCover).toHaveBeenLastCalledWith(track("b"));
  expect(mocks.updateTrack).toHaveBeenLastCalledWith({ status: "playing", coverPath: "cover-b-retry" });
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["close", "dispose"])("%s清重试，旧原生提交完成后也不重新挂重试", async (mode) => {
  const submitted = deferred<void>();
  mocks.lookupCover.mockResolvedValue(null);
  await start();
  expect(vi.getTimerCount()).toBe(1);
  mocks.updateTrack.mockReturnValueOnce(submitted.promise);
  publish(track("b"));
  await settle();
  if (mode === "close") await changeEnabled(false);
  else dispose?.();
  expect(vi.getTimerCount()).toBe(0);
  submitted.resolve(undefined);
  await settle();
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);
  expect(mocks.lookupCover).toHaveBeenCalledTimes(2);
});

it("卸载后待返回封面不提交，并移除订阅", async () => {
  const cover = deferred<string | null>();
  mocks.lookupCover.mockReturnValueOnce(cover.promise);
  await start();
  dispose?.();
  cover.resolve("cover-after-dispose");
  await settle();
  expect(mocks.updateTrack).not.toHaveBeenCalled();
  expect(mocks.subscribers.size).toBe(0);
  expect(mocks.unlisten).toHaveBeenCalledOnce();
});

it("旧启用操作晚完成不能在重开后额外推送", async () => {
  const enabling = deferred<void>();
  mocks.setEnabled.mockReturnValueOnce(enabling.promise);
  await start();
  await changeEnabled(false);
  await changeEnabled(true);
  expect(mocks.lookupCover).toHaveBeenCalledTimes(1);
  enabling.resolve(undefined);
  await settle();
  expect(mocks.lookupCover).toHaveBeenCalledTimes(1);
});

it("卸载后原生启用完成不再启动封面查询", async () => {
  const enabling = deferred<void>();
  mocks.setEnabled.mockReturnValueOnce(enabling.promise);
  await start();
  dispose?.();
  enabling.resolve(undefined);
  await settle();
  expect(mocks.lookupCover).not.toHaveBeenCalled();
});

it("已有封面和纯进度变化不产生重试或重复提交", async () => {
  await start();
  mocks.snapshot = { ...mocks.snapshot, progress: 1 };
  mocks.subscribers.forEach((callback) => callback());
  await settle();
  expect(mocks.lookupCover).toHaveBeenCalledTimes(1);
  expect(mocks.updateTrack).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("无歌曲时仍推送空封面且不重试", async () => {
  mocks.snapshot = { current: null, status: "idle", progress: 0 };
  await start();
  expect(mocks.lookupCover).not.toHaveBeenCalled();
  expect(mocks.updateTrack).toHaveBeenCalledWith({ status: "idle", coverPath: null });
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["close", "dispose"])("%s立即取消现有重试定时器", async (mode) => {
  const disabled = deferred<void>();
  mocks.lookupCover.mockResolvedValue(null);
  await start();
  expect(vi.getTimerCount()).toBe(1);
  if (mode === "close") {
    mocks.setEnabled.mockReturnValueOnce(disabled.promise);
    await changeEnabled(false);
  } else dispose?.();
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);
  expect(mocks.lookupCover).toHaveBeenCalledTimes(1);
  disabled.resolve(undefined);
  await settle();
});

it.each([true, false])("旧设置值%s晚返回不能覆盖更新的设置响应", async (oldEnabled) => {
  const old = deferred<{ taskbarThumbnails: boolean }>();
  mocks.loadSettings.mockReturnValueOnce(old.promise);
  await start();
  await changeEnabled(!oldEnabled);
  old.resolve({ taskbarThumbnails: oldEnabled });
  await settle();
  expect(mocks.setEnabled.mock.calls).toEqual([[!oldEnabled]]);
  expect(mocks.lookupCover).toHaveBeenCalledTimes(oldEnabled ? 0 : 1);
  publish(track("b"));
  await settle();
  expect(mocks.lookupCover).toHaveBeenCalledTimes(oldEnabled ? 0 : 2);
});

it("新设置仍在读取时，旧原生启用完成不能继续推封面", async () => {
  const enabling = deferred<void>();
  const closing = deferred<{ taskbarThumbnails: boolean }>();
  mocks.setEnabled.mockReturnValueOnce(enabling.promise);
  await start();
  mocks.loadSettings.mockReturnValueOnce(closing.promise);
  window.dispatchEvent(new Event("af-taskbar-change"));
  enabling.resolve(undefined);
  await settle();
  expect(mocks.lookupCover).not.toHaveBeenCalled();
  closing.resolve({ taskbarThumbnails: false });
  await settle();
  expect(mocks.setEnabled.mock.calls).toEqual([[true], [false]]);
  expect(mocks.lookupCover).not.toHaveBeenCalled();
});

it("读取关闭设置期间切歌不能把仍然有效的设置请求作废", async () => {
  await start();
  const closing = deferred<{ taskbarThumbnails: boolean }>();
  mocks.loadSettings.mockReturnValueOnce(closing.promise);
  window.dispatchEvent(new Event("af-taskbar-change"));
  publish(track("b"));
  await settle();
  closing.resolve({ taskbarThumbnails: false });
  await settle();
  expect(mocks.setEnabled.mock.calls).toEqual([[true], [false]]);
  const lookupCount = mocks.lookupCover.mock.calls.length;
  publish(track("c"));
  await settle();
  expect(mocks.lookupCover).toHaveBeenCalledTimes(lookupCount);
});

it("最新设置读取失败仍不接受旧响应，也不以旧响应静默回退", async () => {
  const old = deferred<{ taskbarThumbnails: boolean }>();
  const error = new Error("settings unavailable");
  mocks.loadSettings.mockReturnValueOnce(old.promise);
  await start();
  mocks.loadSettings.mockRejectedValueOnce(error);
  window.dispatchEvent(new Event("af-taskbar-change"));
  await settle();
  old.resolve({ taskbarThumbnails: true });
  await settle();
  expect(mocks.warn).toHaveBeenCalledWith("[任务栏缩略图] 读取设置失败", error);
  expect(mocks.setEnabled).not.toHaveBeenCalled();
  expect(mocks.lookupCover).not.toHaveBeenCalled();
});
