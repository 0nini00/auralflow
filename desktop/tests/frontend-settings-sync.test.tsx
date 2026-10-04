import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SyncSettingsSection } from "../src/views/settings/SyncSettingsSection";

const mocks = vi.hoisted(() => ({
  load: vi.fn(), patch: vi.fn(), uploadPlaylists: vi.fn(), uploadSources: vi.fn(), test: vi.fn(),
  feature: { featureEnabled: true, featureReady: true },
}));
vi.mock("@lx/tauri-bridge", () => ({ loadSettings: mocks.load, patchSettings: mocks.patch }));
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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.feature.featureEnabled = true; mocks.feature.featureReady = true;
  mocks.load.mockReset().mockResolvedValue({ ...config });
  mocks.patch.mockReset().mockResolvedValue({ ...config });
  mocks.uploadPlaylists.mockResolvedValue(undefined); mocks.uploadSources.mockResolvedValue(undefined); mocks.test.mockResolvedValue("连接正常");
});
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; });

describe("WebDAV 表单初始化与串行精确保存", () => {
  it("loading 期间可以编辑，但失焦不把未加载字段写空；迟到初始化保留草稿", async () => {
    const read = deferred<typeof config>(); mocks.load.mockReturnValueOnce(read.promise);
    await mount();
    await edit(0, "https://example.invalid/new"); await blur(0);
    expect(mocks.patch).not.toHaveBeenCalled();
    await act(async () => read.resolve({ ...config }));
    expect(input(0).props.value).toBe("https://example.invalid/new");
    expect(input(1).props.value).toBe(config.webdavUsername);
    expect(input(2).props.value).toBe(config.webdavPassword);
    expect(mocks.patch).toHaveBeenCalledExactlyOnceWith({ webdavUrl: "https://example.invalid/new" });
  });

  it("仅编辑未失焦时，迟到初始化也不能覆盖编辑，且不自动写其他字段", async () => {
    const read = deferred<typeof config>(); mocks.load.mockReturnValueOnce(read.promise);
    await mount(); await edit(2, "synthetic-new");
    await act(async () => read.resolve({ ...config }));
    expect(input(2).props.value).toBe("synthetic-new");
    expect(input(0).props.value).toBe(config.webdavUrl);
    expect(mocks.patch).not.toHaveBeenCalled();
    await blur(2);
    expect(mocks.patch).toHaveBeenCalledExactlyOnceWith({ webdavPassword: "synthetic-new" });
  });

  it("加载失败显式反馈，未加载默认值不得写盘", async () => {
    mocks.load.mockRejectedValueOnce(new Error("读取被拒绝"));
    await mount(); await edit(0, "https://example.invalid/new"); await blur(0);
    expect(text(renderer!.root)).toContain("读取被拒绝");
    expect(mocks.patch).not.toHaveBeenCalled();
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
    await act(async () => first.resolve({}));
    expect(mocks.patch.mock.calls.map(([patch]) => patch)).toEqual([
      { webdavUrl: "https://example.invalid/one" }, { webdavUrl: "https://example.invalid/two" },
    ]);
    expect(input(0).props.value).toBe("https://example.invalid/two");
    await act(async () => second.resolve({}));
    expect(text(renderer!.root)).toContain("已保存");
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
  it("读取失败后重新读取仍保留用户草稿，再保存时不覆盖其余字段", async () => {
    mocks.load.mockRejectedValueOnce(new Error("临时读失败"));
    await mount(); await edit(1, "edited-user");
    await act(async () => button("重新读取").props.onClick());
    expect(input(1).props.value).toBe("edited-user");
    expect(input(2).props.value).toBe(config.webdavPassword);
    await blur(1);
    expect(mocks.patch).toHaveBeenCalledExactlyOnceWith({ webdavUsername: "edited-user" });
  });

  it("连续 A-B-A 编辑不被第一次 A 保存成功误判为已保存", async () => {
    const first = deferred<object>(); mocks.patch.mockReturnValueOnce(first.promise);
    await mount(); await edit(1, "A"); await blur(1);
    await edit(1, "B"); await blur(1); await edit(1, "A"); await blur(1);
    expect(mocks.patch).toHaveBeenCalledTimes(1);
    await act(async () => first.resolve({}));
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
    await act(async () => save.resolve({}));
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
  });

  it("配置未完整时不启用自动同步，也不顺手写空配置", async () => {
    mocks.load.mockResolvedValueOnce({ ...config, webdavPassword: "" });
    await mount();
    await act(async () => { input(3).props.onChange({ target: { checked: true } }); });
    expect(mocks.patch).not.toHaveBeenCalled();
    expect(input(3).props.checked).toBe(false);
    expect(text(renderer!.root)).toContain("请先填写");
  });

  it("旧实例等待读取时已卸载，不得在新页面保存后再写入旧 dirty", async () => {
    const oldRead = deferred<typeof config>(); let disk = { ...config };
    mocks.load.mockReturnValueOnce(oldRead.promise).mockImplementation(async () => ({ ...disk }));
    mocks.patch.mockImplementation(async (patch) => { disk = { ...disk, ...patch }; });
    await mount(); await edit(1, "stale-user"); await blur(1);
    act(() => { renderer!.unmount(); renderer = undefined; });
    await mount(); await edit(1, "new-user"); await blur(1);
    await act(async () => oldRead.resolve({ ...config }));
    expect(mocks.patch.mock.calls.map(([patch]) => patch)).toEqual([{ webdavUsername: "new-user" }]);
    expect(disk.webdavUsername).toBe("new-user");
  });

  it("卸载取消排队 dirty；新实例读取等待已发写入完成，再精确保存新编辑", async () => {
    const oldWrite = deferred<void>(); let disk = { ...config };
    mocks.load.mockImplementation(async () => ({ ...disk }));
    mocks.patch.mockImplementation(async (patch) => {
      if (patch.webdavUsername === "old-issued") await oldWrite.promise;
      disk = { ...disk, ...patch };
    });
    await mount(); await edit(1, "old-issued"); await blur(1);
    await edit(1, "old-queued"); await blur(1);
    act(() => { renderer!.unmount(); renderer = undefined; }); await mount();
    await edit(1, "new-user"); await blur(1);
    try {
      expect(mocks.load).toHaveBeenCalledTimes(1);
      expect(mocks.patch).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => oldWrite.resolve());
    }
    expect(mocks.load).toHaveBeenCalledTimes(2);
    expect(mocks.patch.mock.calls.map(([patch]) => patch)).toEqual([{ webdavUsername: "old-issued" }, { webdavUsername: "new-user" }]);
    expect(disk.webdavUsername).toBe("new-user");
    expect(input(1).props.value).toBe("new-user");
  });

  it("新页面不带编辑时读取到旧页面已经发出的最新保存，而非保存前快照", async () => {
    const oldWrite = deferred<void>(); let disk = { ...config };
    mocks.load.mockImplementation(async () => ({ ...disk }));
    mocks.patch.mockImplementation(async (patch) => { await oldWrite.promise; disk = { ...disk, ...patch }; });
    await mount(); await edit(1, "issued-user"); await blur(1);
    act(() => { renderer!.unmount(); renderer = undefined; }); await mount();
    await act(async () => oldWrite.resolve());
    expect(input(1).props.value).toBe("issued-user");
    expect(mocks.patch).toHaveBeenCalledTimes(1);
  });

  it("失焦同一轮事件随后卸载，尚未发出的写入应取消", async () => {
    await mount(); await edit(1, "stale-user");
    await act(async () => { input(1).props.onBlur(); renderer!.unmount(); renderer = undefined; });
    expect(mocks.patch).not.toHaveBeenCalled();
  });

  it("等待初始化的同步操作在卸载后取消，不写配置也不发远端请求", async () => {
    const read = deferred<typeof config>(); mocks.load.mockReturnValueOnce(read.promise);
    await mount(); await edit(1, "stale-user");
    await act(async () => { button("上传歌单历史").props.onClick(); });
    act(() => { renderer!.unmount(); renderer = undefined; });
    await act(async () => read.resolve({ ...config }));
    expect(mocks.patch).not.toHaveBeenCalled();
    expect(mocks.uploadPlaylists).not.toHaveBeenCalled();
  });
  it("新挂载等待旧写入期间再次卸载，不执行已经作废的读取", async () => {
    const write = deferred<object>(); mocks.patch.mockReturnValueOnce(write.promise);
    await mount(); await edit(1, "issued"); await blur(1);
    act(() => { renderer!.unmount(); renderer = undefined; }); await mount();
    act(() => { renderer!.unmount(); renderer = undefined; }); await mount();
    await act(async () => write.resolve({}));
    expect(mocks.load).toHaveBeenCalledTimes(2);
    expect(mocks.patch).toHaveBeenCalledTimes(1);
  });

  it("已发旧写入失败也会结束屏障，新页面按真实磁盘读取且可以继续保存", async () => {
    const write = deferred<object>(); mocks.patch.mockReturnValueOnce(write.promise);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await mount(); await edit(1, "failed"); await blur(1);
      act(() => { renderer!.unmount(); renderer = undefined; }); await mount();
      await act(async () => write.reject(new Error("合成写入失败")));
      expect(log).toHaveBeenCalledWith("离开同步设置后已提交的配置保存失败", expect.any(Error));
      expect(input(1).props.value).toBe(config.webdavUsername);
      await edit(1, "retry-user"); await blur(1);
      expect(mocks.patch).toHaveBeenLastCalledWith({ webdavUsername: "retry-user" });
      expect(text(renderer!.root)).toContain("已保存");
    } finally { log.mockRestore(); }
  });
});
