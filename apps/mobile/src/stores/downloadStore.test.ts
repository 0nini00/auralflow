import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MusicInfo } from "@lx/core";

const downloadService = vi.hoisted(() => ({
  cancelDownload: vi.fn(),
  clearDownloadedFiles: vi.fn(() => Promise.resolve()),
  downloadSong: vi.fn(),
  getDownloadedFileSize: vi.fn(() => Promise.resolve(0)),
  loadDownloads: vi.fn(() => Promise.resolve([])),
  removeDownloadedByPath: vi.fn(() => Promise.resolve()),
  removeDownloadedFile: vi.fn(() => Promise.resolve()),
  saveDownloads: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/services/downloadService", () => ({
  ...downloadService,
}));

import { useDownloadStore } from "@/stores/downloadStore";
import { selectDownloadStatus } from "@/services/downloadRecordSelectors";

function song(id: string): MusicInfo {
  return {
    id,
    name: `song-${id}`,
    singer: "artist",
    albumName: "album",
    source: "wy",
  };
}

describe("download store", () => {
  let consoleError: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    consoleError?.mockRestore();
    consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    downloadService.cancelDownload.mockClear();
    downloadService.clearDownloadedFiles.mockClear();
    downloadService.downloadSong.mockReset();
    downloadService.getDownloadedFileSize.mockReset();
    downloadService.getDownloadedFileSize.mockResolvedValue(0);
    downloadService.loadDownloads.mockClear();
    downloadService.removeDownloadedByPath.mockClear();
    downloadService.removeDownloadedFile.mockClear();
    downloadService.saveDownloads.mockClear();
    useDownloadStore.setState({
      downloads: [],
      downloading: [],
      failedDownloads: [],
      loading: false,
      error: null,
    } as any);
  });

  afterEach(() => {
    consoleError?.mockRestore();
    consoleError = null;
  });

  it("keeps a failed download record so the song row can retry", async () => {
    const target = song("1");
    downloadService.downloadSong.mockRejectedValueOnce(new Error("HTTP 500"));

    await useDownloadStore.getState().downloadSong(target, "320k");

    expect(useDownloadStore.getState().downloading).toEqual([]);
    expect(selectDownloadStatus(useDownloadStore.getState(), target)).toBe("failed");
  });

  it("removes a failed download record without touching downloaded files", async () => {
    const target = song("1");
    downloadService.downloadSong.mockRejectedValueOnce(new Error("HTTP 500"));

    await useDownloadStore.getState().downloadSong(target, "flac");
    useDownloadStore.getState().removeFailedDownload(target);

    expect(useDownloadStore.getState().failedDownloads).toEqual([]);
    expect(downloadService.removeDownloadedFile).not.toHaveBeenCalled();
  });

  it("removes only the failed record for the requested quality", async () => {
    const target = song("1");
    downloadService.downloadSong
      .mockRejectedValueOnce(new Error("mp3 failed"))
      .mockRejectedValueOnce(new Error("flac failed"));

    await useDownloadStore.getState().downloadSong(target, "320k");
    await useDownloadStore.getState().downloadSong(target, "flac");
    useDownloadStore.getState().removeFailedDownload(target, "flac");

    expect(useDownloadStore.getState().failedDownloads).toMatchObject([
      { song: target, quality: "320k", error: "mp3 failed" },
    ]);
  });

  it("cancels only the downloading record for the requested quality", () => {
    const target = song("1");
    useDownloadStore.setState({
      downloading: [
        { song: target, quality: "320k", progress: 0.2, bytesWritten: 20, contentLength: 100 },
        { song: target, quality: "flac", progress: 0.4, bytesWritten: 40, contentLength: 100 },
      ],
    } as any);

    useDownloadStore.getState().cancelDownload(target, "flac");

    expect(downloadService.cancelDownload).toHaveBeenCalledWith(target, "flac");
    expect(useDownloadStore.getState().downloading).toMatchObject([
      { song: target, quality: "320k" },
    ]);
  });

  it("clears the failed record after a retry succeeds", async () => {
    const target = song("1");
    downloadService.downloadSong
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce("file://song-1.mp3");

    await useDownloadStore.getState().downloadSong(target, "320k");
    await useDownloadStore.getState().downloadSong(target, "320k");

    expect(useDownloadStore.getState().failedDownloads).toEqual([]);
    expect(useDownloadStore.getState().downloads).toMatchObject([
      { song: target, localPath: "file://song-1.mp3" },
    ]);
    expect(selectDownloadStatus(useDownloadStore.getState(), target)).toBe("completed");
  });

  it("keeps different qualities of the same song as separate downloads", async () => {
    const target = song("1");
    downloadService.downloadSong
      .mockResolvedValueOnce("file://song-1-320k.mp3")
      .mockResolvedValueOnce("file://song-1-flac.flac");

    await useDownloadStore.getState().downloadSong(target, "320k");
    await useDownloadStore.getState().downloadSong(target, "flac");

    expect(useDownloadStore.getState().downloads).toMatchObject([
      { song: target, quality: "flac", localPath: "file://song-1-flac.flac" },
      { song: target, quality: "320k", localPath: "file://song-1-320k.mp3" },
    ]);
  });

  it("removes the downloaded file by its stored local path", async () => {
    const target = song("1");
    downloadService.downloadSong.mockResolvedValueOnce("file://song-1-flac.flac");

    await useDownloadStore.getState().downloadSong(target, "flac");
    await useDownloadStore.getState().removeDownload(target, "flac");

    expect(downloadService.removeDownloadedByPath).toHaveBeenCalledWith("file://song-1-flac.flac");
    expect(downloadService.removeDownloadedFile).not.toHaveBeenCalled();
    expect(useDownloadStore.getState().downloads).toEqual([]);
  });

  it("stores the downloaded file size for list metadata", async () => {
    const target = song("1");
    downloadService.downloadSong.mockResolvedValueOnce("file://song-1-320k.mp3");
    downloadService.getDownloadedFileSize.mockResolvedValueOnce(10485760);

    await useDownloadStore.getState().downloadSong(target, "320k");

    expect(downloadService.getDownloadedFileSize).toHaveBeenCalledWith("file://song-1-320k.mp3");
    expect(useDownloadStore.getState().downloads).toMatchObject([
      { song: target, quality: "320k", localPath: "file://song-1-320k.mp3", fileSize: 10485760 },
    ]);
  });
});
