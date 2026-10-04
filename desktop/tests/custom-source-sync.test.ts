import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomSourceItem } from "../src/stores/customSourceStore";
import type { OutboundResponse } from "../src/services/outboundHttp";

const fixture = vi.hoisted(() => ({
  request: vi.fn(),
  loadSettings: vi.fn(),
  inflate: vi.fn(),
  hydration: Promise.resolve(),
  saved: {} as Record<string, unknown>,
}));

vi.mock("@lx/tauri-bridge", () => ({ loadSettings: fixture.loadSettings, patchSettings: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({ readTextFile: vi.fn() }));
vi.mock("../src/services/outboundHttp", () => ({ outboundRequest: fixture.request }));
vi.mock("../src/utils/compression", () => ({ inflateBytes: fixture.inflate }));
vi.mock("../src/services/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../src/stores/wyAccountStore", () => ({ useWyAccountStore: { getState: () => ({ playlists: [] }) } }));
// 不执行用户脚本；同步入口、访问令牌、源 store 和歌单合并逻辑均使用真实实现。
vi.mock("../src/services/customSourceRuntime", () => ({
  parseDesktopUserApiInfo: () => ({ name: "测试源", description: "" }),
  testCustomSourceDeep: vi.fn(),
  checkCustomSourceUpdate: vi.fn(),
  invalidateRuntimeCache: vi.fn(),
  invalidateAllRuntimeCaches: vi.fn(),
}));
vi.mock("../src/stores/libraryPersistence", () => ({
  attachLibraryPersistence: (store: { setState: (value: unknown) => void }, options: {
    namespace: string;
    apply: (slice: unknown, set: (value: unknown) => void) => void;
  }) => ({
    ready: options.namespace === "customSources"
      ? fixture.hydration.then(() => options.apply(fixture.saved, store.setState))
      : Promise.resolve(),
    loadError: null,
    flush: vi.fn().mockResolvedValue(undefined),
  }),
}));

const source: CustomSourceItem = {
  id: "local-source", name: "本地源", description: "保留配置", script: "// source script",
  enabled: false, allowShowUpdateAlert: false, testStatus: "idle", updateStatus: "idle",
  createdAt: 1, updatedAt: 1,
};
const config = { webdavUrl: "https://webdav.example.test", webdavUsername: "", webdavPassword: "" };
const metaKey = "auralflow:webdav:localMeta:sources";
const backupKey = "auralflow:webdav:backup:sources";
const remoteSong = { id: "remote-song", source: "wy" as const, name: "云端歌曲", singer: "歌手", albumName: "专辑" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function response(body = "", status = 200): OutboundResponse {
  return { ok: status >= 200 && status < 300, status, statusText: String(status), headers: {}, text: async () => body, base64: () => body };
}

function remoteSources(script = "// remote script") {
  return JSON.stringify({
    version: "2", lastModified: 2000, featureEnabled: false, featureReady: false,
    data: [{ id: "remote-source", name: "云端源", script, featureEnabled: false, featureReady: false }],
  });
}

async function load(waitForHydration = true) {
  const store = await import("../src/stores/customSourceStore");
  if (waitForHydration) await store.customSourcePersistence.ready;
  const service = await import("../src/services/webdavSyncService");
  return { ...store, ...service };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
    removeItem: (key: string) => storage.delete(key),
  });
  fixture.hydration = Promise.resolve();
  fixture.saved = { featureEnabled: true, sources: [{ ...source }] };
  fixture.loadSettings.mockResolvedValue(config);
  fixture.request.mockImplementation(async (_url: string, init: { method: string }) =>
    response(init.method === "GET" ? remoteSources() : ""));
  fixture.inflate.mockResolvedValue(new TextEncoder().encode("// remote script"));
});
afterEach(() => { vi.unstubAllGlobals(); });

const disabled = { name: "CustomSourceDisabledError" };

