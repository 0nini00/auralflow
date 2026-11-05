import { afterEach, it, expect, vi } from "vitest";
const f = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), request: vi.fn() }));
vi.mock("@lx/tauri-bridge", () => ({
  libraryLoad: f.load, librarySave: f.save,
  loadSettings: vi.fn(async () => ({ webdavUrl: "https://invalid.test", webdavUsername: "mock", webdavPassword: "mock" })),
}));
vi.mock("@/services/outboundHttp", () => ({ outboundRequest: f.request }));
vi.mock("@/services/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/stores/wyAccountStore", () => ({ useWyAccountStore: { getState: () => ({ playlists: [] }) } }));
vi.mock("@/stores/customSourceStore", () => ({
  useCustomSourceStore: { getState: () => ({ featureEnabled: false, sources: [] }) },
  customSourcePersistence: { ready: Promise.resolve() }, customSourceAccess: {},
}));
vi.mock("@/services/customSourceRuntime", () => ({ parseDesktopUserApiInfo: vi.fn() }));

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("收藏读盘失败时拒绝上传，不能用空快照覆盖远端", async () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string,v: string) => values.set(k,v), removeItem: (k: string) => values.delete(k) });
  vi.spyOn(console, "error").mockImplementation(() => {});
  f.load.mockImplementation(async (namespace: string) => {
    if (namespace === "favorites") throw new Error("simulated disk failure");
    return null;
  });
  f.save.mockResolvedValue(undefined);
  f.request.mockResolvedValue({ ok: true, status: 200, statusText: "OK", headers: {}, text: async () => "" });
  const { favoritesPersistence } = await import("@/stores/favoritesStore");
  const { playlistPersistence } = await import("@/stores/playlistStore");
  const { historyPersistence } = await import("@/stores/historyStore");
  await Promise.all([favoritesPersistence.ready, playlistPersistence.ready, historyPersistence.ready]);
  expect(favoritesPersistence.loadError?.message).toBe("simulated disk failure");
  const { uploadPlaylistsSync } = await import("@/services/webdavSyncService");
  await expect(uploadPlaylistsSync()).rejects.toThrow("simulated disk failure");
  const puts = f.request.mock.calls.filter(([, init]) => init.method === "PUT");
  expect(puts).toHaveLength(0);
});
