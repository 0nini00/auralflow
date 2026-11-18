import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SyncSettingsSection } from "../src/views/settings/SyncSettingsSection";
import { __resetSettingsStoreForTests } from "../src/stores/settingsStore";
import { seedSettings } from "./helpers/settingsFixture";

const mocks = vi.hoisted(() => ({
  load: vi.fn(), patch: vi.fn(), uploadPlaylists: vi.fn(), uploadSources: vi.fn(), test: vi.fn(),
  feature: { featureEnabled: true, featureReady: true },
}));
vi.mock("@lx/tauri-bridge", () => ({ loadSettings: mocks.load, patchSettings: mocks.patch }));
vi.mock("@/services/logger", () => ({ logger: { warn: vi.fn() } }));
vi.mock("@/stores/customSourceStore", () => ({ useCustomSourceStore: (select: (state: typeof mocks.feature) => unknown) => select(mocks.feature) }));
vi.mock("@/services/webdavSyncService", () => ({ uploadPlaylistsSync: mocks.uploadPlaylists, uploadSourcesSync: mocks.uploadSources, testSync: mocks.test }));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function text(node: ReactTestInstance | string): string { return typeof node === "string" ? node : node.children.map(text).join(""); }
const config = { webdavUrl: "https://example.invalid/old", webdavUsername: "test-user", webdavPassword: "synthetic-password", webdavAutoSyncPlaylists: false };
let renderer: ReactTestRenderer | undefined;
const input = (index: number) => renderer!.root.findAllByType("input")[index];
const button = (label: string) => renderer!.root.findAllByType("button").find((node) => text(node).includes(label))!;
async function mount() { await act(async () => { renderer = create(<SyncSettingsSection />); }); }
async function edit(index: number, value: string) { await act(async () => input(index).props.onChange({ target: { value } })); }
async function blur(index: number) { await act(async () => { input(index).props.onBlur(); }); }

/** 模拟 Rust 侧的设置文件：patch 合并进去并返回合并后的完整设置，load 读它。 */
let disk = { ...config };
const applyToDisk = (patch: object) => { disk = { ...disk, ...patch }; return { ...disk }; };

beforeEach(() => {
  vi.clearAllMocks();
  __resetSettingsStoreForTests();
  disk = { ...config };
  seedSettings(disk);
  mocks.feature.featureEnabled = true; mocks.feature.featureReady = true;
  mocks.load.mockReset().mockImplementation(async () => ({ ...disk }));
  mocks.patch.mockReset().mockImplementation(async (patch: object) => applyToDisk(patch));
  mocks.uploadPlaylists.mockResolvedValue(undefined); mocks.uploadSources.mockResolvedValue(undefined); mocks.test.mockResolvedValue("连接正常");
});
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; });

