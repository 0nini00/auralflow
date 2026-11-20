// @vitest-environment jsdom
import { StrictMode, act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { SearchView } from '../src/views/SearchView';
import { searchResultCache } from '../src/services/search/searchResultCache';

const api = vi.hoisted(() => ({ search: vi.fn() }));
const player = vi.hoisted(() => ({ playQueue: vi.fn() }));
const covers = vi.hoisted(() => ({ render: vi.fn((url: string) => url) }));
vi.mock('@/utils/imageReferrerPolicy', () => ({ RESULT_COVER_CSS_SIZE: 64, coverSrc: covers.render }));
vi.mock('@/services/sources', () => ({ registry: { get: (id: string) => ({ id, supportedSearchTypes: ['song'], search: api.search }) } }));
vi.mock('@/services/search/searchSuggestions', () => ({
  buildSearchSuggestions: () => [], fetchWySearchSuggestions: async () => [],
  mergeSearchSuggestions: () => [], recordSearchKeyword: vi.fn(),
}));
vi.mock('@/components/SongAddMenuButton', () => ({ SongAddMenuButton: () => null }));
vi.mock('@/components/DownloadQualityButton', () => ({ DownloadQualityButton: () => null }));
vi.mock('@/components/VariantPickerButton', () => ({ VariantPickerButton: () => null }));
vi.mock('@/stores/playerStore', () => ({ usePlayerStore: (select: (state: object) => unknown) => select({ playQueue: player.playQueue }) }));
vi.mock('@/stores/playlistStore', () => ({ usePlaylistStore: (select: (state: object) => unknown) => select({ playlists: [], importPlaylist: vi.fn() }) }));
vi.mock('@/stores/wyAccountStore', () => ({ useWyAccountStore: (select: (state: object) => unknown) => select({ account: null, playlists: [], setSubscribed: vi.fn() }) }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('千条搜索结果只挂载可见行，End 可聚焦末行并播放原索引，加载状态保留现有行', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400);
  searchResultCache.clear(); localStorage.clear();
  const songs = Array.from({ length: 1000 }, (_, index) => ({ id: String(index), name: `Unique song ${index}`, singer: `Singer ${index}`, source: 'wy', img: `cover-${index}` }));
  api.search.mockImplementation((_query: string, _type: string, page: number) => page === 1
    ? Promise.resolve({ songs, hasMore: true }) : new Promise(() => {}));
  const host = document.createElement('main'); host.className = 'af-content-scroll';
  const container = document.createElement('div'); host.appendChild(container); document.body.appendChild(host);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<MemoryRouter initialEntries={['/search?q=virtual']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><SearchView /></MemoryRouter>));
    expect(container.querySelectorAll('[data-search-result]').length).toBeLessThan(30);
    covers.render.mockClear();
    const more = [...container.querySelectorAll('button')].find(button => button.textContent?.startsWith('加载更多'))!;
    await act(async () => more.click());
    expect(covers.render).not.toHaveBeenCalled();
    const first = container.querySelector<HTMLElement>('[data-search-result]')!;
    first.focus();
    act(() => first.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })));
    expect(document.activeElement?.textContent).toContain('Unique song 999');
    act(() => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(player.playQueue.mock.calls.at(-1)?.[1]).toBe(999);
    expect(host.scrollTop).toBeGreaterThan(10000);
  } finally { act(() => root.unmount()); host.remove(); }
});

it('StrictMode 重新挂载 effect 后恢复搜索会话，返回结果不会被已 dispose 的旧会话吞掉', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  searchResultCache.clear();
  localStorage.clear();
  let resolve!: (result: object) => void;
  const pending = new Promise<object>(done => { resolve = done; });
  api.search.mockReturnValue(pending);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(<StrictMode><MemoryRouter initialEntries={['/search?q=alpha']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><SearchView /></MemoryRouter></StrictMode>);
    });
    await act(async () => { resolve({ songs: [{ id: '1', name: 'Strict-mode-song', singer: 'Artist', source: 'wy' }], hasMore: false }); });
    expect(container.textContent).toContain('Strict-mode-song');
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();

    // 结果行必须能 Tab 到，并用 Enter 触发（键盘用户此前完全进不了列表）。
    const row = container.querySelector('.af-search-result-item') as HTMLElement;
    expect(row.getAttribute('role')).toBe('button');
    expect(row.getAttribute('tabindex')).toBe('0');
    expect(row.hasAttribute('data-search-result')).toBe(true);
    row.focus();
    await act(async () => {
      row.parentElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    expect(document.activeElement).toBe(row);
    await act(async () => {
      row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(player.playQueue).toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
