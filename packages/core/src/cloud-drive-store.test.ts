import { describe, expect, it, vi } from "vitest";
import { createCloudDriveState, type CloudDrivePage, type CloudDriveState, type CloudDriveStoreDeps } from "./cloud-drive-store";
import type { MusicInfo } from "./sources/types";

const song = (id: string) => ({ id, source: "wy", name: `歌${id}`, singer: "人" }) as MusicInfo;
const page = (songs: MusicInfo[], extra: Partial<CloudDrivePage> = {}): CloudDrivePage => ({
  songs,
  count: songs.length,
  nextOffset: songs.length,
  hasMore: false,
  ...extra,
});

/** 最小的 (set, get) 宿主：与 zustand 的合并语义一致，足够驱动状态机。 */
function mount(overrides: Partial<CloudDriveStoreDeps> = {}) {
  const deps: CloudDriveStoreDeps = {
    pageSize: 2,
    fetchPage: vi.fn(async () => page([])),
    loadSnapshot: vi.fn(async () => null),
    saveSnapshot: vi.fn(async () => undefined),
    clearSnapshot: vi.fn(async () => undefined),
    reportSnapshotError: vi.fn(),
    ...overrides,
  };
  let state: CloudDriveState;
  const get = () => state;
  state = createCloudDriveState(deps)(
    (partial) => {
      state = { ...state, ...(typeof partial === "function" ? partial(state) : partial) };
    },
    get,
  );
  return { get, deps };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createCloudDriveState", () => {
  it("按注入的每页条数取页，翻页去重并沿用接口给的 nextOffset", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(page([song("1"), song("2")], { hasMore: true, nextOffset: 2, count: 3 }))
      .mockResolvedValueOnce(page([song("2"), song("3")], { nextOffset: 4, count: 3 }));
    const { get } = mount({ fetchPage });

    await get().initialize("uid-A");
    await get().loadMore();

    expect(fetchPage.mock.calls).toEqual([[{ offset: 0, limit: 2 }], [{ offset: 2, limit: 2 }]]);
    expect(get().songs.map((item) => item.id)).toEqual(["1", "2", "3"]);
    expect(get()).toMatchObject({ nextOffset: 4, hasMore: false, count: 3, loaded: true, loading: false });
  });

  it("保鲜期内的缓存直接采信，不发请求；过期缓存先显示再刷新", async () => {
    const snapshot = { ...page([song("9")]), cachedAt: 1 };
    const fresh = mount({ loadSnapshot: async () => ({ snapshot, fresh: true }) });
    await fresh.get().initialize("uid-A");
    expect(fresh.deps.fetchPage).not.toHaveBeenCalled();
    expect(fresh.get()).toMatchObject({ loaded: true, loading: false });

    const stale = mount({
      loadSnapshot: async () => ({ snapshot, fresh: false }),
      fetchPage: vi.fn(async () => page([song("1")])),
    });
    await stale.get().initialize("uid-A");
    expect(stale.deps.fetchPage).toHaveBeenCalledTimes(1);
    expect(stale.get().songs.map((item) => item.id)).toEqual(["1"]);
  });

  it("退出登录清空列表、删缓存，并作废在飞的请求", async () => {
    let release: (value: CloudDrivePage) => void = () => undefined;
    const fetchPage = vi.fn(() => new Promise<CloudDrivePage>((resolve) => { release = resolve; }));
    const { get, deps } = mount({ fetchPage });

    const loading = get().initialize("uid-A");
    await settle();
    await get().initialize("");
    release(page([song("1")]));
    await loading;

    expect(get()).toMatchObject({ songs: [], accountUid: "", loaded: false, loading: false });
    expect(deps.clearSnapshot).toHaveBeenCalledWith("uid-A");
    expect(deps.saveSnapshot).not.toHaveBeenCalled();
  });

  it("取页失败写进 error；缓存写入失败只上报，不影响列表", async () => {
    const failed = mount({ fetchPage: async () => { throw new Error("网络错误"); } });
    await failed.get().initialize("uid-A");
    expect(failed.get()).toMatchObject({ error: "网络错误", loading: false, loaded: true });

    const diskFull = new Error("disk full");
    const saved = mount({
      fetchPage: async () => page([song("1")]),
      saveSnapshot: async () => { throw diskFull; },
    });
    await saved.get().initialize("uid-A");
    await settle();
    expect(saved.get()).toMatchObject({ error: "", loaded: true });
    expect(saved.get().songs).toHaveLength(1);
    expect(saved.deps.reportSnapshotError).toHaveBeenCalledWith(diskFull);
  });
});