describe("WebDAV 表单的串行精确保存", () => {
  it("表单显示设置里的值，只保存编辑过的字段", async () => {
    await mount();
    expect([0, 1, 2].map((index) => input(index).props.value)).toEqual([config.webdavUrl, config.webdavUsername, config.webdavPassword]);
    await edit(0, "https://example.invalid/new"); await blur(0);
    expect(mocks.patch).toHaveBeenCalledExactlyOnceWith({ webdavUrl: "https://example.invalid/new" });
    expect(input(0).props.value).toBe("https://example.invalid/new");
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("别的窗口改了设置后，未编辑的字段跟着变，编辑中的草稿保留", async () => {
    await mount(); await edit(1, "draft-user");
    act(() => seedSettings({ ...config, webdavUrl: "https://example.invalid/other", webdavUsername: "other-user" }));
    expect(input(0).props.value).toBe("https://example.invalid/other");
    expect(input(1).props.value).toBe("draft-user");
  });

  it("主动逐项清空全部配置，每个字段包括最后密码均保存为空", async () => {
    await mount();
    for (let index = 0; index < 3; index++) { await edit(index, ""); await blur(index); }
    expect(mocks.patch.mock.calls.map(([patch]) => patch)).toEqual([
      { webdavUrl: "" }, { webdavUsername: "" }, { webdavPassword: "" },
    ]);
    expect(text(renderer!.root)).toContain("已保存");
  });

  it("快速 blur 串行保存，前一次完成不能清除后一次 dirty", async () => {
    const first = deferred<object>(); const second = deferred<object>();
    mocks.patch.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await mount(); await edit(0, "https://example.invalid/one"); await blur(0);
    await edit(0, "https://example.invalid/two"); await blur(0);
    expect(mocks.patch).toHaveBeenCalledTimes(1);
    expect(text(renderer!.root)).toContain("保存中");
    await act(async () => first.resolve(applyToDisk({ webdavUrl: "https://example.invalid/one" })));
    expect(mocks.patch.mock.calls.map(([patch]) => patch)).toEqual([
      { webdavUrl: "https://example.invalid/one" }, { webdavUrl: "https://example.invalid/two" },
    ]);
    expect(input(0).props.value).toBe("https://example.invalid/two");
    await act(async () => second.resolve(applyToDisk({ webdavUrl: "https://example.invalid/two" })));
    expect(text(renderer!.root)).toContain("已保存");
    expect(input(0).props.value).toBe("https://example.invalid/two");
  });

  it("保存失败保留 dirty 和可见错误，重试仅保存失败字段", async () => {
    mocks.patch.mockRejectedValueOnce(new Error("磁盘只读"));
    await mount(); await edit(1, "edited-user"); await blur(1);
    expect(renderer!.root.findAllByProps({ role: "alert" }).some((node) => text(node).includes("磁盘只读"))).toBe(true);
    expect(input(1).props.value).toBe("edited-user");
    await act(async () => button("重试保存").props.onClick());
    expect(mocks.patch.mock.calls.map(([patch]) => patch)).toEqual([{ webdavUsername: "edited-user" }, { webdavUsername: "edited-user" }]);
    expect(renderer!.root.findAllByProps({ role: "alert" })).toHaveLength(0);
  });

  it("无编辑的失焦和测试连接不重新保存整个配置", async () => {
    await mount(); await blur(0);
    await act(async () => button("测试连接").props.onClick());
    expect(mocks.patch).not.toHaveBeenCalled();
    expect(mocks.test).toHaveBeenCalledTimes(1);
  });

  it("配置保存失败不执行同步任务", async () => {
    mocks.patch.mockRejectedValue(new Error("不能保存"));
    await mount(); await edit(0, "https://example.invalid/new");
    await act(async () => button("上传歌单历史").props.onClick());
    expect(mocks.uploadPlaylists).not.toHaveBeenCalled();
    expect(text(renderer!.root)).toContain("不能保存");
    expect(button("上传歌单历史").props.disabled).toBe(false);
  });

  it.each([false, true])("LX 音源开启=%s 时歌单同步不被音源恢复/禁用状态拦截", async (enabled) => {
    mocks.feature.featureEnabled = enabled; mocks.feature.featureReady = enabled;
    await mount();
    expect(button("上传音源").props.disabled).toBe(!enabled);
    expect(button("上传歌单历史").props.disabled).toBe(false);
    await act(async () => button("上传歌单历史").props.onClick());
    expect(mocks.uploadPlaylists).toHaveBeenCalledTimes(1);
    expect(mocks.uploadSources).not.toHaveBeenCalled();
  });

  it("连续 A-B-A 编辑不被第一次 A 保存成功误判为已保存", async () => {
    const first = deferred<object>(); mocks.patch.mockReturnValueOnce(first.promise);
    await mount(); await edit(1, "A"); await blur(1);
    await edit(1, "B"); await blur(1); await edit(1, "A"); await blur(1);
    expect(mocks.patch).toHaveBeenCalledTimes(1);
    await act(async () => first.resolve(applyToDisk({ webdavUsername: "A" })));
    expect(mocks.patch.mock.calls.map(([patch]) => patch)).toEqual([{ webdavUsername: "A" }, { webdavUsername: "A" }]);
    expect(text(renderer!.root)).toContain("已保存");
  });

  it("前次保存失败不破坏队列，后续保存包含未成功的 dirty 字段", async () => {
    const first = deferred<object>(); mocks.patch.mockReturnValueOnce(first.promise);
    await mount(); await edit(0, "https://example.invalid/new"); await blur(0);
    await edit(1, "edited-user"); await blur(1);
    await act(async () => first.reject(new Error("临时写失败")));
    expect(mocks.patch.mock.calls.map(([patch]) => patch)).toEqual([
      { webdavUrl: "https://example.invalid/new" },
      { webdavUrl: "https://example.invalid/new", webdavUsername: "edited-user" },
    ]);
    expect(text(renderer!.root)).toContain("已保存");
    expect(renderer!.root.findAllByProps({ role: "alert" })).toHaveLength(0);
  });

  it("同步任务等待前面的 blur 保存完成，不与设置写入并行", async () => {
    const save = deferred<object>(); mocks.patch.mockReturnValueOnce(save.promise);
    await mount(); await edit(0, "https://example.invalid/new"); await blur(0);
    await act(async () => { button("上传歌单历史").props.onClick(); });
    expect(mocks.uploadPlaylists).not.toHaveBeenCalled();
    await act(async () => save.resolve(applyToDisk({ webdavUrl: "https://example.invalid/new" })));
    expect(mocks.uploadPlaylists).toHaveBeenCalledTimes(1);
    expect(mocks.patch).toHaveBeenCalledTimes(1);
  });

  it("自动同步开关与未保存编辑原子提交，失败明确显示并允许重试", async () => {
    mocks.patch.mockRejectedValueOnce(new Error("不能保存自动同步"));
    await mount(); await edit(1, "edited-user");
    await act(async () => { input(3).props.onChange({ target: { checked: true } }); });
    expect(mocks.patch).toHaveBeenCalledExactlyOnceWith({ webdavUsername: "edited-user", webdavAutoSyncPlaylists: true });
    expect(text(renderer!.root)).toContain("不能保存自动同步");
    expect(text(renderer!.root)).not.toContain("已开启启动时自动同步");
    await act(async () => button("重试保存").props.onClick());
    expect(text(renderer!.root)).toContain("已保存");
    expect(input(3).props.checked).toBe(true);
  });

  it("配置未完整时不启用自动同步，也不顺手写空配置", async () => {
    seedSettings({ ...config, webdavPassword: "" });
    await mount();
    await act(async () => { input(3).props.onChange({ target: { checked: true } }); });
    expect(mocks.patch).not.toHaveBeenCalled();
    expect(input(3).props.checked).toBe(false);
    expect(text(renderer!.root)).toContain("请先填写");
  });

  it("卸载取消排队 dirty；新实例等已发写入完成后，再精确保存新编辑", async () => {
    const oldWrite = deferred<void>();
    mocks.patch.mockImplementation(async (patch: { webdavUsername?: string }) => {
      if (patch.webdavUsername === "old-issued") await oldWrite.promise;
      return applyToDisk(patch);
    });
    await mount(); await edit(1, "old-issued"); await blur(1);
    await edit(1, "old-queued"); await blur(1);
    act(() => { renderer!.unmount(); renderer = undefined; }); await mount();
    await edit(1, "new-user"); await blur(1);
    try {
      expect(mocks.patch).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => oldWrite.resolve());
    }
    expect(mocks.patch.mock.calls.map(([patch]) => patch)).toEqual([{ webdavUsername: "old-issued" }, { webdavUsername: "new-user" }]);
    expect(disk.webdavUsername).toBe("new-user");
    expect(input(1).props.value).toBe("new-user");
  });

  it("新页面不带编辑时显示旧页面已经发出的保存，而非保存前的值", async () => {
    const oldWrite = deferred<void>();
    mocks.patch.mockImplementation(async (patch: object) => { await oldWrite.promise; return applyToDisk(patch); });
    await mount(); await edit(1, "issued-user"); await blur(1);
    act(() => { renderer!.unmount(); renderer = undefined; }); await mount();
    expect(input(1).props.value).toBe("issued-user");
    await act(async () => oldWrite.resolve());
    expect(input(1).props.value).toBe("issued-user");
    expect(mocks.patch).toHaveBeenCalledTimes(1);
  });

  it("失焦同一轮事件随后卸载，尚未发出的写入应取消", async () => {
    await mount(); await edit(1, "stale-user");
    await act(async () => { input(1).props.onBlur(); renderer!.unmount(); renderer = undefined; });
    expect(mocks.patch).not.toHaveBeenCalled();
  });

  it("已发旧写入失败也会结束屏障，新页面回到真实设置且可以继续保存", async () => {
    const write = deferred<object>(); mocks.patch.mockReturnValueOnce(write.promise);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await mount(); await edit(1, "failed"); await blur(1);
      act(() => { renderer!.unmount(); renderer = undefined; }); await mount();
      await act(async () => write.reject(new Error("合成写入失败")));
      expect(log).toHaveBeenCalledWith("离开同步设置后已提交的配置保存失败", expect.any(Error));
      // 写入失败后 store 重读了一次真实值
      expect(mocks.load).toHaveBeenCalledTimes(1);
      expect(input(1).props.value).toBe(config.webdavUsername);
      await edit(1, "retry-user"); await blur(1);
      expect(mocks.patch).toHaveBeenLastCalledWith({ webdavUsername: "retry-user" });
      expect(text(renderer!.root)).toContain("已保存");
    } finally { log.mockRestore(); }
  });
});
