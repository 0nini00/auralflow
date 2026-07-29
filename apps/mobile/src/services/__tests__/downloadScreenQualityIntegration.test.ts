import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("download screen quality integration", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/screens/DownloadScreen.tsx"),
    "utf8",
  );
  const downloadListSource = readFileSync(
    resolve(process.cwd(), "src/components/DownloadList.tsx"),
    "utf8",
  );

  it("keys transient download rows by song and quality", () => {
    expect(source).toContain("key={`${item.song.source}:${item.song.id}:${item.quality}`}");
    expect(source).not.toContain("key={`${item.song.source}:${item.song.id}`}");
  });

  it("shows the requested quality on active download rows", () => {
    expect(source).toContain("quality={item.quality}");
    expect(source).toContain("quality: string;");
    expect(source).toContain("buildDownloadingMetadata({ song, quality, progress, bytesWritten, contentLength })");
  });

  it("uses shared metadata helpers for download rows", () => {
    expect(source).toContain("buildCompletedDownloadMetadata");
    expect(source).toContain("buildDownloadingMetadata");
    expect(downloadListSource).toContain("buildCompletedDownloadMetadata");
    expect(downloadListSource).toContain("buildDownloadingMetadata");
  });
});
