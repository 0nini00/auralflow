import { afterEach, expect, it, vi } from "vitest";
import type { MusicInfo } from "@lx/core";

const f = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), request: vi.fn() }));
vi.mock("@lx/tauri-bridge", () => ({
  libraryLoad: f.load,
  librarySave: f.save,
  loadSettings: vi.fn(async () => ({ webdavUrl: "https://invalid.test", webdavUsername: "mock", webdavPassword: "mock" })),
}));
vi.mock("@/services/outboundHttp", () => ({ outboundRequest: f.request }));
vi.mock("@/services/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/stores/wyAccountStore", () => ({ useWyAccountStore: { getState: () => ({ playlists: [] }) } }));
vi.mock("@/stores/customSourceStore", () => ({
  useCustomSourceStore: { getState: () => ({ featureEnabled: false, sources: [] }) },
  customSourcePersistence: { ready: Promise.resolve() },
  customSourceAccess: {},
}));
vi.mock("@/services/customSourceRuntime", () => ({ parseDesktopUserApiInfo: vi.fn() }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("同曲不同天的历史按条目往返 WebDAV，不被压成一条", async () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  f.load.mockResolvedValue(null);
  f.save.mockResolvedValue(undefined);
  const response = { ok: true, status: 200, statusText: "OK", headers: {}, text: async () => "" };
  f.request.mockResolvedValue(response);

  const { useHistoryStore, historyPersistence } = await import("@/stores/historyStore");
  const { favoritesPersistence } = await import("@/stores/favoritesStore");
  const { playlistPersistence } = await import("@/stores/playlistStore");
  await Promise.all([historyPersistence.ready, favoritesPersistence.ready, playlistPersistence.ready]);

  const song: MusicInfo = { id: "a", source: "wy", name: "Song", singer: "Artist", albumName: "" };
  // 上传只带最近 180 天：测试数据必须落在窗口内。
  const day1 = Date.now() - 2 * 24 * 60 * 60 * 1000;
  const day2 = Date.now() - 1 * 24 * 60 * 60 * 1000;
  useHistoryStore.getState().replaceAll([
    { key: "wy:a", song, playedAt: day2 },
    { key: "wy:a", song, playedAt: day1 },
  ]);

  let body = "";
  f.request.mockImplementation(async (_url: string, init: { method: string; body?: string }) => {
    if (init.method === "PUT") body = init.body ?? "";
    return response;
  });

  const { downloadPlaylistsSync, uploadPlaylistsSync } = await import("@/services/webdavSyncService");
  await uploadPlaylistsSync();

  const payload = JSON.parse(body) as { playHistory: Array<{ id: string; playedAt: number }> };
  expect(payload.playHistory.map((item) => item.id)).toEqual([`wy_a_${day2}`, `wy_a_${day1}`]);
  expect(payload.playHistory.map((item) => item.playedAt)).toEqual([day2, day1]);

  useHistoryStore.getState().clear();
  f.request.mockResolvedValue({ ...response, text: async () => JSON.stringify(payload) });
  await downloadPlaylistsSync({ force: true });

  expect(useHistoryStore.getState().entries.map((entry) => entry.playedAt)).toEqual([day2, day1]);
});

it("超过 180 天的历史只留在本地，不上传", async () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  f.load.mockResolvedValue(null);
  f.save.mockResolvedValue(undefined);
  const response = { ok: true, status: 200, statusText: "OK", headers: {}, text: async () => "" };
  f.request.mockResolvedValue(response);

  const { useHistoryStore, historyPersistence } = await import("@/stores/historyStore");
  await historyPersistence.ready;

  const recent = Date.now() - 10 * 24 * 60 * 60 * 1000;
  const old = Date.now() - 200 * 24 * 60 * 60 * 1000;
  useHistoryStore.getState().replaceAll([
    { key: "wy:recent", song: { id: "recent", source: "wy", name: "Recent", singer: "S", albumName: "" }, playedAt: recent },
    { key: "wy:old", song: { id: "old", source: "wy", name: "Old", singer: "S", albumName: "" }, playedAt: old },
  ]);

  let body = "";
  f.request.mockImplementation(async (_url: string, init: { method: string; body?: string }) => {
    if (init.method === "PUT") body = init.body ?? "";
    return response;
  });
  const { uploadPlaylistsSync } = await import("@/services/webdavSyncService");
  await uploadPlaylistsSync();

  const payload = JSON.parse(body) as { playHistory: Array<{ musicInfo: { id: string } }> };
  expect(payload.playHistory.map((item) => item.musicInfo.id)).toEqual(["recent"]);
  // 本地仍然保留老记录，只是不同步。
  expect(useHistoryStore.getState().entries.map((entry) => entry.key).sort()).toEqual(["wy:old", "wy:recent"]);
});
