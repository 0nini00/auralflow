import { beforeEach, describe, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ getAudioInfo: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (path: string) => `asset:${path}` }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@lx/tauri-bridge", () => ({ scanDirectory: vi.fn(), getAudioInfo: native.getAudioInfo }));
import * as local from "../src/services/localMusicService";
const song = { id: "file-1", path: "F:\\music\\song.flac", title: "本地曲目", artist: "歌手", album: "专辑", duration: 180, format: "flac", size: 1000, cover: "asset:embedded.jpg", isLocal: true };
beforeEach(() => native.getAudioInfo.mockReset());
describe("本地歌曲播放模型", () => {
  it("兼容旧原生字段但不再传入播放模型，保留内嵌歌词", async () => {
    native.getAudioInfo.mockResolvedValue({ ...song, replayGain: { gainDb: -6, peak: 0.9 }, lyrics: "[00:00]内嵌歌词" });
    const result = await local.LocalMusicService.getAudioInfo(song.path);
    expect(result).not.toHaveProperty("replayGain");
    expect(result?.embeddedLyrics).toBe("[00:00]内嵌歌词");
  });
  it("应用手动歌词覆盖，封面只来自曲库记录里的内嵌/旁挂封面", () => {
    const enriched = { ...song, lyricsOverride: "[00:00]手动歌词", replayGain: { gainDb: -6 }, replayGainError: "旧错误" };
    const result = local.localSongToMusicInfo(enriched);
    expect(result).toMatchObject({ id: song.id, source: "local", isLocal: true, name: song.title, localLyrics: enriched.lyricsOverride, picUrl: song.cover, img: song.cover });
    expect(result).not.toHaveProperty("replayGain");
    expect(result).not.toHaveProperty("replayGainError");
    expect(result.url).toBe(`asset:${song.path}`);
    expect(local.getLocalSongCover(enriched)).toBe(song.cover);
  });
  it("空串文本只表示「没有文本」，不再冒充「明确不匹配」", () => {
    // 「不匹配」由 lyricsMode: "local-only" 表达（见 tests/lyrics-annotations-service.test.ts）：
    // 被清空的按曲文本不算文本，于是回落到文件自身的词——内嵌标签本来就是自动链的第一档。
    expect(local.localSongToMusicInfo({ ...song, lyricsOverride: "", embeddedLyrics: "旧词" }).localLyrics).toBe("旧词");
    expect(local.localSongToMusicInfo({ ...song, embeddedLyrics: "内嵌歌词" }).localLyrics).toBe("内嵌歌词");
    // 不匹配档：指纹绑定成立时只用本机已有的词，按曲覆盖被清掉后回落到文件自身的词。
    const localOnly = { ...song, lyricsOverride: "", embeddedLyrics: "内嵌歌词", lyricsMode: "local-only" as const, lyricsFingerprint: "1000:abc" };
    const resolved = local.localSongToMusicInfo(localOnly);
    expect(resolved.localLyrics).toBe("内嵌歌词");
    expect(resolved).toMatchObject({ lyricsMode: "local-only", lyricsFingerprint: "1000:abc" });
    // 内容变了（size 对不上指纹）→ 选择静默失效，退回自动匹配
    const expired = local.localSongToMusicInfo({ ...localOnly, size: 2000 });
    expect(expired.localLyrics).toBe("内嵌歌词");
    expect(expired.lyricsMode).toBeUndefined();
    expect(expired.lyricsFingerprint).toBeUndefined();
  });
});
