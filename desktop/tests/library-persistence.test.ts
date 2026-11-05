import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
const storage = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock("@lx/tauri-bridge", () => ({ libraryLoad: storage.load, librarySave: storage.save }));
import { attachLibraryPersistence, createLibraryStore, flushLibraryPersistence } from "../src/stores/libraryPersistence";

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
  const store = createLibraryStore(() => ({ featureEnabled: true }));
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
  const store = createLibraryStore(() => ({ featureEnabled: false }));
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

it('批量退出保存等待全部任务并传播任一持久化错误', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const store = createLibraryStore(() => ({ favorites: [] as string[] }));
  const controller = attachLibraryPersistence(store, { namespace: 'favorites', pick: (state) => state, apply: (slice, set) => set(slice) });
  await controller.ready;
  store.setState({ favorites: ['a'] });
  storage.save.mockRejectedValueOnce(new Error('退出写盘失败'));
  await expect(flushLibraryPersistence()).rejects.toThrow('退出写盘失败');
});

it('未经过初始化提交边界的 store 显式拒绝挂载，避免内部 set 丢失启动修改', () => {
  const store = createStore(() => ({ favorites: [] as string[] }));
  expect(() => attachLibraryPersistence(store, { namespace: 'favorites', pick: (state) => state, apply: (slice, set) => set(slice) }))
    .toThrow('createLibraryStore');
});

it('退出 flush 等待在途写盘期间的新修改一并落盘后才完成', async () => {
  let finishFirst!: () => void;
  let started!: () => void;
  const writing = new Promise<void>((resolve) => { started = resolve; });
  storage.save.mockImplementationOnce(() => new Promise<void>((resolve) => { finishFirst = resolve; started(); }))
    .mockResolvedValue(undefined);
  const store = createLibraryStore(() => ({ favorites: [] as string[] }));
  const persistence = attachLibraryPersistence(store, { namespace: 'favorites', pick: (state) => state, apply: (slice, set) => set(slice) });
  await persistence.ready;
  store.setState({ favorites: ['A'] });
  const flushing = persistence.flush();
  await writing;
  store.setState({ favorites: ['A', 'B'] });
  finishFirst();
  await flushing;
  expect(storage.save.mock.calls.map(([, slice]) => slice.favorites)).toEqual([['A'], ['A', 'B']]);
  expect(vi.getTimerCount()).toBe(0);
});

it('等待另一个命名空间时，已完成写盘的 store 再次修改也必须排空', async () => {
  let finishSlow!: () => void;
  let started!: () => void;
  const writing = new Promise<void>((resolve) => { started = resolve; });
  storage.save.mockImplementation((namespace) => namespace === 'recent'
    ? new Promise<void>((resolve) => { finishSlow = resolve; started(); })
    : Promise.resolve());
  const favorites = createLibraryStore(() => ({ value: 'initial' }));
  const recent = createLibraryStore(() => ({ value: 'initial' }));
  const first = attachLibraryPersistence(favorites, { namespace: 'favorites', pick: (state) => state, apply: (slice, set) => set(slice) });
  const second = attachLibraryPersistence(recent, { namespace: 'recent', pick: (state) => state, apply: (slice, set) => set(slice) });
  await Promise.all([first.ready, second.ready]);
  favorites.setState({ value: 'A' });
  recent.setState({ value: 'slow' });
  const flushing = flushLibraryPersistence();
  await writing;
  await Promise.resolve();
  favorites.setState({ value: 'B' });
  finishSlow();
  await flushing;
  expect(storage.save.mock.calls.filter(([namespace, slice]) => namespace === 'favorites' && 'value' in slice).map(([, slice]) => slice.value)).toEqual(['A', 'B']);
});
