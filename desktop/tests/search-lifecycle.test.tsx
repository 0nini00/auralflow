// @vitest-environment jsdom
import { StrictMode, act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { SearchView } from '../src/views/SearchView';
import { searchResultCache } from '../src/services/search/searchResultCache';

const api = vi.hoisted(() => ({ search: vi.fn() }));
const player = vi.hoisted(() => ({ playQueue: vi.fn() }));
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

it('StrictMode 重新挂载 effect 后恢复搜索会话，返回结果不会被已 dispose 的旧会话吞掉', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
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
