import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MusicInfo } from "@lx/core";

const audios: FakeAudio[] = [];
class FakeAudio {
  src = "";
  volume = 1;
  currentTime = 0;
  duration = 100;
  paused = true;
  ended = false;
  playbackRate = 1;
  preload = "";
  muted = false;
  private handlers = new Map<string, Array<() => void>>();
  constructor() { audios.push(this); }
  addEventListener(name: string, fn: () => void) {
    this.handlers.set(name, [...(this.handlers.get(name) ?? []), fn]);
  }
  emit(name: string) { this.handlers.get(name)?.forEach((fn) => fn()); }
  play = vi.fn(async () => { this.paused = false; this.emit("play"); });
  pause = vi.fn(() => { this.paused = true; this.emit("pause"); });
  load = vi.fn(() => {
    this.currentTime = 0;
    this.paused = true;
    // 原生 load 会把 playbackRate 重置到 defaultPlaybackRate（默认为 1）。
    this.playbackRate = 1;
  });
}
const local: MusicInfo = { id: "local", name: "曲目", singer: "歌手", albumName: "专辑", source: "local", isLocal: true };
const online: MusicInfo = { ...local, id: "online", source: "wy", isLocal: false };
const localUrl = "asset:music.flac";
const onlineUrl = "https://example.com/song.mp3";
const engine = async () => (await import("../src/services/playerEngine")).playerEngine;
const outcome = (promise: Promise<void>) => promise.then(() => null, (error: unknown) => error);

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  audios.length = 0;
  vi.stubGlobal("Audio", FakeAudio);
  vi.stubGlobal("AudioContext", undefined);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 16));
  vi.stubGlobal("cancelAnimationFrame", (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle));
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("本地普通音频输出", () => {
  it("没有 AudioContext 也能播放，旧标签不改变用户音量", async () => {
    const player = await engine();
    const legacy = { ...local, replayGain: { gainDb: 12, peak: 0.9 }, replayGainError: "旧标签错误" };
    player.setVolume(0.6);
    await player.play(legacy, localUrl);
    await vi.advanceTimersByTimeAsync(160);
    expect(audios).toHaveLength(1);
    expect(audios[0].volume).toBe(0.6);
    expect(player.getState()).toMatchObject({ status: "playing", volume: 0.6, currentUrl: localUrl });
    expect(player).not.toHaveProperty("setReplayGainEnabled");
    expect(player).not.toHaveProperty("getReplayGainState");
  });

  it("静音和恢复独立于旧增益标签，音量设置可中断淡入", async () => {
    const player = await engine();
    await player.play(local, localUrl);
    await vi.advanceTimersByTimeAsync(32);
    player.setVolume(0);
    await vi.advanceTimersByTimeAsync(160);
    expect(audios[0].volume).toBe(0);
    expect(player.getState().volume).toBe(0);
    player.setVolume(0.35);
    expect(audios[0].volume).toBe(0.35);
    expect(audios[0].play).toHaveBeenCalledTimes(1);
  });

  it("本地和在线共用 Audio，切源保留音量/速率并正常淡出淡入", async () => {
    const context = vi.fn(() => { throw new Error("禁止创建 WebAudio 输出"); });
    vi.stubGlobal("AudioContext", context);
    const player = await engine();
    player.setVolume(0.6);
    player.setPlaybackRate(1.25);
    await player.play(local, localUrl);
    expect(audios[0].volume).toBe(0);
    await vi.advanceTimersByTimeAsync(160);
    for (const [track, url] of [[online, onlineUrl], [local, localUrl]] as const) {
      const pending = player.play(track, url);
      await vi.advanceTimersByTimeAsync(48);
      expect(audios[0].volume).toBeGreaterThan(0);
      expect(audios[0].volume).toBeLessThan(0.6);
      await vi.advanceTimersByTimeAsync(224);
      await pending;
      expect(audios).toHaveLength(1);
      expect(audios[0].src).toBe(url);
      expect(audios[0].volume).toBe(0.6);
      expect(audios[0].playbackRate).toBe(1.25);
    }
    expect(context).not.toHaveBeenCalled();
  });

  it("seek 和元信息同步不重载本地歌曲", async () => {
    const player = await engine();
    await player.play(local, localUrl);
    audios[0].emit("loadedmetadata");
    player.seek(42);
    player.updateCurrentMusic({ ...local, name: "新标题" });
    expect(audios[0].currentTime).toBe(42);
    expect(player.getState()).toMatchObject({ currentTime: 42, currentMusic: { name: "新标题" } });
    expect(audios[0].load).toHaveBeenCalledTimes(1);
    expect(audios[0].play).toHaveBeenCalledTimes(1);
  });

  it.each(["pause", "stop"] as const)("本地加载让出执行权后 %s 不能自行起播", async (action) => {
    const player = await engine();
    const pending = outcome(player.play(local, localUrl));
    player[action]();
    expect(await pending).toBeInstanceOf(Error);
    expect(audios[0].play).not.toHaveBeenCalled();
    expect(audios[0].src).toBe("");
  });

  it("迟到的本地加载不能替换较新的在线播放", async () => {
    const player = await engine();
    const first = outcome(player.play(local, localUrl));
    await player.play(online, onlineUrl);
    expect(await first).toBeInstanceOf(Error);
    expect(audios[0].src).toBe(onlineUrl);
    expect(audios[0].play).toHaveBeenCalledTimes(1);
    expect(audios[0].pause).not.toHaveBeenCalled();
  });

  it.each(["pause", "stop"] as const)("切源淡出期间 %s 保留取消语义和用户音量", async (action) => {
    const player = await engine();
    await player.play(local, localUrl);
    await vi.advanceTimersByTimeAsync(160);
    const pending = outcome(player.play(online, onlineUrl));
    await vi.advanceTimersByTimeAsync(32);
    player[action]();
    expect(await pending).toBeInstanceOf(Error);
    await vi.advanceTimersByTimeAsync(200);
    expect(audios[0].src).toBe(action === "stop" ? "" : localUrl);
    expect(audios[0].play).toHaveBeenCalledTimes(1);
    expect(audios[0].volume).toBe(0.8);
  });

  it("旧 play Promise 迟到不触发新歌曲的淡入", async () => {
    const player = await engine();
    let finish!: () => void;
    audios[0].play.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const pending = outcome(player.play(local, localUrl));
    await vi.advanceTimersByTimeAsync(0);
    expect(finish).toBeTypeOf("function");
    await player.play(online, onlineUrl);
    player.setVolume(0.4);
    finish();
    expect(await pending).toBeNull();
    await vi.advanceTimersByTimeAsync(160);
    expect(audios[0].src).toBe(onlineUrl);
    expect(audios[0].volume).toBe(0.4);
  });
});
