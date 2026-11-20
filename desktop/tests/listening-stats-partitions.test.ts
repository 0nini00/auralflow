import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { ListeningEvent, MusicInfo } from '@lx/core';
const io = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), reset: vi.fn(), legacyLoad: vi.fn(), legacySave: vi.fn() }));
vi.mock('@lx/tauri-bridge', () => ({ loadListeningStats: io.load, saveListeningStatsMonth: io.save,
  libraryReset: io.reset, libraryLoad: io.legacyLoad, librarySave: io.legacySave }));
const song = { id: 'one', source: 'wy', name: 'Song', singer: 'Artist', albumName: '' } as MusicInfo;
const event = (sessionId: string, month: number, listenedMs = 1000): ListeningEvent => ({ sessionId, song, startedAt: Date.UTC(2026, month - 1, 10), listenedMs });
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); vi.resetAllMocks();
  io.load.mockResolvedValue({ months: {}, legacy: null }); io.save.mockResolvedValue(undefined); io.reset.mockResolvedValue(undefined);
  io.legacyLoad.mockResolvedValue(null); io.legacySave.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

it('更新当前月仅提交该月，复用聚合快照且不重新扫描历史', async () => {
  const old = Array.from({ length: 10000 }, (_, i) => event(`old-${i}`, 1));
  io.load.mockResolvedValue({ months: { '2026-01': old, '2026-11': [event('current', 11)] }, legacy: null });
  const stats = await import('../src/stores/listeningStatsStore');
  await stats.listeningStatsPersistence.ready;
  stats.useListeningStatsStore.getState().record(event('current', 11, 11000));
  await stats.flushListeningStats();
  expect(io.save.mock.calls.length).toBe(1);
  expect(io.save.mock.calls[0][0]).toBe('2026-11');
  expect(io.save.mock.calls[0][1]).toHaveLength(1);
  expect(io.legacySave.mock.calls.length).toBe(0);
  const state = stats.useListeningStatsStore.getState();
  expect(state.getStats().totalPlays).toBe(10001);
  expect(state.getStats()).toBe(state.getStats());
});

it('旧历史分月迁移写入失败保留旧数据，重试完成后才删旧文件', async () => {
  io.load.mockResolvedValue({ months: {}, legacy: { events: [event('a', 1), event('b', 2)] } });
  const stats = await import('../src/stores/listeningStatsStore');
  await stats.listeningStatsPersistence.ready;
  io.save.mockRejectedValueOnce(new Error('disk full'));
  await expect(stats.flushListeningStats()).rejects.toThrow('disk full');
  expect(io.reset.mock.calls.length).toBe(0);
  await stats.flushListeningStats();
  expect(io.save.mock.calls.map(call => call[0])).toEqual(['2026-01', '2026-01', '2026-02']);
  expect(io.reset).toHaveBeenCalledWith('listeningStats');
  expect(stats.useListeningStatsStore.getState().events).toHaveLength(2);
});

it('加载期间检查点合并旧月基线', async () => {
  let resolve!: (value: unknown) => void;
  io.load.mockImplementation(() => new Promise(done => { resolve = done; }));
  const stats = await import('../src/stores/listeningStatsStore');
  stats.useListeningStatsStore.getState().record(event('current', 11, 5000));
  resolve({ months: { '2026-11': [event('current', 11, 1000), event('other', 11)] }, legacy: null });
  await stats.listeningStatsPersistence.ready;
  await stats.flushListeningStats();
  expect(io.save.mock.calls[0][1]).toHaveLength(2);
  expect(stats.useListeningStatsStore.getState().getStats().totalMs).toBe(6000);
});

it('错误月份明确失败，不覆盖原始文件', async () => {
  io.load.mockResolvedValue({ months: { '2026-11': [event('wrong-month', 1)] }, legacy: null });
  const stats = await import('../src/stores/listeningStatsStore');
  await stats.listeningStatsPersistence.ready;
  stats.useListeningStatsStore.getState().record(event('new', 11));
  await expect(stats.flushListeningStats()).rejects.toThrow('月份内容不匹配');
  expect(io.save.mock.calls.length).toBe(0);
  expect(io.reset.mock.calls.length).toBe(0);
});

it('跨月检查点在迁移期间胜出，重试读盘不能复活旧月份副本', async () => {
  let resolve!: (value: unknown) => void;
  io.load.mockImplementation(() => new Promise(done => { resolve = done; }));
  const stats = await import('../src/stores/listeningStatsStore');
  stats.useListeningStatsStore.getState().record(event('moved', 11, 2000));
  resolve({ months: { '2026-01': [event('moved', 1)] }, legacy: { events: [event('legacy', 2)] } });
  await stats.listeningStatsPersistence.ready;
  await stats.flushListeningStats();
  const saved = new Map(io.save.mock.calls.map(call => [call[0], call[1]]));
  expect(saved.get('2026-01')).toEqual([]);
  expect(saved.get('2026-11')).toEqual([event('moved', 11, 2000)]);
  expect(stats.useListeningStatsStore.getState().getStats().totalPlays).toBe(2);
});

it('退出统一flush仍保存统计，写入期间的新检查点必须排空', async () => {
  const stats = await import('../src/stores/listeningStatsStore');
  const { flushLibraryPersistence } = await import('../src/stores/libraryPersistence');
  await stats.listeningStatsPersistence.ready;
  let resolve!: () => void;
  io.save.mockImplementationOnce(() => new Promise<void>(done => { resolve = done; }));
  stats.useListeningStatsStore.getState().record(event('current', 11));
  const saving = flushLibraryPersistence();
  await vi.waitFor(() => expect(io.save.mock.calls.length).toBe(1));
  stats.useListeningStatsStore.getState().record(event('current', 11, 2000));
  resolve(); await saving;
  expect(io.save.mock.calls.length).toBe(2);
  expect(io.save.mock.calls[1][1][0].listenedMs).toBe(2000);
});