describe("WebDAV 音源总开关", () => {
  it.each(["upload", "download"])("关闭时 %s 明确拒绝且零网络，不清空本地源", async (direction) => {
    fixture.saved.featureEnabled = false;
    const api = await load();
    const original = api.useCustomSourceStore.getState().sources;
    const run = direction === "upload" ? api.uploadSourcesSync() : api.downloadSourcesSync({ force: true });
    await expect(run).rejects.toMatchObject(disabled);
    expect(fixture.loadSettings).not.toHaveBeenCalled();
    expect(fixture.request).not.toHaveBeenCalled();
    expect(api.useCustomSourceStore.getState().sources).toEqual(original);
    expect(localStorage.setItem).not.toHaveBeenCalled();
  });

  it.each(["upload", "download"])("%s 等待 hydration 后再判断关闭状态", async (direction) => {
    const hydration = deferred<void>();
    fixture.hydration = hydration.promise;
    fixture.saved.featureEnabled = false;
    const api = await load(false);
    const run = direction === "upload" ? api.uploadSourcesSync() : api.downloadSourcesSync({ force: true });
    const result = run.then(() => ({ error: null }), (error: unknown) => ({ error }));
    await Promise.resolve();
    const settingsCallsBeforeHydration = fixture.loadSettings.mock.calls.length;
    const networkCallsBeforeHydration = fixture.request.mock.calls.length;
    hydration.resolve();
    const outcome = await result;
    expect(settingsCallsBeforeHydration).toBe(0);
    expect(networkCallsBeforeHydration).toBe(0);
    expect(outcome.error).toMatchObject(disabled);
  });

  it("开启时上传原始源但不把本机开关写入远端", async () => {
    fixture.saved.sources = [{ ...source, featureEnabled: true, featureReady: true }];
    const api = await load();
    await api.uploadSourcesSync();
    const [url, init] = fixture.request.mock.calls.find(([, init]) => init.method === "PUT")!;
    expect(url).toBe(`${config.webdavUrl}/AuralFlow/user_apis.json`);
    const payload = JSON.parse(init.body);
    expect(payload.data).toHaveLength(1);
    expect(payload.data[0]).toMatchObject({ id: source.id, script: source.script });
    expect(init.body).not.toMatch(/featureEnabled|featureReady/);
    expect(api.useCustomSourceStore.getState().sources[0].enabled).toBe(false);
  });

  it("下载只替换 sources，远端开关字段不能污染本机开关", async () => {
    const api = await load();
    const original = api.useCustomSourceStore.getState().sources;
    await api.downloadSourcesSync({ force: true });
    const state = api.useCustomSourceStore.getState();
    expect(state.featureEnabled).toBe(true);
    expect(state.featureReady).toBe(true);
    expect(state.sources).toHaveLength(1);
    expect(state.sources[0].id).toBe("remote-source");
    expect(state.sources[0]).not.toHaveProperty("featureEnabled");
    expect(state.sources[0]).not.toHaveProperty("featureReady");
    expect(JSON.parse(localStorage.getItem(backupKey)!)["payload"]).toEqual(original);
  });

  it("读取配置期间关闭再重开，不得继续发请求", async () => {
    const settings = deferred<typeof config>();
    const entered = deferred<void>();
    fixture.loadSettings.mockImplementation(() => { entered.resolve(); return settings.promise; });
    const api = await load();
    const run = api.uploadSourcesSync();
    const result = run.then(() => ({ error: null }), (error: unknown) => ({ error }));
    await entered.promise;
    await api.useCustomSourceStore.getState().setFeatureEnabled(false);
    await api.useCustomSourceStore.getState().setFeatureEnabled(true);
    settings.resolve(config);
    expect((await result).error).toMatchObject(disabled);
    expect(fixture.request).not.toHaveBeenCalled();
  });

  it("目录探测中关闭，不继续 MKCOL 或音源 PUT", async () => {
    const probe = deferred<OutboundResponse>();
    const entered = deferred<void>();
    fixture.request.mockImplementation(() => { entered.resolve(); return probe.promise; });
    const api = await load();
    const run = api.uploadSourcesSync();
    const result = run.then(() => ({ error: null }), (error: unknown) => ({ error }));
    await entered.promise;
    await api.useCustomSourceStore.getState().setFeatureEnabled(false);
    probe.resolve(response("", 404));
    expect((await result).error).toMatchObject(disabled);
    expect(fixture.request.mock.calls.map(([, init]) => init.method)).toEqual(["PROPFIND"]);
    expect(localStorage.setItem).not.toHaveBeenCalled();
  });

  it("已发出的 PUT 不能撤回，但关闭后不提交本地同步标记", async () => {
    const put = deferred<OutboundResponse>();
    const entered = deferred<void>();
    fixture.request.mockImplementation(async (_url: string, init: { method: string }) => {
      if (init.method === "PUT") { entered.resolve(); return put.promise; }
      return response();
    });
    const api = await load();
    const run = api.uploadSourcesSync();
    const result = run.then(() => ({ error: null }), (error: unknown) => ({ error }));
    await entered.promise;
    await api.useCustomSourceStore.getState().setFeatureEnabled(false);
    put.resolve(response());
    expect((await result).error).toMatchObject(disabled);
    expect(fixture.request.mock.calls.filter(([, init]) => init.method === "PUT")).toHaveLength(1);
    expect(localStorage.getItem(metaKey)).toBeNull();
  });

  it("下载中关闭，不回退读取旧目录且不写备份或本地源", async () => {
    const get = deferred<OutboundResponse>();
    const entered = deferred<void>();
    fixture.request.mockImplementation(() => { entered.resolve(); return get.promise; });
    const api = await load();
    const original = api.useCustomSourceStore.getState().sources;
    const run = api.downloadSourcesSync({ force: true });
    const result = run.then(() => ({ error: null }), (error: unknown) => ({ error }));
    await entered.promise;
    await api.useCustomSourceStore.getState().setFeatureEnabled(false);
    get.resolve(response("", 404));
    expect((await result).error).toMatchObject(disabled);
    expect(fixture.request).toHaveBeenCalledTimes(1);
    expect(api.useCustomSourceStore.getState().sources).toEqual(original);
    expect(localStorage.setItem).not.toHaveBeenCalled();
  });

  it("脚本解压中关闭再开启，旧下载仍不能 replaceAll 或写备份", async () => {
    const inflate = deferred<Uint8Array>();
    const entered = deferred<void>();
    fixture.request.mockResolvedValue(response(remoteSources("gz_dGVzdA==")));
    fixture.inflate.mockImplementation(() => { entered.resolve(); return inflate.promise; });
    const api = await load();
    const original = api.useCustomSourceStore.getState().sources;
    const run = api.downloadSourcesSync({ force: true });
    const result = run.then(() => ({ error: null }), (error: unknown) => ({ error }));
    await entered.promise;
    await api.useCustomSourceStore.getState().setFeatureEnabled(false);
    await api.useCustomSourceStore.getState().setFeatureEnabled(true);
    inflate.resolve(new TextEncoder().encode("// remote script"));
    expect((await result).error).toMatchObject(disabled);
    expect(api.useCustomSourceStore.getState().sources).toEqual(original);
    expect(localStorage.setItem).not.toHaveBeenCalled();
  });

  it("关闭音源后歌单手动上传和下载仍正常工作", async () => {
    fixture.saved.featureEnabled = false;
    const api = await load();
    const { useFavoritesStore } = await import("../src/stores/favoritesStore");
    const localSong = { ...remoteSong, id: "local-song" };
    useFavoritesStore.setState({ favorites: [localSong] });
    fixture.request.mockImplementation(async (_url: string, init: { method: string }) =>
      response(init.method === "GET" ? JSON.stringify({ version: "3", lastModified: 2000, data: { loveList: [remoteSong], userList: [] } }) : ""));
    await api.downloadPlaylistsSync();
    await api.uploadPlaylistsSync();
    expect(useFavoritesStore.getState().favorites.map((song) => song.id).sort()).toEqual(["local-song", "remote-song"]);
    const put = fixture.request.mock.calls.find(([, init]) => init.method === "PUT")!;
    expect(put[0]).toContain("/playlists.json");
    expect(JSON.parse(put[1].body).data.loveList).toHaveLength(2);
    expect(fixture.request.mock.calls.some(([url]) => url.includes("user_apis.json"))).toBe(false);
    expect(api.useCustomSourceStore.getState().featureEnabled).toBe(false);
  });

  it("关闭音源后歌单自动同步仍只读写歌单文件", async () => {
    fixture.saved.featureEnabled = false;
    const api = await load();
    fixture.request.mockImplementation(async (_url: string, init: { method: string }) =>
      response("", init.method === "GET" ? 404 : 200));
    await api.autoSyncPlaylistsOnce();
    expect(fixture.request.mock.calls.some(([url, init]) => url.endsWith("/playlists.json") && init.method === "PUT")).toBe(true);
    expect(fixture.request.mock.calls.some(([url]) => url.includes("user_apis.json"))).toBe(false);
  });
});

