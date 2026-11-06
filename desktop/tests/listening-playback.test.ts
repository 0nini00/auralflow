import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { MusicInfo } from '@lx/core';

const io = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
let monotonicNow = 0;
vi.mock('@lx/tauri-bridge', () => ({ libraryLoad: io.load, librarySave: io.save, debugLog: vi.fn(), patchSettings: vi.fn() }));

class AudioBoundary {
  static instance: AudioBoundary;
  src = ''; paused = true; volume = 1; playbackRate = 1; currentTime = 0; duration = 300; ended = false;
  listeners = new Map<string, Array<() => void>>();
  constructor() { AudioBoundary.instance = this; }
  load() { this.currentTime = 0; }
  async play() { this.paused = false; this.emit('play'); }
  pause() { this.paused = true; this.emit('pause'); }
  addEventListener(event: string, listener: () => void) { this.listeners.set(event, [...this.listeners.get(event) ?? [], listener]); }
  emit(event: string) { this.listeners.get(event)?.forEach(listener => listener()); }
}
const song = { id: 'one', source: 'local', name: 'Song', singer: 'Artist', albumName: '', isLocal: true, url: 'file:one.flac' } as MusicInfo;

beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); io.load.mockResolvedValue(null); io.save.mockReset().mockResolvedValue(undefined);
  monotonicNow = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => monotonicNow);
  vi.stubGlobal('Audio', AudioBoundary);
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function fixture() {
  const { usePlayerStore } = await import('../src/stores/playerStore');
  const stats = await import('../src/stores/listeningStatsStore');
  await stats.listeningStatsPersistence.ready;
  await usePlayerStore.getState().play(song);
  AudioBoundary.instance.emit('loadedmetadata');
  const advance = async (ms: number, position: number) => {
    vi.setSystemTime(Date.now() + ms);
    monotonicNow += ms;
    AudioBoundary.instance.currentTime = position;
    AudioBoundary.instance.emit('timeupdate');
  };
  return { player: usePlayerStore, stats, audio: AudioBoundary.instance, advance };
}

it('实际播放入口同曲重播独立计次，暂停和小幅 seek 不增加收听时间', async () => {
  const h = await fixture();
  await h.advance(1000, 1);
  h.player.getState().pause();
  await h.advance(10000, 1);
  h.player.getState().resume();
  await h.advance(1000, 2);
  h.player.getState().setProgress(2.2);
  await h.advance(1000, 3.2);
  h.audio.paused = true;
  h.audio.emit('ended');
  await h.player.getState().play(song);
  await h.advance(1000, 1);
  await h.stats.flushListeningStats();
  const events = h.stats.useListeningStatsStore.getState().events;
  expect(events).toHaveLength(2);
  expect(events.map(event => event.listenedMs)).toEqual([3000, 1000]);
});

it('实际原生音频 2 倍速仍按经过时间累计，退出 flush 保存最新采样', async () => {
  const h = await fixture();
  h.player.getState().setPlaybackRate(2);
  await h.advance(1000, 2);
  const { flushLibraryPersistence } = await import('../src/stores/libraryPersistence');
  await flushLibraryPersistence();
  expect(h.stats.useListeningStatsStore.getState().events[0].listenedMs).toBe(1000);
});

it('自然结束结算原生确认的末尾位置，不丢弃最后一个进度事件之后的收听', async () => {
  const h = await fixture();
  await h.advance(1000, 1);
  monotonicNow += 500;
  h.audio.currentTime = 1.5;
  h.audio.paused = true;
  h.audio.emit('ended');
  await h.stats.flushListeningStats();
  expect(h.stats.useListeningStatsStore.getState().events[0].listenedMs).toBe(1500);
});

it('音量和元信息更新不能移动旧媒体位置的采样时钟', async () => {
  const h = await fixture();
  await h.advance(500, 0.5);
  monotonicNow += 450;
  h.player.getState().setVolume(0.5);
  await h.advance(50, 1);
  await h.stats.flushListeningStats();
  expect(h.stats.useListeningStatsStore.getState().events[0].listenedMs).toBe(1000);
});
