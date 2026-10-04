import { expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (path: string) => `asset:${path}` }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@lx/tauri-bridge", () => ({ scanDirectory: vi.fn(), getAudioInfo: vi.fn() }));
import { createLocalPlaybackLookup, synchronizeLocalQueue } from "../src/services/localPlaybackMetadata";
import type { LocalSong } from "../src/services/localMusicService";
import type { MusicInfo } from "@lx/core";
const song: LocalSong = { id: "1", path: "F:\\a.flac", title: "旧名", artist: "歌手", album: "专辑", duration: 100, size: 1, format: "flac", isLocal: true };
const track: MusicInfo = { id: "1", name: "旧名", singer: "歌手", albumName: "专辑", source: "local", isLocal: true, url: "asset:active-stream", localPath: song.path, interval: 100 };
it("手动资料更新进入当前元信息但不替换播放地址，在线同ID不受影响", () => {
  let songs = [song];
  const lookup = createLocalPlaybackLookup(() => songs);
  expect(lookup(track)).toBe(track);
  songs = [{ ...song, title: "新名", lyricsOverride: "[00:00]新词", coverOverride: "asset:new-cover" }];
  expect(lookup(track)).toMatchObject({ name: "新名", localLyrics: "[00:00]新词", url: track.url, picUrl: "asset:new-cover" });
  const online = { ...track, source: "wy" as const, isLocal: false };
  expect(lookup(online)).toBe(online);
});
it("队列复用未变化对象，仅同步匹配本地歌曲", () => {
  const lookup = createLocalPlaybackLookup(() => [{ ...song, title: "新名" }]);
  const online = { ...track, source: "wy" as const, isLocal: false };
  const result = synchronizeLocalQueue([track, online], lookup);
  expect(result[0].name).toBe("新名"); expect(result[1]).toBe(online);
  expect(synchronizeLocalQueue(result, lookup)).toBe(result);
});
