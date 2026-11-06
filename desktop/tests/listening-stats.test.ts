import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MusicInfo } from '@lx/core';
const io = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock('@lx/tauri-bridge', () => ({ libraryLoad: io.load, librarySave: io.save }));
const song = { id: '1', source: 'wy', name: 'Song', singer: 'Artist', albumName: '' } as MusicInfo;
beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); io.load.mockResolvedValue(null); io.save.mockReset().mockResolvedValue(undefined); });
describe('desktop listening persistence', () => {
  it('checkpoints at ten seconds and pause flushes only actual elapsed listening', async () => {
    const stats = await import('../src/stores/listeningStatsStore');
    await stats.listeningStatsPersistence.ready;
    stats.startListeningStats(song, { at: 0, position: 0, playing: true, rate: 1.5 });
    stats.sampleListeningStats({ at: 9000, position: 13.5, playing: true, rate: 1.5 });
    expect(io.save).not.toHaveBeenCalled();
    stats.sampleListeningStats({ at: 10000, position: 15, playing: true, rate: 1.5 });
    await stats.flushListeningStats();
    expect(stats.useListeningStatsStore.getState().events[0].listenedMs).toBe(10000);
    stats.sampleListeningStats({ at: 11000, position: 16.5, playing: false, rate: 1.5 });
    await stats.flushListeningStats();
    expect(io.save.mock.calls.at(-1)?.[1].events[0].listenedMs).toBe(11000);
  });
  it('merges delayed hydration with new sessions and retries a failed checkpoint', async () => {
    let resolve!: (value: unknown) => void;
    io.load.mockImplementation(() => new Promise(done => { resolve = done; }));
    const stats = await import('../src/stores/listeningStatsStore');
    stats.useListeningStatsStore.getState().record({ sessionId: 'new', song, startedAt: 2, listenedMs: 1000 });
    resolve({ events: [{ sessionId: 'old', song, startedAt: 1, listenedMs: 4000 }] });
    await stats.listeningStatsPersistence.ready;
    io.save.mockRejectedValueOnce(new Error('disk full'));
    await expect(stats.flushListeningStats()).rejects.toThrow('disk full');
    expect(stats.useListeningStatsStore.getState().error).toBe('disk full');
    await stats.flushListeningStats();
    expect(stats.useListeningStatsStore.getState().events).toHaveLength(2);
    expect(io.save.mock.calls.at(-1)?.[1].events).toHaveLength(2);
    expect(stats.useListeningStatsStore.getState().error).toBeNull();
  });
  it('exposes malformed disk events without overwriting the original file', async () => {
    io.load.mockResolvedValue({ events: [{ playedAt: 123 }] });
    const stats = await import('../src/stores/listeningStatsStore');
    await stats.listeningStatsPersistence.ready;
    expect(stats.useListeningStatsStore.getState().error).toContain('无效事件');
    await expect(stats.flushListeningStats()).rejects.toThrow('无效事件');
    expect(io.save).not.toHaveBeenCalled();
  });
});
