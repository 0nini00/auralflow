import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: vi.fn((key: string) => Promise.resolve(data.get(key) ?? null)),
    setItem: vi.fn((key: string, value: string) => {
      data.set(key, value);
      return Promise.resolve();
    }),
    clear: () => data.clear(),
  };
});

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: storage,
}));

const customSourceStore = vi.hoisted(() => ({
  state: {
    sources: [] as any[],
    replaceAll: vi.fn((sources: any[]) => {
      customSourceStore.state.sources = sources;
    }),
  },
}));

vi.mock("@/stores/customSourceStore", () => ({
  useCustomSourceStore: {
    getState: () => customSourceStore.state,
  },
}));

vi.mock("@/stores/playlistStore", () => ({
  usePlaylistStore: {
    getState: () => ({
      likedSongs: [],
      playlists: [],
      localPlaylists: [],
      replaceAllFromSync: vi.fn(),
      replaceLocalPlaylists: vi.fn(),
    }),
  },
}));

vi.mock("@/stores/historyStore", () => ({
  useHistoryStore: {
    getState: () => ({
      history: [],
      replaceAllHistory: vi.fn(),
    }),
  },
}));

const CONFIG_KEY = "auralflow.mobile.webdavConfig";
const script = `/*
 * @name 测试音源
 * @description WebDAV 同步测试
 * @author tester
 * @version 1.2.3
 */
module.exports = {};
`;

function response(status: number, body = "", statusText = "OK"): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    text: () => Promise.resolve(body),
  } as Response;
}

function installFetch(remoteFiles: Map<string, string>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal("fetch", vi.fn((url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const method = init.method || "GET";
    if (method === "PROPFIND") return Promise.resolve(response(200));
    if (method === "MKCOL") return Promise.resolve(response(201));
    if (method === "PUT") {
      remoteFiles.set(url, String(init.body ?? ""));
      return Promise.resolve(response(200));
    }
    if (method === "GET") {
      const value = remoteFiles.get(url);
      return Promise.resolve(value == null ? response(404, "", "Not Found") : response(200, value));
    }
    if (method === "DELETE") return Promise.resolve(response(204));
    return Promise.resolve(response(405, "", "Method Not Allowed"));
  }));
  return calls;
}

describe("webdav custom source sync", () => {
  beforeEach(() => {
    storage.clear();
    storage.getItem.mockClear();
    storage.setItem.mockClear();
    customSourceStore.state.sources = [];
    customSourceStore.state.replaceAll.mockClear();
    vi.unstubAllGlobals();
    storage.data.set(CONFIG_KEY, JSON.stringify({
      url: "https://dav.example.com/dav/",
      username: "user",
      password: "pass",
    }));
  });

  it("uploads enabled custom source scripts in the desktop-compatible user_apis file", async () => {
    const remoteFiles = new Map<string, string>();
    installFetch(remoteFiles);
    customSourceStore.state.sources = [
      {
        id: "source-1",
        name: "测试音源",
        description: "WebDAV 同步测试",
        author: "tester",
        homepage: "https://example.com/source",
        version: "1.2.3",
        allowShowUpdateAlert: false,
        script,
        enabled: true,
        testStatus: "idle",
        updateStatus: "idle",
        createdAt: 1000,
        updatedAt: 1000,
      },
    ];

    const { uploadSourcesSync } = await import("@/services/webdavSyncService");

    await uploadSourcesSync();

    const uploaded = [...remoteFiles.entries()].find(([url]) => url.endsWith("/LX_Music/user_apis.json"));
    expect(uploaded).toBeDefined();
    expect(JSON.parse(uploaded?.[1] ?? "{}")).toEqual({
      version: "2",
      lastModified: expect.any(Number),
      data: [
        {
          id: "source-1",
          name: "测试音源",
          description: "WebDAV 同步测试",
          author: "tester",
          homepage: "https://example.com/source",
          version: "1.2.3",
          allowShowUpdateAlert: false,
          script,
        },
      ],
    });
  });

  it("downloads custom sources and replaces the mobile custom source store", async () => {
    const remoteFiles = new Map<string, string>();
    installFetch(remoteFiles);
    remoteFiles.set("https://dav.example.com/dav/LX_Music/user_apis.json", JSON.stringify({
      version: "2",
      lastModified: 123,
      data: [
        {
          id: "source-1",
          name: "远端音源",
          description: "远端说明",
          author: "remote",
          homepage: "https://example.com/remote",
          version: "2.0.0",
          allowShowUpdateAlert: true,
          script,
        },
      ],
    }));

    const { downloadSourcesSync } = await import("@/services/webdavSyncService");

    await downloadSourcesSync();

    expect(customSourceStore.state.replaceAll).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "source-1",
        name: "远端音源",
        description: "远端说明",
        author: "remote",
        homepage: "https://example.com/remote",
        version: "2.0.0",
        allowShowUpdateAlert: true,
        script,
        enabled: true,
        testStatus: "idle",
        updateStatus: "idle",
      }),
    ]);
  });
});
