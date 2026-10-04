import { afterEach, expect, it, vi } from "vitest";
const storage = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock("@lx/tauri-bridge", () => ({ libraryLoad: storage.load, librarySave: storage.save }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({ readTextFile: vi.fn() }));
vi.mock("../src/services/customSourceRuntime", () => ({
  parseDesktopUserApiInfo: () => ({ name: "测试源", description: "" }),
  testCustomSourceDeep: vi.fn(), checkCustomSourceUpdate: vi.fn(),
  invalidateRuntimeCache: vi.fn(), invalidateAllRuntimeCaches: vi.fn(),
}));
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
it("磁盘恢复失败不能伪装就绪，启用与导入明确失败", async () => {
  vi.resetModules();
  vi.useFakeTimers();
  const error = new Error("音源数据不可读");
  storage.load.mockRejectedValue(error);
  storage.save.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { useCustomSourceStore, customSourcePersistence } = await import("../src/stores/customSourceStore");
  await customSourcePersistence.ready;
  expect(useCustomSourceStore.getState().featureReady).toBe(false);
  expect(useCustomSourceStore.getState().featureLoadError).toContain("不可读");
  await expect(useCustomSourceStore.getState().setFeatureEnabled(true)).rejects.toThrow("不可读");
  await expect(useCustomSourceStore.getState().importScript("// test")).rejects.toThrow();
  expect(useCustomSourceStore.getState().featureEnabled).toBe(false);
  expect(useCustomSourceStore.getState().sources).toEqual([]);
  expect(storage.save).not.toHaveBeenCalled();
});
it("恢复就绪这一瞬态变化不重写旧快照，避免其他窗口覆盖主窗口开关", async () => {
  vi.resetModules();
  vi.useFakeTimers();
  storage.load.mockResolvedValue({ featureEnabled: true, sources: [] });
  storage.save.mockReset().mockResolvedValue(undefined);
  const { useCustomSourceStore, customSourcePersistence } = await import("../src/stores/customSourceStore");
  await customSourcePersistence.ready;
  expect(useCustomSourceStore.getState().featureReady).toBe(true);
  await vi.advanceTimersByTimeAsync(400);
  expect(storage.save).not.toHaveBeenCalled();
});
