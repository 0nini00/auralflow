import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
const storage = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock("@lx/tauri-bridge", () => ({ libraryLoad: storage.load, librarySave: storage.save }));
import { attachLibraryPersistence } from "../src/stores/libraryPersistence";

beforeEach(() => {
  vi.useFakeTimers();
  storage.load.mockResolvedValue(null);
  storage.save.mockReset();
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });
it("显式保存失败向开关调用方传播，并保留待重试快照", async () => {
  const error = new Error("磁盘写入失败");
  storage.save.mockRejectedValueOnce(error).mockResolvedValue(undefined);
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const store = createStore(() => ({ featureEnabled: true }));
  const persistence = attachLibraryPersistence(store, {
    namespace: "customSources", pick: (state) => state,
    apply: (slice, set) => set(slice),
  });
  await persistence.ready;
  store.setState({ featureEnabled: false });
  await expect(persistence.flush()).rejects.toBe(error);
  expect(log).toHaveBeenCalled();
  await persistence.flush();
  expect(storage.save).toHaveBeenLastCalledWith("customSources", { featureEnabled: false });
  expect(storage.save).toHaveBeenCalledTimes(2);
});

it("旧写入失败不能把已提交的新快照重新排入队列", async () => {
  let failFirst!: (error: Error) => void;
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  storage.save.mockImplementationOnce(() => new Promise((_, reject) => { failFirst = reject; markStarted(); })).mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
  const store = createStore(() => ({ featureEnabled: false }));
  const persistence = attachLibraryPersistence(store, {
    namespace: "customSources", pick: (state) => state, apply: (slice, set) => set(slice),
  });
  await persistence.ready;
  store.setState({ featureEnabled: true });
  const first = persistence.flush().catch((error) => error);
  await started;
  store.setState({ featureEnabled: false });
  const second = persistence.flush();
  failFirst(new Error("旧写入失败"));
  await first;
  await second;
  await persistence.flush();
  expect(storage.save.mock.calls.map(([, value]) => value.featureEnabled)).toEqual([true, false]);
});
