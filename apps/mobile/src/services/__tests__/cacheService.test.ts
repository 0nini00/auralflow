import { beforeEach, describe, expect, it, vi } from "vitest";

const rnfs = vi.hoisted(() => {
  const store = new Map<string, number>(); // path -> size
  return {
    store,
    CachesDirectoryPath: "/cache",
    exists: vi.fn((p: string) => Promise.resolve(store.has(p))),
    stat: vi.fn((p: string) => Promise.resolve({ size: store.get(p) ?? 0, mtime: new Date() })),
    downloadFile: vi.fn((opts: { fromUrl: string; toFile: string }) => {
      store.set(opts.toFile, 1024);
      return { promise: Promise.resolve({ statusCode: 200 }) };
    }),
    unlink: vi.fn((p: string) => {
      store.delete(p);
      return Promise.resolve();
    }),
    mkdir: vi.fn(() => Promise.resolve()),
    readFile: vi.fn(() => Promise.resolve("{}")),
    writeFile: vi.fn(() => Promise.resolve()),
    getFSInfo: vi.fn(() => Promise.resolve({ freeSpace: 1024 ** 4 })),
  };
});

vi.mock("react-native-fs", () => ({ default: rnfs, ...rnfs }));

import type { MusicInfo } from "@lx/core";
import {
  cacheAudioFile,
  getCachedAudioFile,
  isLocalFilePlayable,
  CACHEABLE_AUDIO_SOURCES,
} from "../cacheService";

function makeSong(source: string, id: string): MusicInfo {
  return {
    id,
    name: "s",
    singer: "a",
    albumName: "",
    source: source as MusicInfo["source"],
  } as MusicInfo;
}

describe("cacheService 音频缓存", () => {
  beforeEach(() => {
    rnfs.store.clear();
    rnfs.downloadFile.mockImplementation((opts: { fromUrl: string; toFile: string }) => {
      rnfs.store.set(opts.toFile, 1024);
      return { promise: Promise.resolve({ statusCode: 200 }) };
    });
  });

  it("CACHEABLE_AUDIO_SOURCES 仅含 wy/tx", () => {
    expect([...CACHEABLE_AUDIO_SOURCES]).toEqual(["wy", "tx"]);
  });

  it("cacheAudioFile 下载成功返回 file:// 并落盘", async () => {
    const song = makeSong("wy", "1");
    const path = await cacheAudioFile("https://x/a.mp3", song, "320k");
    expect(path).toMatch(/^file:\/\//);
    expect(rnfs.downloadFile).toHaveBeenCalledTimes(1);
  });

  it("重复下载命中本地，不重复请求", async () => {
    const song = makeSong("wy", "1");
    const first = await cacheAudioFile("https://x/a.mp3", song, "320k");
    rnfs.downloadFile.mockClear();
    const second = await cacheAudioFile("https://x/a.mp3", song, "320k");
    expect(second).toBe(first);
    expect(rnfs.downloadFile).not.toHaveBeenCalled();
  });

  it("非 http(s) URL 不下载，直接返回 null", async () => {
    const song = makeSong("wy", "1");
    const path = await cacheAudioFile("file:///already/local.audio", song, "320k");
    expect(path).toBeNull();
    expect(rnfs.downloadFile).not.toHaveBeenCalled();
  });

  it("下载失败（非 2xx）返回 null 并清理文件", async () => {
    rnfs.downloadFile.mockImplementation((opts: { fromUrl: string; toFile: string }) => {
      rnfs.store.set(opts.toFile, 1024);
      return { promise: Promise.resolve({ statusCode: 500 }) };
    });
    const song = makeSong("wy", "1");
    const path = await cacheAudioFile("https://x/a.mp3", song, "320k");
    expect(path).toBeNull();
    expect(rnfs.store.has("/cache/auralflow/audio/wy-1-320k.audio")).toBe(false);
  });

  it("getCachedAudioFile 存在返回 file://，不存在返回 null", async () => {
    const song = makeSong("wy", "1");
    expect(await getCachedAudioFile(song, "320k")).toBeNull();
    await cacheAudioFile("https://x/a.mp3", song, "320k");
    expect(await getCachedAudioFile(song, "320k")).toMatch(/^file:\/\//);
  });

  it("isLocalFilePlayable 校验文件存在性", async () => {
    expect(await isLocalFilePlayable("file:///nope.audio")).toBe(false);
    const song = makeSong("wy", "1");
    const path = await cacheAudioFile("https://x/a.mp3", song, "320k");
    expect(await isLocalFilePlayable(path!)).toBe(true);
  });
});
