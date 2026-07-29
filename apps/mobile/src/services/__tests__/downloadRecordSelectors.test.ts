import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { MusicInfo } from "@lx/core";
import {
  selectDownloadProgress,
  selectDownloadStatus,
} from "@/services/downloadRecordSelectors";

const song: MusicInfo = {
  id: "1",
  name: "Song",
  singer: "Singer",
  albumName: "Album",
  source: "wy",
  quality: "320k",
};

describe("download record selectors", () => {
  it("returns primitive stable values for an active download", () => {
    const state = {
      downloads: [],
      downloading: [
        {
          song,
          quality: "320k" as const,
          progress: 0.42,
          bytesWritten: 42,
          contentLength: 100,
        },
      ],
      failedDownloads: [],
    };

    expect(selectDownloadStatus(state, song)).toBe("downloading");
    expect(selectDownloadProgress(state, song)).toBe(0.42);
    expect(selectDownloadStatus(state, song)).toBe("downloading");
  });

  it("prioritizes completed over failed records", () => {
    const state = {
      downloads: [
        {
          song,
          quality: "320k" as const,
          localPath: "file://song.mp3",
          downloadDate: 1,
        },
      ],
      downloading: [],
      failedDownloads: [
        {
          song,
          quality: "320k" as const,
          error: "old error",
          failedAt: 0,
        },
      ],
    };

    expect(selectDownloadStatus(state, song)).toBe("completed");
    expect(selectDownloadProgress(state, song)).toBe(1);
  });

  it("keeps React selectors primitive instead of returning a new record object", () => {
    const songList = readFileSync(
      resolve(process.cwd(), "src/components/SongList.tsx"),
      "utf8",
    );
    const store = readFileSync(
      resolve(process.cwd(), "src/stores/downloadStore.ts"),
      "utf8",
    );

    expect(songList).not.toContain("state.getRecordBySong(song)");
    expect(store).not.toContain("getRecordBySong:");
  });
});
