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
    removeItem: vi.fn((key: string) => {
      data.delete(key);
      return Promise.resolve();
    }),
    clear: () => data.clear(),
  };
});

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: storage,
}));

const WY_COOKIE_KEY = "auralflow.mobile.wy.cookie";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

describe("wy playlist service subscribe", () => {
  beforeEach(() => {
    storage.clear();
    vi.unstubAllGlobals();
  });

  it("posts a pc-cookie weapi request for playlist subscribe", async () => {
    storage.data.set(WY_COOKIE_KEY, "MUSIC_U=abc; os=ios; __csrf=token");
    const fetchMock = vi.fn((_: RequestInfo | URL, __?: RequestInit) => Promise.resolve(jsonResponse({ code: 200 })));
    vi.stubGlobal("fetch", fetchMock);
    const { subscribePlaylist } = await import("@/services/wyPlaylistService");

    await subscribePlaylist("123", true);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://music.163.com/weapi/playlist/subscribe",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Cookie: "MUSIC_U=abc; __csrf=token; os=pc",
          "Content-Type": "application/x-www-form-urlencoded",
        }),
      }),
    );
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain("params=");
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain("encSecKey=");
  });

  it("throws when playlist subscribe fails", async () => {
    storage.data.set(WY_COOKIE_KEY, "MUSIC_U=abc");
    vi.stubGlobal(
      "fetch",
      vi.fn((_: RequestInfo | URL, __?: RequestInit) => Promise.resolve(jsonResponse({ code: 500, message: "failed" }))),
    );
    const { subscribePlaylist } = await import("@/services/wyPlaylistService");

    await expect(subscribePlaylist("123", false)).rejects.toThrow("failed");
  });

  it("posts a weapi request to add tracks to an owned playlist", async () => {
    storage.data.set(WY_COOKIE_KEY, "MUSIC_U=abc; __csrf=token");
    const fetchMock = vi.fn((_: RequestInfo | URL, __?: RequestInit) => Promise.resolve(jsonResponse({ code: 200 })));
    vi.stubGlobal("fetch", fetchMock);
    const { addPlaylistTracks } = await import("@/services/wyPlaylistService");

    await addPlaylistTracks("playlist-1", ["song-1"]);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://music.163.com/weapi/playlist/manipulate/tracks",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Cookie: "MUSIC_U=abc; __csrf=token; os=pc",
          "Content-Type": "application/x-www-form-urlencoded",
        }),
      }),
    );
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain("params=");
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain("encSecKey=");
  });

  it("throws when adding tracks to a playlist fails", async () => {
    storage.data.set(WY_COOKIE_KEY, "MUSIC_U=abc");
    vi.stubGlobal(
      "fetch",
      vi.fn((_: RequestInfo | URL, __?: RequestInit) => Promise.resolve(jsonResponse({ code: 500, message: "add failed" }))),
    );
    const { addPlaylistTracks } = await import("@/services/wyPlaylistService");

    await expect(addPlaylistTracks("playlist-1", ["song-1"])).rejects.toThrow("add failed");
  });

  it("posts a weapi request to remove tracks from an owned playlist", async () => {
    storage.data.set(WY_COOKIE_KEY, "MUSIC_U=abc; __csrf=token");
    const fetchMock = vi.fn((_: RequestInfo | URL, __?: RequestInit) => Promise.resolve(jsonResponse({ code: 200 })));
    vi.stubGlobal("fetch", fetchMock);
    const { removePlaylistTracks } = await import("@/services/wyPlaylistService");

    await removePlaylistTracks("playlist-1", ["song-1"]);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://music.163.com/weapi/playlist/manipulate/tracks",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Cookie: "MUSIC_U=abc; __csrf=token; os=pc",
          "Content-Type": "application/x-www-form-urlencoded",
        }),
      }),
    );
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain("params=");
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain("encSecKey=");
  });

  it("throws when removing tracks from a playlist fails", async () => {
    storage.data.set(WY_COOKIE_KEY, "MUSIC_U=abc");
    vi.stubGlobal(
      "fetch",
      vi.fn((_: RequestInfo | URL, __?: RequestInit) => Promise.resolve(jsonResponse({ code: 500, message: "remove failed" }))),
    );
    const { removePlaylistTracks } = await import("@/services/wyPlaylistService");

    await expect(removePlaylistTracks("playlist-1", ["song-1"])).rejects.toThrow("remove failed");
  });
});
