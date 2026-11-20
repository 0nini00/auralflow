import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { DownloadTask } from '../src/stores/downloadStore';
const boundary = vi.hoisted(() => ({ handlers: new Map<string, (payload: unknown) => void>() }));
vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (path: string) => path }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('@lx/tauri-bridge', () => ({ TAURI_EVENTS: { downloadProgress: 'progress', downloadCompleted: 'completed' }, listenTauriEvent: async (name: string, handler: (value: unknown) => void) => { boundary.handlers.set(name, handler); return () => {}; } }));
vi.mock('@/services/downloadService', () => ({}));
let values: Map<string, string>;
let write: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetModules(); boundary.handlers.clear(); values = new Map();
  write = vi.fn((key: string, value: string) => values.set(key, value));
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: write, removeItem: (key: string) => values.delete(key) };
  vi.stubGlobal('window', { localStorage: storage }); vi.stubGlobal('localStorage', storage);
});
afterEach(() => vi.unstubAllGlobals());

it('进度事件不序列化稳定下载记录，状态完成时立即持久化可恢复文件', async () => {
  const tasks = Array.from({ length: 1000 }, (_, id) => ({ id: String(id), music: { id: String(id), source: 'wy', name: 'Song', singer: 'Artist', albumName: '' }, status: id ? 'completed' : 'downloading', progress: 0, downloaded: 0, speed: 0, fileName: 'song.mp3', createdAt: 1, updatedAt: 1 })) as DownloadTask[];
  const { useDownloadStore } = await import('../src/stores/downloadStore');
  useDownloadStore.setState({ tasks });
  await useDownloadStore.getState().initDownloadListeners();
  write.mockClear();
  const serialize = vi.spyOn(JSON, 'stringify');
  try {
    for (let i = 1; i <= 10; i++) boundary.handlers.get('progress')!({ taskId: '0', progress: i, downloaded: i, total: 100, speed: 1 });
    expect(useDownloadStore.getState().tasks[0].progress).toBe(10);
    expect(write.mock.calls.length).toBe(0);
    expect(serialize.mock.calls.length).toBe(0);
    boundary.handlers.get('completed')!({ taskId: '0', savedPath: 'memory/song.mp3', total: 100 });
    expect(write).toHaveBeenCalledOnce();
    expect(JSON.parse(values.get('download-storage')!).state.tasks[0]).toMatchObject({ status: 'completed', savedPath: 'memory/song.mp3', warning: expect.stringContaining('后处理') });
  } finally { serialize.mockRestore(); }
});

it('保留已有下载存档并把在途任务标为中断，完成文件仍可播放', async () => {
  values.set('download-storage', JSON.stringify({ state: { downloadDir: 'memory', tasks: [
    { id: 'active', music: { id: 'a', source: 'wy', name: 'A' }, status: 'downloading' },
    { id: 'done', music: { id: 'b', source: 'wy', name: 'B' }, status: 'completed', savedPath: 'memory/b.mp3' },
  ] }, version: 0 }));
  const { useDownloadStore } = await import('../src/stores/downloadStore');
  expect(useDownloadStore.getState().downloadDir).toBe('memory');
  expect(useDownloadStore.getState().tasks[0].status).toBe('failed');
  expect(useDownloadStore.getState().toLocalMusic(useDownloadStore.getState().tasks[1])?.url).toBe('memory/b.mp3');
});
