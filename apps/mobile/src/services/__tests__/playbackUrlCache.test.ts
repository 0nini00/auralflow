import { beforeEach, describe, expect, it, vi } from "vitest";

const asyncStorage = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (k: string) => Promise.resolve(store.get(k) ?? null),
    setItem: (k: string, v: string) => {
      store.set(k, v);
      return Promise.resolve();
    },
    removeItem: (k: string) => {
      store.delete(k);
      return Promise.resolve();
    },
  };
});

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: asyncStorage.getItem,
    setItem: asyncStorage.setItem,
    removeItem: asyncStorage.removeItem,
  },
}));

import type { MusicInfo } from "@lx/core";
import {
  getCachedPlaybackUrl,
  saveCachedPlaybackUrl,
  invalidateCachedPlaybackUrl,
  resetPlaybackUrlCacheMemory,
} from "../playbackUrlCache";

function makeSong(over: Partial<MusicInfo> = {}): MusicInfo {
  return {
    id: "1",
    name: "song",
    singer: "a",
    albumName: "",
    source: "wy",
    ...over,
  } as MusicInfo;
}

describe("playbackUrlCache", () => {
  beforeEach(() => {
    asyncStorage.store.clear();
    resetPlaybackUrlCacheMemory();
  });

  it("冷启动后仍能命中落盘缓存（免重新解析网关）", async () => {
    const song = makeSong();
    await saveCachedPlaybackUrl(song, { url: "https://x/a.mp3", quality: "320k" });
    // 模拟冷启动：清空内存缓存，从 AsyncStorage 重新加载
    resetPlaybackUrlCacheMemory();
    const hit = await getCachedPlaybackUrl(song, ["flac", "320k", "128k"]);
    expect(hit).not.toBeNull();
    expect(hit!.fromCache).toBe(true);
    expect(hit!.url).toBe("https://x/a.mp3");
    expect(hit!.quality).toBe("320k");
  });

  it("按音质降级链查询，未缓存音质返回 miss", async () => {
    const song = makeSong();
    await saveCachedPlaybackUrl(song, { url: "https://x/a.mp3", quality: "flac" });
    const hit = await getCachedPlaybackUrl(song, ["128k"]);
    expect(hit).toBeNull();
  });

  it("过期条目视为 miss 并就地清理", async () => {
    const song = makeSong();
    await saveCachedPlaybackUrl(song, { url: "https://x/a.mp3", quality: "320k" });
    const future = Date.now() + 8 * 60 * 60 * 1000;
    const hit = await getCachedPlaybackUrl(song, ["320k"], undefined, future);
    expect(hit).toBeNull();
  });

  it("按歌曲整体失效缓存", async () => {
    const song = makeSong();
    await saveCachedPlaybackUrl(song, { url: "u", quality: "320k" });
    await invalidateCachedPlaybackUrl(song);
    const hit = await getCachedPlaybackUrl(song, ["320k"]);
    expect(hit).toBeNull();
  });

  it("B站条目保留请求头并支持命中即播", async () => {
    const bili = makeSong({ source: "bili", id: "bv1" });
    await saveCachedPlaybackUrl(bili, {
      url: "https://b/u.m4s",
      quality: "320k",
      headers: { Referer: "https://b.com" },
    });
    const hit = await getCachedPlaybackUrl(bili, ["320k"]);
    expect(hit!.headers?.Referer).toBe("https://b.com");
  });

  it("跨源变体可被另一源命中（对齐桌面端 variants[]）", async () => {
    const wy = makeSong({ source: "wy", id: "100" });
    const tx = makeSong({ source: "tx", id: "200" });
    (wy as MusicInfo & { variants?: MusicInfo[] }).variants = [tx];
    await saveCachedPlaybackUrl(wy, { url: "u", quality: "320k" });
    const hit = await getCachedPlaybackUrl(tx, ["320k"], [wy, tx]);
    expect(hit).not.toBeNull();
    expect(hit!.url).toBe("u");
  });
});
