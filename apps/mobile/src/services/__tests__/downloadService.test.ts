import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MusicInfo } from "@lx/core";

const rnfs = vi.hoisted(() => ({
  DocumentDirectoryPath: "/documents",
  exists: vi.fn((path: string) => Promise.resolve(path === "/documents/auralflow")),
  mkdir: vi.fn(() => Promise.resolve()),
  stat: vi.fn(() => Promise.resolve({ size: 100 })),
  unlink: vi.fn(() => Promise.resolve()),
  readDir: vi.fn(() => Promise.resolve([])),
  writeFile: vi.fn(() => Promise.resolve()),
  stopDownload: vi.fn(),
  downloadFile: vi.fn(() => ({
    jobId: 7,
    promise: Promise.resolve({ statusCode: 200 }),
  })),
}));

const musicApi = vi.hoisted(() => ({
  resolveSongUrl: vi.fn(() => Promise.resolve({ url: "https://example.test/song.mp3", quality: "320k" })),
  fetchSongLyrics: vi.fn(() => Promise.resolve([
    { time: 1.23, text: "第一句", tr: "Line one" },
    { time: 62.004, text: "第二句" },
  ])),
}));

vi.mock("react-native-fs", () => ({ default: rnfs }));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(() => Promise.resolve(null)),
    setItem: vi.fn(() => Promise.resolve()),
  },
}));
vi.mock("@/services/musicApi", () => musicApi);
vi.mock("@/services/biliService", () => ({
  resolveBiliSongUrl: vi.fn(() => Promise.resolve({ url: "https://example.test/video.m4s" })),
}));

import { downloadSong } from "@/services/downloadService";

function song(overrides: Partial<MusicInfo> = {}): MusicInfo {
  return {
    id: "1",
    name: "测试歌曲",
    singer: "测试歌手",
    albumName: "测试专辑",
    source: "wy",
    ...overrides,
  };
}

describe("download service", () => {
  beforeEach(() => {
    rnfs.exists.mockClear();
    rnfs.mkdir.mockClear();
    rnfs.writeFile.mockClear();
    rnfs.downloadFile.mockClear();
    musicApi.resolveSongUrl.mockClear();
    musicApi.fetchSongLyrics.mockClear();
  });

  it("writes a sidecar lrc file after downloading an online song", async () => {
    await expect(downloadSong(song(), undefined, "320k")).resolves.toBe(
      "file:///documents/auralflow/downloads/wy-1-320k.mp3",
    );

    expect(musicApi.fetchSongLyrics).toHaveBeenCalledWith(song());
    expect(rnfs.writeFile).toHaveBeenCalledWith(
      "/documents/auralflow/downloads/wy-1-320k.lrc",
      "[00:01.230]第一句\n[00:01.230]Line one\n[01:02.004]第二句\n",
      "utf8",
    );
  });
});
