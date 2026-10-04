import { beforeEach, describe, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ getAudioInfo: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (path: string) => `asset:${path}` }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@lx/tauri-bridge", () => ({ scanDirectory: vi.fn(), getAudioInfo: native.getAudioInfo }));
import * as local from "../src/services/localMusicService";
const song = { id: "file-1", path: "F:\\music\\song.flac", title: "本地曲目", artist: "歌手", album: "专辑", duration: 180, format: "flac", size: 1000, cover: "asset:embedded.jpg", isLocal: true };
beforeEach(() => native.getAudioInfo.mockReset());
describe("本地歌曲播放模型", () => {
  it("读取原生ReplayGain标签并传入本地歌曲", async () => {
    native.getAudioInfo.mockResolvedValue({ ...song, replayGain: { gainDb: -6, peak: 0.9 }, lyrics: "[00:00]内嵌歌词" });
    const result = await local.LocalMusicService.getAudioInfo(song.path);
    expect(result?.replayGain).toEqual({ gainDb: -6, peak: 0.9 });
    expect(result?.embeddedLyrics).toBe("[00:00]内嵌歌词");
  });
  it("应用手动歌词/封面覆盖，不改变本地播放身份和标签增益", () => {
    const enriched = { ...song, lyricsOverride: "[00:00]手动歌词", coverOverride: "asset:chosen.jpg", replayGain: { gainDb: -6 } };
    const result = local.localSongToMusicInfo(enriched);
    expect(result).toMatchObject({ id: song.id, source: "local", isLocal: true, name: song.title, localLyrics: enriched.lyricsOverride, picUrl: enriched.coverOverride, img: enriched.coverOverride, replayGain: enriched.replayGain });
    expect(result.url).toBe(`asset:${song.path}`);
    expect(local.getLocalSongCover(enriched)).toBe(enriched.coverOverride);
  });
  it("明确的空歌词覆盖不被旧内嵌歌词替代", () => {
    expect(local.localSongToMusicInfo({ ...song, lyricsOverride: "", embeddedLyrics: "旧词" }).localLyrics).toBe("");
    expect(local.localSongToMusicInfo({ ...song, embeddedLyrics: "内嵌歌词" }).localLyrics).toBe("内嵌歌词");
  });
});