/** 等一个事件循环轮次，区分已取消的应用等待与仍未返回的外部请求。 */
function nextTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function settledBeforeExternalResponse<T>(result: Promise<T>) {
  return Promise.race([result, nextTurn().then(() => ({ pending: true }))]);
}

describe("关闭 LX 时释放应用同步等待", () => {
  it.each(["upload", "download"])("%s 请求未返回时关闭，歌单同步不再被占用", async (direction) => {
    const pending = deferred<OutboundResponse>();
    const entered = deferred<void>();
    fixture.request.mockImplementation(async (url: string) => {
      if (url.endsWith("/user_apis.json")) { entered.resolve(); return pending.promise; }
      return response();
    });
    const api = await load();
    const original = api.useCustomSourceStore.getState().sources;
    const run = direction === "upload" ? api.uploadSourcesSync() : api.downloadSourcesSync({ force: true });
    const result = run.then(() => ({ error: null }), (error: unknown) => ({ error }));
    await entered.promise;
    await api.useCustomSourceStore.getState().setFeatureEnabled(false);
    const cancelled = await settledBeforeExternalResponse(result);
    const playlistError = await api.uploadPlaylistsSync().then(() => null, (error: unknown) => error);
    pending.resolve(response(remoteSources()));
    await result;
    await nextTurn();
    expect(cancelled).toMatchObject({ error: disabled });
    expect(playlistError).toBeNull();
    expect(api.useCustomSourceStore.getState().sources).toEqual(original);
    expect(localStorage.getItem(metaKey)).toBeNull();
    expect(localStorage.getItem(backupKey)).toBeNull();
  });

  it.each(["settings", "body", "inflate"])("在 %s 阶段等待时关闭，也立即结束应用等待", async (stage) => {
    const pending = deferred<unknown>();
    const entered = deferred<void>();
    const pause = () => { entered.resolve(); return pending.promise; };
    const sourceBody = remoteSources(stage === "inflate" ? "gz_dGVzdA==" : "// remote script");
    fixture.request.mockImplementation(async (url: string) => {
      if (!url.endsWith("/user_apis.json")) return response();
      if (stage === "body") return { ...response(), text: pause };
      return response(sourceBody);
    });
    if (stage === "settings") fixture.loadSettings.mockImplementationOnce(pause);
    if (stage === "inflate") fixture.inflate.mockImplementationOnce(pause);
    const api = await load();
    const original = api.useCustomSourceStore.getState().sources;
    const result = api.downloadSourcesSync({ force: true }).then(() => ({ error: null }), (error: unknown) => ({ error }));
    await entered.promise;
    await api.useCustomSourceStore.getState().setFeatureEnabled(false);
    const cancelled = await settledBeforeExternalResponse(result);
    const playlistError = await api.uploadPlaylistsSync().then(() => null, (error: unknown) => error);
    pending.resolve(stage === "settings" ? config : stage === "body" ? sourceBody : new TextEncoder().encode("// remote script"));
    await result;
    await nextTurn();
    expect(cancelled).toMatchObject({ error: disabled });
    expect(playlistError).toBeNull();
    expect(api.useCustomSourceStore.getState().sources).toEqual(original);
    expect(localStorage.getItem(metaKey)).toBeNull();
    expect(localStorage.getItem(backupKey)).toBeNull();
  });

  it("取消等待后旧 PUT 仍在途，重开 LX 不能发起相互覆盖的第二个音源写入", async () => {
    const pending = deferred<OutboundResponse>();
    const entered = deferred<void>();
    let sourcePuts = 0;
    fixture.request.mockImplementation(async (url: string, init: { method: string }) => {
      if (url.endsWith("/user_apis.json") && init.method === "PUT") {
        sourcePuts += 1;
        if (sourcePuts === 1) { entered.resolve(); return pending.promise; }
      }
      return response();
    });
    const api = await load();
    const result = api.uploadSourcesSync().then(() => ({ error: null }), (error: unknown) => ({ error }));
    await entered.promise;
    await api.useCustomSourceStore.getState().setFeatureEnabled(false);
    const cancelled = await settledBeforeExternalResponse(result);
    await api.useCustomSourceStore.getState().setFeatureEnabled(true);
    const nextSourceError = await api.uploadSourcesSync().then(() => null, (error: Error) => error.message);
    const playlistError = await api.uploadPlaylistsSync().then(() => null, (error: unknown) => error);
    const putsBeforeFinish = sourcePuts;
    pending.resolve(response());
    await result;
    await nextTurn();
    expect(cancelled).toMatchObject({ error: disabled });
    expect(nextSourceError).toContain("正在同步");
    expect(playlistError).toBeNull();
    expect(putsBeforeFinish).toBe(1);
    expect(localStorage.getItem(metaKey)).toBeNull();
    await api.uploadSourcesSync();
    expect(sourcePuts).toBe(2);
  });

  it("LX 开关变化不取消已有歌单同步，同类歌单操作仍互斥", async () => {
    const pending = deferred<OutboundResponse>();
    const entered = deferred<void>();
    fixture.request.mockImplementation(async (url: string, init: { method: string }) => {
      if (url.endsWith("/playlists.json") && init.method === "PUT") { entered.resolve(); return pending.promise; }
      return response();
    });
    const api = await load();
    const result = api.uploadPlaylistsSync().then(() => ({ error: null }), (error: unknown) => ({ error }));
    await entered.promise;
    await api.useCustomSourceStore.getState().setFeatureEnabled(false);
    const stillPending = await settledBeforeExternalResponse(result);
    const duplicateError = await api.uploadPlaylistsSync().then(() => null, (error: Error) => error.message);
    pending.resolve(response());
    expect(await result).toEqual({ error: null });
    expect(stillPending).toEqual({ pending: true });
    expect(duplicateError).toContain("正在同步");
  });
});
