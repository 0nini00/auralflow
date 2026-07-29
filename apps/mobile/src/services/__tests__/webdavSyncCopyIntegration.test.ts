import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("webdav sync copy integration", () => {
  it("labels playlist sync actions as playlist-history sync on mobile", () => {
    const source = readFileSync(resolve(process.cwd(), "src/screens/WebDavSyncScreen.tsx"), "utf8");

    expect(source).toContain("歌单历史同步");
    expect(source).toContain("上传歌单历史");
    expect(source).toContain("下载歌单历史");
    expect(source).toContain("从 WebDAV 下载将覆盖本地的收藏、歌单和播放历史");
  });
});
