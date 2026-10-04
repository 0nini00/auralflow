import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MusicInfo } from '@lx/core';

const native = vi.hoisted(() => ({
  events: new Map<string, (event: { payload: unknown }) => void>(),
  prepare: vi.fn(), download: vi.fn(), enhance: vi.fn(), cancel: vi.fn(),
  nextId: 0,
}));
vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (path: string) => `asset:${path}` }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async (name, callback) => { native.events.set(name, callback); return () => {}; }) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('@/services/downloadService', () => ({
  buildDownloadBaseName: (music: MusicInfo) => music.name,
  buildDownloadTaskId: () => `task-${++native.nextId}`,
  prepareDownload: native.prepare, runDownloadTask: native.download,
  enhanceDownloadedFile: native.enhance, cancelDownloadTask: native.cancel,
}));
vi.mock('@/stores/playerStore', async () => {
  const { create } = await import('zustand');
  return { usePlayerStore: create(() => ({ playQueue: vi.fn() })) };
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const music = { id: 'song', source: 'wy', name: 'Song', singer: 'Artist', interval: 120 } as MusicInfo;
const prepared = { url: 'memory-only', fileName: 'song.mp3', quality: '320k' };
let store: typeof import('../src/stores/downloadStore').useDownloadStore;
let renderer: ReactTestRenderer | undefined;
let storage: Map<string, string>;
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const task = () => store.getState().tasks[0];
const emit = (name: string, payload: unknown) => native.events.get(name)!({ payload });
async function start() {
  await store.getState().addDownload(music, '320k');
  await flush();
  return task().id;
}
async function mount() {
  const { DownloadsView } = await import('../src/views/DownloadsView');
  await act(async () => { renderer = create(<DownloadsView />); });
}

beforeEach(async () => {
  vi.resetModules();
  native.events.clear(); native.nextId = 0;
  native.prepare.mockReset().mockResolvedValue(prepared);
  native.download.mockReset(); native.enhance.mockReset().mockResolvedValue([]);
  native.cancel.mockReset().mockResolvedValue(true);
  storage = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal('window', { localStorage: globalThis.localStorage });
  store = (await import('../src/stores/downloadStore')).useDownloadStore;
  store.getState().setDownloadDir('memory-only');
});
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); });

