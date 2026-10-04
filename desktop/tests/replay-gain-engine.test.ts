import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MusicInfo } from "@lx/core";
const audios: FakeAudio[] = [];
class FakeAudio {
  src = ""; volume = 1; currentTime = 0; duration = 100; paused = true; ended = false;
  playbackRate = 1; preload = ""; crossOrigin = ""; muted = false;
  private handlers = new Map<string, Array<() => void>>();
  constructor() { audios.push(this); }
  addEventListener(name: string, fn: () => void) { this.handlers.set(name, [...(this.handlers.get(name) ?? []), fn]); }
  emit(name: string) { for (const fn of this.handlers.get(name) ?? []) fn(); }
  play = vi.fn(async () => { this.paused = false; this.emit("play"); });
  pause = vi.fn(() => { this.paused = true; this.emit("pause"); });
  load = vi.fn();
  removeAttribute(name: string) { if (name === "src") this.src = ""; }
}
const contexts: FakeContext[] = [];
class FakeContext {
  state = "running"; currentTime = 0; destination = {};
  gain = { value: 1, setValueAtTime(value: number) { this.value = value; } };
  createGain = vi.fn(() => ({ gain: this.gain, connect: vi.fn(), disconnect: vi.fn() }));
  createMediaElementSource = vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() }));
  resume = vi.fn(async () => { this.state = "running"; });
  constructor() { contexts.push(this); }
}
const track: MusicInfo = { id: "local", name: "曲目", singer: "歌手", albumName: "专辑", source: "local", isLocal: true, replayGain: { gainDb: -6, peak: 0.9 } };
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); audios.length = 0; contexts.length = 0;
  vi.stubGlobal("Audio", FakeAudio); vi.stubGlobal("AudioContext", FakeContext);
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1)); vi.stubGlobal("cancelAnimationFrame", vi.fn());
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function engine() { return (await import("../src/services/playerEngine")).playerEngine; }
describe("本地 ReplayGain", () => {
  it("默认关闭，不更改用户音量", async () => {
    const player = await engine();
    await player.play(track, "asset:music.flac");
    expect(player.getReplayGainState()).toMatchObject({ status: "disabled", gain: 1 });
    expect(player.getState().volume).toBe(0.8);
  });
  it("负增益通过独立GainNode应用，静音和恢复不丢补偿", async () => {
    const player = await engine(); player.setReplayGainEnabled(true);
    await player.play(track, "asset:music.flac");
    expect(player.getReplayGainState()).toMatchObject({ status: "applied", peakLimited: false });
    expect(contexts[0].gain.value).toBeCloseTo(10 ** (-6 / 20));
    player.setVolume(0); expect(contexts[0].gain.value).toBeCloseTo(10 ** (-6 / 20));
    player.setVolume(0.6); expect(player.getState().volume).toBe(0.6);
  });
  it("正增益不能被HTMLAudio.volume的上限截成没有效果", async () => {
    const player = await engine(); player.setReplayGainEnabled(true);
    await player.play({ ...track, replayGain: { gainDb: 6, peak: 0.2 } }, "asset:music.flac");
    expect(contexts[0].gain.value).toBeCloseTo(10 ** (6 / 20));
    expect(contexts[0].gain.value).toBeGreaterThan(1);
  });
  it("已有峰值标签时限制增益以避免削波", async () => {
    const player = await engine(); player.setReplayGainEnabled(true);
    await player.play({ ...track, replayGain: { gainDb: 6, peak: 0.8 } }, "asset:music.flac");
    expect(player.getReplayGainState()).toMatchObject({ peakLimited: true });
    expect(contexts[0].gain.value).toBeCloseTo(1.25);
  });
  it("缺失或无效标签不处理，不伪装成已做音量平衡", async () => {
    const player = await engine(); player.setReplayGainEnabled(true);
    await player.load({ ...track, replayGain: undefined }, "asset:no-tags.flac");
    expect(player.getReplayGainState()).toMatchObject({ status: "missing", gain: 1 });
    await player.load({ ...track, replayGain: { gainDb: Number.NaN } }, "asset:bad-tags.flac");
    expect(player.getReplayGainState()).toMatchObject({ status: "invalid", gain: 1 });
  });
  it("当前歌曲开关增益不重启播放，不改变播放位置", async () => {
    const player = await engine(); player.setReplayGainEnabled(true);
    await player.play(track, "asset:music.flac");
    const active = audios.find((audio) => audio.src === "asset:music.flac")!;
    active.currentTime = 42;
    player.setReplayGainEnabled(false);
    expect(contexts[0].gain.value).toBe(1);
    expect(active.currentTime).toBe(42);
    expect(active.play).toHaveBeenCalledTimes(1);
    expect(active.load).toHaveBeenCalledTimes(1);
  });
  it("在线音频永不接入本地增益图，更新标签也不重启播放", async () => {
    const player = await engine(); player.setReplayGainEnabled(true);
    await player.play(track, "asset:music.flac");
    player.pause();
    const online = { ...track, id: "online", source: "wy" as const, isLocal: false };
    await player.play(online, "https://example.com/song.mp3");
    expect(contexts[0].createMediaElementSource).toHaveBeenCalledTimes(1);
    const analysed = contexts[0].createMediaElementSource.mock.calls[0][0];
    expect(analysed).not.toBe(audios.find((audio) => audio.src.startsWith("https:")));
    expect(player.getReplayGainState()).toMatchObject({ status: "not-local", gain: 1 });
    const active = audios.find((audio) => audio.src.startsWith("https:"))!;
    player.updateCurrentMusic({ ...online, name: "新标题" });
    expect(player.getState().currentMusic?.name).toBe("新标题");
    expect(active.play).toHaveBeenCalledTimes(1);
  });
});
it("本地输出初始化迟到不能抢回已经播放的在线歌曲", async () => {
  let finish!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  vi.stubGlobal("AudioContext", class extends FakeContext {
    state = "suspended";
    resume = vi.fn(() => new Promise<void>((resolve) => {
      finish = () => { this.state = "running"; resolve(); };
      entered();
    }));
  });
  const player = await engine();
  const first = player.play(track, "asset:slow.flac").then(() => null, (error: unknown) => error);
  await started;
  await player.play({ ...track, id: "new", source: "wy", isLocal: false }, "https://example.com/new.mp3");
  finish();
  const oldResult = await first;
  expect(oldResult).toBeInstanceOf(Error);
  expect(player.getState().currentMusic?.id).toBe("new");
  expect(audios[0].src).toBe("https://example.com/new.mp3");
  expect(audios[0].pause).not.toHaveBeenCalled();
});
it.each(["pause", "stop"] as const)("本地输出初始化期间 %s 后不能自行起播", async (action) => {
  let finish!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  vi.stubGlobal("AudioContext", class extends FakeContext {
    state = "suspended";
    resume = vi.fn(() => new Promise<void>((resolve) => { finish = () => { this.state = "running"; resolve(); }; entered(); }));
  });
  const player = await engine();
  const first = player.play(track, "asset:slow.flac").then(() => null, (error: unknown) => error);
  await started;
  player[action]();
  finish();
  expect(await first).toBeInstanceOf(Error);
  expect(audios.every((audio) => audio.play.mock.calls.length === 0)).toBe(true);
});
