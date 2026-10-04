import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  saved: null as Record<string, unknown> | null,
  pick: null as null | ((state: unknown) => Record<string, unknown>),
  flush: vi.fn(),
  deepTest: vi.fn(),
  checkUpdate: vi.fn(),
  clearRuntimes: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({ readTextFile: vi.fn() }));
vi.mock("../src/services/customSourceRuntime", () => ({
  parseDesktopUserApiInfo: () => ({ name: "测试源", description: "" }),
  testCustomSourceDeep: fixture.deepTest,
  checkCustomSourceUpdate: fixture.checkUpdate,
  invalidateRuntimeCache: vi.fn(),
  invalidateAllRuntimeCaches: fixture.clearRuntimes,
}));
vi.mock("../src/stores/libraryPersistence", () => ({
  attachLibraryPersistence: (store: { setState: (value: unknown) => void }, options: {
    pick: (state: unknown) => Record<string, unknown>;
    apply: (slice: unknown, set: (value: unknown) => void) => void;
  }) => {
    fixture.pick = options.pick;
    if (fixture.saved) options.apply(fixture.saved, store.setState);
    return { ready: Promise.resolve(), loadError: null, flush: fixture.flush };
  },
}));
const source = {
  id: "test-source", name: "测试源", description: "", script: "// test source",
  enabled: false, allowShowUpdateAlert: false, testStatus: "idle", updateStatus: "idle",
  createdAt: 1, updatedAt: 1,
};
async function load() {
  const module = await import("../src/stores/customSourceStore");
  await module.customSourcePersistence.ready;
  return module;
}
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  fixture.saved = null;
  fixture.pick = null;
});
describe("LX 功能开关", () => {
  it("新安装恢复完成后默认关闭", async () => {
    const { useCustomSourceStore } = await load();
    expect(useCustomSourceStore.getState().featureEnabled).toBe(false);
    expect(useCustomSourceStore.getState().featureReady).toBe(true);
  });
  it("旧版已有音源迁移为开启，但保留逐源停用状态", async () => {
    fixture.saved = { sources: [source] };
    const { useCustomSourceStore } = await load();
    expect(useCustomSourceStore.getState().featureEnabled).toBe(true);
    expect(useCustomSourceStore.getState().sources[0].enabled).toBe(false);
  });
  it("显式关闭不会因已有音源被重新开启", async () => {
    fixture.saved = { featureEnabled: false, sources: [source] };
    const { useCustomSourceStore } = await load();
    expect(useCustomSourceStore.getState().featureEnabled).toBe(false);
    expect(useCustomSourceStore.getState().sources).toHaveLength(1);
  });
  it("开关保存到原命名空间且不更改源数据", async () => {
    fixture.saved = { sources: [source] };
    const { useCustomSourceStore } = await load();
    const original = useCustomSourceStore.getState().sources;
    await useCustomSourceStore.getState().setFeatureEnabled(false);
    expect(fixture.pick!(useCustomSourceStore.getState()).featureEnabled).toBe(false);
    expect(useCustomSourceStore.getState().sources).toEqual(original);
    expect(fixture.flush).toHaveBeenCalled();
    await useCustomSourceStore.getState().setFeatureEnabled(true);
    expect(useCustomSourceStore.getState().sources).toEqual(original);
  });
  it("关闭时导入、测试与更新显式拒绝且不执行脚本", async () => {
    const { useCustomSourceStore } = await load();
    await expect(useCustomSourceStore.getState().importScript("// script")).rejects.toThrow("未启用");
    await expect(useCustomSourceStore.getState().testSource(source.id)).rejects.toThrow("未启用");
    await expect(useCustomSourceStore.getState().checkAllUpdates()).rejects.toThrow("未启用");
    expect(fixture.deepTest).not.toHaveBeenCalled();
    expect(fixture.checkUpdate).not.toHaveBeenCalled();
  });
  it("关闭再开启也不能复活旧操作", async () => {
    fixture.saved = { sources: [source] };
    const { useCustomSourceStore, customSourceAccess } = await load();
    const operation = customSourceAccess.capture();
    await useCustomSourceStore.getState().setFeatureEnabled(false);
    await useCustomSourceStore.getState().setFeatureEnabled(true);
    expect(operation.isActive()).toBe(false);
    expect(operation.signal.aborted).toBe(true);
    expect(() => operation.assertActive()).toThrow();
    expect(customSourceAccess.capture().isActive()).toBe(true);
  });
  it("关闭中途的测试结果不能覆盖重新开启后的状态", async () => {
    fixture.saved = { sources: [source] };
    let finish!: (value: unknown) => void;
    fixture.deepTest.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const { useCustomSourceStore } = await load();
    const testing = useCustomSourceStore.getState().testSource(source.id);
    await Promise.resolve();
    await useCustomSourceStore.getState().setFeatureEnabled(false);
    await useCustomSourceStore.getState().setFeatureEnabled(true);
    finish({ ok: true, message: "旧结果", updateAlert: { log: "旧更新", updateUrl: "https://example.com" } });
    await testing;
    expect(useCustomSourceStore.getState().sources[0].testStatus).toBe("idle");
    expect(useCustomSourceStore.getState().sources[0].updateStatus).toBe("idle");
  });
});
