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
  it("应用手动歌词/封面覆盖，不改变本地播放身份且丢弃旧增益", () => {
    const enriched = { ...song, lyricsOverride: "[00:00]手动歌词", coverOverride: "asset:chosen.jpg", replayGain: { gainDb: -6 }, replayGainError: "旧错误" };
    const result = local.localSongToMusicInfo(enriched);
    expect(result).toMatchObject({ id: song.id, source: "local", isLocal: true, name: song.title, localLyrics: enriched.lyricsOverride, picUrl: enriched.coverOverride, img: enriched.coverOverride });
    expect(result).not.toHaveProperty("replayGain");
    expect(result).not.toHaveProperty("replayGainError");
    expect(result.url).toBe(`asset:${song.path}`);
    expect(local.getLocalSongCover(enriched)).toBe(enriched.coverOverride);
  });
  it("明确的空歌词覆盖不被旧内嵌歌词替代", () => {
    expect(local.localSongToMusicInfo({ ...song, lyricsOverride: "", embeddedLyrics: "旧词" }).localLyrics).toBe("");
    expect(local.localSongToMusicInfo({ ...song, embeddedLyrics: "内嵌歌词" }).localLyrics).toBe("内嵌歌词");
  });
});
