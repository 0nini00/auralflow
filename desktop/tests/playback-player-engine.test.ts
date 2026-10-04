import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MusicInfo } from '@lx/core';
import { createCustomSourceAccess } from '../src/services/customSourceAccess';
class FakeAudio {
  static instances: FakeAudio[] = [];
  src = '';
  paused = true;
  volume = 1;
  playbackRate = 1;
  currentTime = 0;
  ended = false;
  listeners = new Map<string, (() => void)[]>();
  load = vi.fn();
  play = vi.fn(async () => { this.paused = false; this.emit('play'); });
  pause = vi.fn(() => { this.paused = true; this.emit('pause'); });
  constructor() { FakeAudio.instances.push(this); }
  addEventListener(event: string, listener: () => void) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
  }
  emit(event: string) { this.listeners.get(event)?.forEach((listener) => listener()); }
}
const music = { id: '1', source: 'wy', name: '歌曲', singer: '歌手' } as MusicInfo;
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  FakeAudio.instances = [];
  vi.stubGlobal('Audio', FakeAudio);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 16));
  vi.stubGlobal('cancelAnimationFrame', (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle));
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('引擎最后提交点的许可回调', () => {
  it('淡出期间 off→on，不替换旧 src、不播放新 LX，并恢复当前音量', async () => {
    const { playerEngine } = await import('../src/services/playerEngine');
    const audio = FakeAudio.instances[0];
    await playerEngine.load(music, 'https://audio/current');
    audio.paused = false;
    audio.emit('play');
    const access = createCustomSourceAccess(() => true);
    const operation = access.capture();
    const pending = playerEngine.play({ ...music, id: '2' }, 'https://audio/lx', operation.assertActive);
    const outcome = pending.then(() => null, (error: unknown) => error);
    access.invalidate();
    access.invalidate();
    await vi.advanceTimersByTimeAsync(120);
    expect(await outcome).toBeInstanceOf(Error);
    expect(audio.src).toBe('https://audio/current');
    expect(audio.play).not.toHaveBeenCalled();
    expect(audio.pause).not.toHaveBeenCalled();
    expect(audio.volume).toBe(0.8);
  });
  it('load 已完成但尚未 audio.play 时失效，不启动新流', async () => {
    const { playerEngine } = await import('../src/services/playerEngine');
    const audio = FakeAudio.instances[0];
    const access = createCustomSourceAccess(() => true);
    const operation = access.capture();
    audio.load.mockImplementation(() => { access.invalidate(); });
    await expect(playerEngine.play(music, 'https://audio/lx', operation.assertActive)).rejects.toThrow();
    expect(audio.play).not.toHaveBeenCalled();
  });
  it('已调用 audio.play 的流不因之后失效被暂停', async () => {
    const { playerEngine } = await import('../src/services/playerEngine');
    const audio = FakeAudio.instances[0];
    const access = createCustomSourceAccess(() => true);
    const operation = access.capture();
    audio.play.mockImplementation(async () => { access.invalidate(); });
    await playerEngine.play(music, 'https://audio/lx', operation.assertActive);
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(audio.pause).not.toHaveBeenCalled();
  });
  it('内置播放可不提供许可回调', async () => {
    const { playerEngine } = await import('../src/services/playerEngine');
    await playerEngine.play(music, 'https://audio/builtin');
    expect(FakeAudio.instances[0].play).toHaveBeenCalledTimes(1);
  });
});