describe('下载真实 store 与页面的异步生命周期', () => {
  it('取消调用失败保留下载状态、准确错误和可再次点击的取消入口', async () => {
    const transfer = deferred<string>();
    native.download.mockReturnValue(transfer.promise);
    native.cancel.mockRejectedValueOnce(new Error('bridge unavailable'));
    const id = await start();
    await mount();
    await act(async () => { await store.getState().cancelTask(id); });
    expect(task().status).toBe('downloading');
    expect(task().error).toContain('bridge unavailable');
    expect(renderer!.root.findAllByProps({ role: 'alert' }).some(node => node.children.join('').includes('bridge unavailable'))).toBe(true);
    const cancel = renderer!.root.findByProps({ title: '取消下载' });
    expect(cancel.props.disabled).not.toBe(true);
    await act(async () => { cancel.props.onClick(); await flush(); });
    expect(native.cancel).toHaveBeenCalledTimes(2);
    expect(task().status).toBe('downloading');
    expect(task().cancelRequested).toBe(true);
    await act(async () => { transfer.reject('下载已取消'); await flush(); });
    expect(task().status).toBe('cancelled');
  });

  it('native 返回 false 不视为取消成功', async () => {
    const transfer = deferred<string>();
    native.download.mockReturnValue(transfer.promise);
    native.cancel.mockResolvedValue(false);
    const id = await start();
    await store.getState().cancelTask(id);
    expect(task().status).toBe('downloading');
    expect(task().error).toMatch(/取消失败.*未找到/);
    expect(task().cancelRequested).toBe(false);
    transfer.resolve('memory-only/song.mp3'); await flush();
    expect(task().status).toBe('completed');
    expect(task().error).toBeUndefined();
  });

  it('native 接受取消但实际完成时，以保存成功为准，不伪装 cancelled', async () => {
    const transfer = deferred<string>();
    native.download.mockReturnValue(transfer.promise);
    const id = await start();
    await store.getState().cancelTask(id);
    transfer.resolve('memory-only/song.mp3'); await flush();
    expect(task().status).toBe('completed');
    expect(native.enhance).toHaveBeenCalledOnce();
    expect(task().cancelRequested).toBe(false);
  });

  it('native 接受取消后出现真实网络错误，仍显示失败原因而不是已取消', async () => {
    const transfer = deferred<string>();
    native.download.mockReturnValue(transfer.promise);
    const id = await start();
    await store.getState().cancelTask(id);
    transfer.reject('读取下载数据失败: connection reset'); await flush();
    expect(task().status).toBe('failed');
    expect(task().error).toContain('connection reset');
  });

  it('native 完成事件先到只进入后处理，最终警告保留且迟到事件不回退状态', async () => {
    const transfer = deferred<string>();
    const enhancement = deferred<string[]>();
    native.download.mockReturnValue(transfer.promise);
    native.enhance.mockReturnValue(enhancement.promise);
    const id = await start();
    emit('download-completed', { taskId: id, savedPath: 'memory-only/song.mp3', total: 100 });
    expect(task().status).toBe('processing');
    expect(store.getState().toLocalMusic(task())).toBeNull();
    store.getState().clearCompleted(); expect(store.getState().tasks).toHaveLength(1);
    await store.getState().addDownload(music, '320k'); expect(store.getState().tasks).toHaveLength(1);
    emit('download-progress', { taskId: id, downloaded: 90, total: 100, progress: 90, speed: 3 });
    expect(task().status).toBe('processing');
    transfer.resolve('memory-only/song.mp3'); await flush();
    await mount();
    expect(JSON.stringify(renderer!.toJSON())).toContain('后处理中');
    expect(renderer!.root.findAllByProps({ title: '播放本地文件' })).toHaveLength(0);
    await act(async () => { enhancement.resolve(['封面写入失败', '歌词写入失败']); await flush(); });
    expect(task().status).toBe('completed');
    expect(task().warning).toBe('封面写入失败；歌词写入失败');
    expect(JSON.stringify(renderer!.toJSON())).toContain('封面写入失败');
    await act(async () => {
      emit('download-completed', { taskId: id, savedPath: 'memory-only/song.mp3', total: 100 });
      emit('download-progress', { taskId: id, downloaded: 90, total: 100, progress: 90, speed: 3 });
    });
    expect(task().status).toBe('completed');
    expect(task().warning).toContain('歌词写入失败');
    expect(task().progress).toBe(100);
  });

  it('没有完成事件时 Promise 仍驱动后处理；重启快照不丢已下载文件', async () => {
    const enhancement = deferred<string[]>();
    native.download.mockResolvedValue('memory-only/song.mp3');
    native.enhance.mockReturnValue(enhancement.promise);
    await start();
    expect(task().status).toBe('processing');
    const persisted = JSON.parse(storage.get('download-storage')!).state.tasks[0];
    expect(persisted.status).toBe('completed');
    expect(persisted.savedPath).toBe('memory-only/song.mp3');
    expect(persisted.warning).toContain('后处理');
    enhancement.reject(new Error('unexpected tag error')); await flush();
    expect(task().status).toBe('completed');
    expect(task().warning).toContain('unexpected tag error');
  });

  it('取消响应迟于文件完成时，不把后处理结果改成取消失败', async () => {
    const transfer = deferred<string>();
    const cancellation = deferred<boolean>();
    native.download.mockReturnValue(transfer.promise);
    native.cancel.mockReturnValue(cancellation.promise);
    const id = await start();
    const request = store.getState().cancelTask(id);
    transfer.resolve('memory-only/song.mp3'); await flush();
    cancellation.reject(new Error('late cancellation error')); await request;
    expect(task().status).toBe('completed');
    expect(task().error).toBeUndefined();
  });

  it('解析期间取消阻止后续 native 下载，不依赖尚不存在的取消句柄', async () => {
    const preparation = deferred<typeof prepared>();
    native.prepare.mockReturnValue(preparation.promise);
    const id = await start();
    await store.getState().cancelTask(id);
    preparation.resolve(prepared); await flush();
    expect(task().status).toBe('cancelled');
    expect(native.download).not.toHaveBeenCalled();
    expect(native.cancel).not.toHaveBeenCalled();
  });
  it('文件 Promise 先返回时，迟到完成事件仍补齐大小但不覆盖后处理状态与警告', async () => {
    const enhancement = deferred<string[]>();
    native.download.mockResolvedValue('memory-only/song.mp3');
    native.enhance.mockReturnValue(enhancement.promise);
    const id = await start();
    expect(task().status).toBe('processing');
    emit('download-completed', { taskId: id, savedPath: 'memory-only/song.mp3', total: 100 });
    expect(task()).toMatchObject({ status: 'processing', downloaded: 100, total: 100 });
    enhancement.resolve(['标签未写入']); await flush();
    emit('download-completed', { taskId: id, savedPath: 'memory-only/song.mp3', total: 100 });
    expect(task()).toMatchObject({ status: 'completed', downloaded: 100, warning: '标签未写入' });
  });

  it('解析阶段已取消，迟到的解析失败不能重新写成下载失败', async () => {
    const preparation = deferred<typeof prepared>();
    native.prepare.mockReturnValue(preparation.promise);
    const id = await start();
    await store.getState().cancelTask(id);
    preparation.reject(new Error('late resolution failure')); await flush();
    expect(task().status).toBe('cancelled');
    expect(task().error).toBe('已取消');
    expect(native.download).not.toHaveBeenCalled();
  });

  it('取消解析后立即重试，旧解析完成不能启动已移除的任务', async () => {
    const oldPreparation = deferred<typeof prepared>();
    native.prepare.mockReturnValueOnce(oldPreparation.promise).mockResolvedValue(prepared);
    native.download.mockResolvedValue('memory-only/song.mp3');
    const oldId = await start();
    await store.getState().cancelTask(oldId);
    await store.getState().retryTask(oldId); await flush();
    oldPreparation.resolve(prepared); await flush();
    expect(native.download).toHaveBeenCalledOnce();
    expect(native.download.mock.calls[0][0]).not.toBe(oldId);
    expect(store.getState().tasks).toHaveLength(1);
    expect(task().status).toBe('completed');
  });

  it('排队取消不调用 native，失败重试和移除/清理保留原有数据操作', async () => {
    const transfer = deferred<string>();
    native.download.mockReturnValue(transfer.promise);
    await start();
    await store.getState().addDownload({ ...music, id: 'second' }, '320k'); await flush();
    await store.getState().addDownload({ ...music, id: 'third' }, '320k'); await flush();
    const queuedId = task().id;
    expect(task().status).toBe('queued');
    await store.getState().cancelTask(queuedId);
    expect(task().status).toBe('cancelled');
    expect(native.cancel).not.toHaveBeenCalled();
    transfer.resolve('memory-only/song.mp3'); await flush();
    store.getState().removeTask(queuedId);
    expect(store.getState().tasks).toHaveLength(2);
    store.getState().clearCompleted();
    expect(store.getState().tasks).toEqual([]);
  });

});
