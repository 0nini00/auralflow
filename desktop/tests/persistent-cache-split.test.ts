import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MusicInfo } from "@lx/core";

/**
 * 设置页把缓存拆成「资源缓存」和「歌曲元信息缓存」两组后，
 * 三个清理入口必须互不影响，统计口径也要能对上。
 */

const fixture = vi.hoisted(() => {
  const files = new Map<string, unknown>();
  const state = { featureEnabled: true, featureReady: true };
  return {
    files,
    state,
    libraryLoad: vi.fn(async (namespace: string) => files.get(namespace) ?? null),
    librarySave: vi.fn(async (namespace: string, value: unknown) => {
      files.set(namespace, value);
    }),
  };
});

vi.mock("../src/stores/customSourceStore", () => ({
  useCustomSourceStore: { getState: () => fixture.state },
  customSourceAccess: { version: 0 },
  customSourcePersistence: { ready: Promise.resolve() },
}));
vi.mock("@lx/tauri-bridge", () => ({
  libraryLoad: fixture.libraryLoad,
  librarySave: fixture.librarySave,
}));

function music(id: string, source = "wy"): MusicInfo {
  return { id, source, name: `歌曲${id}`, singer: "歌手" } as MusicInfo;
}

function urlEntry(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    url: "https://cdn.example/a.mp3",
    music: music("1"),
    quality: "320k",
    backend: "builtinNetease",
    resolverName: "gateway",
    cachedAt: now,
    expiresAt: now + 60_000,
    ...overrides,
  };
}

function lyricEntry(expiresIn = 60_000) {
  const now = Date.now();
  return {
    response: { lines: [{ time: 0, text: "歌词" }] },
    cachedAt: now,
    expiresAt: now + expiresIn,
  };
}

async function loadModule() {
  return import("../src/services/persistentCache");
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  fixture.files.clear();
  fixture.state.featureEnabled = true;
  fixture.state.featureReady = true;
});

describe("持久化缓存统计", () => {
  it("URL 按歌曲去重、过期条目不计；歌词只计未过期", async () => {
    const { CACHE_VERSION, getPersistentCacheSummary } = await loadModule();
    fixture.files.set("cache", {
      version: CACHE_VERSION,
      playbackUrls: {
        "wy:1:128k": urlEntry(),
        "wy:1:320k": urlEntry({ quality: "320k" }),
        "wy:2:320k": urlEntry({ music: music("2") }),
        "wy:3:320k": urlEntry({ music: music("3"), expiresAt: Date.now() - 1 }),
      },
      lyrics: {
        "wy:1": lyricEntry(),
        "wy:2": lyricEntry(-1),
      },
    });

    await expect(getPersistentCacheSummary()).resolves.toEqual({
      playbackUrlCount: 2,
      lyricCount: 1,
    });
  });

  it("本地文件地址不受 TTL 约束，过期后仍计入", async () => {
    const { CACHE_VERSION, getPersistentCacheSummary } = await loadModule();
    fixture.files.set("cache", {
      version: CACHE_VERSION,
      playbackUrls: {
        "wy:1:320k": urlEntry({
          url: "http://asset.localhost/audio.mp3",
          expiresAt: Date.now() - 1,
        }),
      },
      lyrics: {},
    });

    await expect(getPersistentCacheSummary()).resolves.toEqual({
      playbackUrlCount: 1,
      lyricCount: 0,
    });
  });
});

describe("分开清理", () => {
  it("清歌曲 URL 缓存不影响歌词", async () => {
    const { CACHE_VERSION, clearCachedPlaybackUrls } = await loadModule();
    fixture.files.set("cache", {
      version: CACHE_VERSION,
      playbackUrls: { "wy:1:320k": urlEntry() },
      lyrics: { "wy:1": lyricEntry() },
    });

    await clearCachedPlaybackUrls();

    const saved = fixture.files.get("cache") as {
      playbackUrls: Record<string, unknown>;
      lyrics: Record<string, unknown>;
    };
    expect(saved.playbackUrls).toEqual({});
    expect(Object.keys(saved.lyrics)).toEqual(["wy:1"]);
  });

  it("清歌词缓存不影响播放 URL", async () => {
    const { CACHE_VERSION, clearCachedLyrics } = await loadModule();
    fixture.files.set("cache", {
      version: CACHE_VERSION,
      playbackUrls: { "wy:1:320k": urlEntry() },
      lyrics: { "wy:1": lyricEntry() },
    });

    await clearCachedLyrics();

    const saved = fixture.files.get("cache") as {
      playbackUrls: Record<string, unknown>;
      lyrics: Record<string, unknown>;
    };
    expect(Object.keys(saved.playbackUrls)).toEqual(["wy:1:320k"]);
    expect(saved.lyrics).toEqual({});
  });

  it("清理资源缓存后，只摘掉指向本地文件的引用", async () => {
    const { CACHE_VERSION, invalidateCachedLocalMedia } = await loadModule();
    fixture.files.set("cache", {
      version: CACHE_VERSION,
      playbackUrls: {
        // 音频本身是本地文件：文件已删，条目整条作废
        "wy:1:320k": urlEntry({ url: "http://asset.localhost/a.mp3" }),
        // 远端音频 + 本地封面：保留条目，摘掉封面字段
        "wy:2:320k": urlEntry({
          music: { ...music("2"), picUrl: "http://asset.localhost/c.jpg", img: "http://asset.localhost/c.jpg" },
        }),
        // 全是远端地址：一条都不动
        "wy:3:320k": urlEntry({
          music: { ...music("3"), picUrl: "https://cdn.example/c.jpg", img: "https://cdn.example/c.jpg" },
        }),
      },
      lyrics: { "wy:1": lyricEntry() },
    });

    await invalidateCachedLocalMedia();

    const saved = fixture.files.get("cache") as {
      playbackUrls: Record<string, { music: MusicInfo }>;
      lyrics: Record<string, unknown>;
    };
    expect(Object.keys(saved.playbackUrls).sort()).toEqual(["wy:2:320k", "wy:3:320k"]);
    expect(saved.playbackUrls["wy:2:320k"].music.picUrl).toBeUndefined();
    expect(saved.playbackUrls["wy:2:320k"].music.img).toBeUndefined();
    expect(saved.playbackUrls["wy:3:320k"].music.picUrl).toBe("https://cdn.example/c.jpg");
    // 元信息缓存里的歌词不因资源清理而丢失
    expect(Object.keys(saved.lyrics)).toEqual(["wy:1"]);
  });
});
