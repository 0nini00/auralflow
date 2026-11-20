// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { create } from 'zustand';
import type { DownloadTask } from '../src/stores/downloadStore';
import { DownloadsView } from '../src/views/DownloadsView';

const mocks = vi.hoisted(() => ({ store: null as unknown, covers: [] as string[], remove: vi.fn() }));
vi.mock('@/stores/downloadStore', () => ({ useDownloadStore: (selector: (state: unknown) => unknown) =>
  (mocks.store as (selector: (state: unknown) => unknown) => unknown)(selector) }));
vi.mock('@/stores/playerStore', () => ({ usePlayerStore: (select: (state: object) => unknown) => select({ playQueue: vi.fn() }) }));
vi.mock('@/utils/imageReferrerPolicy', () => ({ PLAYER_COVER_CSS_SIZE: 64, coverSrc: (url: string) => { mocks.covers.push(url); return url; } }));
vi.mock('@/services/logger', () => ({ logger: { warn: vi.fn() } }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });

it('千条下载仅挂载可见行，进度更新只重渲染对应行，保留移除入口和主滚动定位', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400);
  const tasks = Array.from({ length: 1000 }, (_, index) => ({ id: String(index), status: 'downloading',
    music: { id: String(index), name: `Song ${index}`, source: 'wy', img: `cover-${index}` },
    progress: 0, speed: 0, downloaded: 0, total: 100, fileName: `${index}.mp3` })) as DownloadTask[];
  const store = create(() => ({ tasks, downloadDir: '', retryTask: vi.fn(), removeTask: mocks.remove,
    cancelTask: vi.fn(), clearCompleted: vi.fn(), toLocalMusic: vi.fn(), chooseDownloadDir: vi.fn() }));
  mocks.store = store;
  document.body.innerHTML = '<main class="af-content-scroll"><div id="root"></div></main>';
  const root = createRoot(document.getElementById('root')!);
  try {
    act(() => root.render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><DownloadsView /></MemoryRouter>));
    expect(document.querySelectorAll('.af-download-item').length).toBeLessThan(30);
    mocks.covers = [];
    act(() => store.setState({ tasks: tasks.map((task, index) => index === 0 ? { ...task, progress: 50 } : task) }));
    expect(mocks.covers).toEqual(['cover-0']);
    act(() => document.querySelector<HTMLButtonElement>('[title="移除任务"]')!.click());
    expect(mocks.remove).toHaveBeenLastCalledWith('0');
  } finally { act(() => root.unmount()); }
});
