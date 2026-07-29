import { describe, expect, it } from "vitest";
import type { MusicInfo } from "@lx/core";

import {
  buildCompletedDownloadMetadata,
  buildDownloadingMetadata,
  getDownloadFileName,
} from "@/services/downloadListMetadataModel";

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

describe("download list metadata model", () => {
  it("extracts a readable file name from stored download paths", () => {
    expect(getDownloadFileName("file:///documents/auralflow/downloads/wy-1-320k.mp3")).toBe("wy-1-320k.mp3");
    expect(getDownloadFileName("/documents/auralflow/downloads/tx-2-flac.flac")).toBe("tx-2-flac.flac");
  });

  it("shows completed download file name and stored size", () => {
    expect(
      buildCompletedDownloadMetadata({
        song: song(),
        quality: "320k",
        localPath: "file:///documents/auralflow/downloads/wy-1-320k.mp3",
        downloadDate: 123,
        fileSize: 5242880,
      }),
    ).toEqual({
      titleMeta: "测试歌手 · 320k",
      statusLabel: "已下载",
      detailLabel: "wy-1-320k.mp3 · 5.0 MB",
    });
  });

  it("shows downloaded and total sizes for active downloads", () => {
    expect(
      buildDownloadingMetadata({
        song: song(),
        quality: "flac",
        progress: 0.5,
        bytesWritten: 1048576,
        contentLength: 4194304,
      }),
    ).toEqual({
      titleMeta: "测试歌手 · flac",
      statusLabel: "下载中 50%",
      detailLabel: "1.0 MB / 4.0 MB",
    });
  });
});
