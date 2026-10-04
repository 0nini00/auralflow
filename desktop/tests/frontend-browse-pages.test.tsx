import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { MemoryRouter, Route, Routes, useNavigate, type NavigateFunction } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MusicInfo, SearchType } from '@lx/core';
import { SearchView } from '../src/views/SearchView';
import { PersonalFmView } from '../src/views/PersonalFmView';
import { PlaylistDetailView } from '../src/views/PlaylistDetailView';
import { useWyAccountStore } from '../src/stores/wyAccountStore';
import { useDiscoveryStore } from '../src/stores/discoveryStore';
import { usePlayerStore } from '../src/stores/playerStore';
import { usePlaylistStore } from '../src/stores/playlistStore';
import { searchResultCache } from '../src/services/search/searchResultCache';

const api = vi.hoisted(() => ({
  wySearch: vi.fn(), txSearch: vi.fn(), remote: vi.fn(), fm: vi.fn(),
  accountSongs: vi.fn(), accountRefresh: vi.fn(), subscribe: vi.fn(), remove: vi.fn(),
}));
vi.mock('@/services/sources', () => ({ registry: { get: (source: string) => ({
  supportedSearchTypes: ['song', 'playlist', 'singer', 'album'],
  search: source === 'wy' ? api.wySearch : api.txSearch,
}) } }));
vi.mock('@/services/sources/sourceService', () => ({ getSource: () => ({ getPlaylistDetail: api.remote }) }));
vi.mock('@/services/search/searchSuggestions', () => ({
  buildSearchSuggestions: () => [], fetchWySearchSuggestions: async () => [],
  mergeSearchSuggestions: () => [], recordSearchKeyword: vi.fn(),
}));
vi.mock('@/components/SongAddMenuButton', () => ({ SongAddMenuButton: () => null, SongAddMenu: () => null }));
vi.mock('@/components/DownloadQualityButton', () => ({ DownloadQualityButton: () => null, DownloadQualityMenu: () => null }));
vi.mock('@/components/VirtualList', () => ({ VirtualList: ({ items, renderItem }: any) => <>{items.map((item: MusicInfo, index: number) => <div key={`${item.source}:${item.id}`}>{renderItem(item, index)}</div>)}</> }));
vi.mock('@/stores/wyAccountStore', async () => {
  const { create } = await import('zustand');
  return { useWyAccountStore: create(() => ({ account: null, isLoaded: true, playlists: [],
    getPlaylistSongs: api.accountSongs, refreshPlaylistSongs: api.accountRefresh,
    setSubscribed: api.subscribe, removeTracks: api.remove,
  })) };
});
vi.mock('@/stores/playerStore', async () => {
  const { create } = await import('zustand');
  return { usePlayerStore: create(() => ({ current: null, status: 'paused', fmMode: false,
    playQueue: vi.fn(async () => {}), playNext: vi.fn(), play: vi.fn(async () => {}),
    pause: vi.fn(), resume: vi.fn(), enterFmMode: vi.fn(),
  })) };
});
vi.mock('@/stores/playlistStore', async () => {
  const { create } = await import('zustand');
  return { usePlaylistStore: create(() => ({ playlists: [], removeSongFromPlaylist: vi.fn(),
    importPlaylist: vi.fn(() => ({ id: 'imported' })), updatePlaylistCover: vi.fn(),
  })) };
});
vi.mock('@/stores/favoritesStore', async () => {
  const { create } = await import('zustand');
  return { useFavoritesStore: create(() => ({ favorites: [], removeFavorite: vi.fn() })) };
});
vi.mock('@/stores/discoveryStore', async () => {
  const { create } = await import('zustand');
  const { createPersonalFmQueueController } = await import('../src/services/personalFmQueue');
  return { useDiscoveryStore: create((set: any, get: any) => {
    const controller = createPersonalFmQueueController({ getState: get, setState: set,
      fetchTracks: api.fm, trashTrack: vi.fn(async () => {}),
    });
    return { fmQueue: [], fmIndex: 0, fmLoading: false, fmPrefetching: false, fmError: '',
      loadFm: controller.load, fmNext: controller.next, fmReset: controller.reset, fmDislike: controller.dislike,
    };
  }) };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const song = (id: string): MusicInfo => ({ id, source: 'wy', name: id, singer: 'Artist', interval: 120 } as MusicInfo);
const account = (uid: string) => ({ uid, nickname: uid } as any);
let renderer: ReactTestRenderer | undefined;
let navigate: NavigateFunction;
function Navigation() { navigate = useNavigate(); return null; }
async function mount(path: string) {
  await act(async () => { renderer = create(<MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    <Navigation /><Routes>
      <Route path="/search" element={<SearchView />} />
      <Route path="/fm" element={<PersonalFmView />} />
      <Route path="/playlist/:id" element={<PlaylistDetailView />} />
    </Routes>
  </MemoryRouter>); });
}
function text(node: ReactTestInstance): string {
  if (node.type === 'style' || node.type === 'svg') return '';
  return node.children.map(child => typeof child === 'string' ? child : text(child)).join('');
}
const page = () => text(renderer!.root);
function button(label: string) {
  return renderer!.root.findAllByType('button').find(node => text(node).trim() === label)!;
}
async function click(label: string) { await act(async () => { button(label).props.onClick(); }); }
async function tab(label: string) {
  await act(async () => { renderer!.root.findAllByProps({ role: 'tab' }).find(node => text(node).startsWith(label))!.props.onClick(); });
}
async function go(path: string) { await act(async () => { navigate(path); }); }
beforeEach(() => {
  vi.clearAllMocks();
  const storage = { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() };
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('window', { localStorage: storage, setTimeout, clearTimeout });
  searchResultCache.clear();
  api.wySearch.mockReset().mockResolvedValue({});
  api.txSearch.mockReset().mockResolvedValue({});
  api.remote.mockReset().mockResolvedValue([]);
  api.accountSongs.mockReset().mockResolvedValue([]);
  api.accountRefresh.mockReset().mockResolvedValue([]);
  api.fm.mockReset().mockImplementation(() => new Promise(() => {}));
  useWyAccountStore.setState({ account: account('user-A'), isLoaded: true, playlists: [
    { id: 'owned', name: 'Owned playlist', subscribed: false },
  ] as any });
  usePlaylistStore.setState({ playlists: [{ id: 'local', name: 'Local playlist', songs: [song('Local-song')], createdAt: 0, updatedAt: 0 }] as any });
  usePlayerStore.setState({ current: song('External-song'), status: 'paused', fmMode: false });
  useDiscoveryStore.getState().fmReset();
});
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); });

describe('搜索分类的成功、警告、空和失败', () => {
  it('另一分类失败不挡成功单曲，失败分类不能伪装为空，重试恢复', async () => {
    const songs = deferred<any>(), albums = deferred<any>();
    api.wySearch.mockImplementation((_q, type: SearchType) => type === 'song' ? songs.promise : type === 'album' ? albums.promise : Promise.resolve({}));
    api.txSearch.mockImplementation((_q, type: SearchType) => type === 'album' ? albums.promise : Promise.resolve({}));
    await mount('/search?q=alpha');
    await act(async () => { songs.resolve({ songs: [song('Success-song')] }); albums.reject(new Error('album unavailable')); });
    expect(page()).toContain('Success-song');
    expect(page()).toContain('album unavailable');
    await tab('专辑');
    expect(page()).toContain('搜索失败');
    expect(page()).not.toContain('没有找到专辑');
    api.wySearch.mockImplementation(async (_q, type) => type === 'album' ? { albums: [{ id: 'album', name: 'Recovered-album', source: 'wy' }] } : {});
    api.txSearch.mockResolvedValue({});
    await click('重试');
    expect(page()).toContain('Recovered-album');
    expect(page()).not.toContain('album unavailable');
  });

  it('同分类部分音源失败仍呈现成功结果及警告', async () => {
    api.wySearch.mockImplementation(async (_q, type) => type === 'song' ? { songs: [song('Wy-success')] } : {});
    api.txSearch.mockImplementation(async (_q, type) => { if (type === 'song') throw new Error('tx unavailable'); return {}; });
    await mount('/search?q=alpha');
    expect(page()).toContain('Wy-success');
    expect(page()).toContain('tx unavailable');
    await tab('专辑');
    expect(page()).toContain('没有找到专辑');
    expect(page()).not.toContain('tx unavailable');
  });

  it('有成功空响应时，部分失败不能展示为完整无结果', async () => {
    api.wySearch.mockImplementation(async (_q, type) => { if (type === 'song') throw new Error('wy failed'); return {}; });
    await mount('/search?q=alpha');
    expect(page()).not.toContain('没有找到相关内容');
    expect(page()).toContain('wy failed');
    expect(button('重试')).toBeDefined();
  });

  it('全部成功但为空才展示无结果；全部失败显示失败和重试', async () => {
    await mount('/search?q=empty');
    expect(page()).toContain('没有找到相关内容');
    expect(button('重试')).toBeDefined();
    api.wySearch.mockRejectedValue(new Error('offline'));
    api.txSearch.mockRejectedValue(new Error('offline'));
    await go('/search?q=failed');
    expect(page()).toContain('搜索失败');
    expect(button('重试')).toBeDefined();
  });
});

describe('搜索请求和缓存身份', () => {
  it('部分成功的分类状态随结果缓存恢复，不能丢失警告', async () => {
    api.wySearch.mockImplementation(async (q, type) => q === 'alpha' && type === 'song' ? { songs: [song('Cached-song')] } : {});
    api.txSearch.mockImplementation(async (q, type) => { if (q === 'alpha' && type === 'song') throw new Error('cached warning'); return {}; });
    await mount('/search?q=alpha');
    await tab('单曲');
    await go('/search?q=beta');
    const requests = api.wySearch.mock.calls.length;
    await go('/search?q=alpha');
    expect(api.wySearch).toHaveBeenCalledTimes(requests);
    expect(page()).toContain('Cached-song');
    expect(page()).toContain('cached warning');
    expect(renderer!.root.findAllByProps({ role: 'tab', 'aria-selected': true }).map(text)).toEqual(['单曲']);
  });

  it('迟到的旧搜索失败不覆盖新关键词成功结果', async () => {
    const old = deferred<any>();
    api.wySearch.mockImplementation((q, type) => q === 'old' ? old.promise : Promise.resolve(type === 'song' ? { songs: [song('New-song')] } : {}));
    api.txSearch.mockImplementation((q) => q === 'old' ? old.promise : Promise.resolve({}));
    await mount('/search?q=old');
    await go('/search?q=new');
    await act(async () => { old.reject(new Error('old search failed')); });
    expect(page()).toContain('New-song');
    expect(page()).not.toContain('old search failed');
  });
});

describe('FM 初始化请求生命周期', () => {
  it.each(['empty', 'failed'] as const)('%s 结束后不自动循环，显式重试可重新发起', async (outcome) => {
    const first = deferred<MusicInfo[]>();
    api.fm.mockImplementationOnce(() => first.promise);
    await mount('/fm');
    expect(api.fm).toHaveBeenCalledTimes(1);
    await act(async () => { outcome === 'empty' ? first.resolve([]) : first.reject(new Error('FM offline')); });
    expect(api.fm).toHaveBeenCalledTimes(1);
    expect(page()).not.toContain('正在为你挑选歌曲');
    expect(page()).toContain(outcome === 'empty' ? '暂无推荐' : 'FM offline');
    await click('重试');
    expect(api.fm).toHaveBeenCalledTimes(2);
  });

  it('同 uid 更新不重启，账号改变可使旧请求失效并初始化新账号', async () => {
    const first = deferred<MusicInfo[]>(), second = deferred<MusicInfo[]>();
    api.fm.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    await mount('/fm');
    await act(async () => { useWyAccountStore.setState({ account: account('user-A') }); });
    expect(api.fm).toHaveBeenCalledTimes(1);
    await act(async () => { useWyAccountStore.setState({ account: account('user-B') }); });
    expect(api.fm).toHaveBeenCalledTimes(2);
    await act(async () => { second.resolve([song('B-fm')]); first.resolve([song('A-fm')]); });
    expect(useDiscoveryStore.getState().fmQueue.map(track => track.id)).toEqual(['B-fm']);
    expect(usePlayerStore.getState().play).not.toHaveBeenCalled();
  });

  it('等待账号加载，登出使请求失效，再登录可以重新初始化', async () => {
    const pending = deferred<MusicInfo[]>();
    api.fm.mockImplementationOnce(() => pending.promise);
    useWyAccountStore.setState({ isLoaded: false });
    await mount('/fm');
    expect(api.fm).not.toHaveBeenCalled();
    await act(async () => { useWyAccountStore.setState({ isLoaded: true }); });
    expect(api.fm).toHaveBeenCalledTimes(1);
    await act(async () => { useWyAccountStore.setState({ account: null }); });
    await act(async () => { pending.resolve([song('Logged-out-song')]); });
    expect(useDiscoveryStore.getState().fmQueue).toEqual([]);
    expect(page()).toContain('请先登录网易云账号');
    await act(async () => { useWyAccountStore.setState({ account: account('user-A') }); });
    expect(api.fm).toHaveBeenCalledTimes(2);
  });

});

describe('歌单来源、身份及请求代次', () => {
  it.each(['remote', 'account'] as const)('%s A 刷新晚于 B 完成时，不能覆盖 B 数据', async (kind) => {
    const refresh = deferred<MusicInfo[]>();
    api.remote.mockResolvedValueOnce([song('A-song')]).mockImplementationOnce(() => refresh.promise).mockResolvedValueOnce([song('B-song')]);
    api.accountSongs.mockResolvedValueOnce([song('A-song')]).mockResolvedValueOnce([song('B-song')]);
    api.accountRefresh.mockImplementationOnce(() => refresh.promise);
    useWyAccountStore.setState({ playlists: ['A', 'B'].map(id => ({ id, name: id, subscribed: false })) as any });
    const suffix = kind === 'remote' ? '?source=tx' : '';
    await mount(`/playlist/A${suffix}`);
    await click('刷新');
    await go(`/playlist/B${suffix}`);
    expect(page()).toContain('B-song');
    await act(async () => { refresh.resolve([song('A-late')]); });
    expect(page()).toContain('B-song');
    expect(page()).not.toContain('A-late');
    await click('播放全部');
    expect(usePlayerStore.getState().playQueue).toHaveBeenLastCalledWith([song('B-song')], 0);
  });

  it('旧刷新失败不能覆盖新歌单的成功状态', async () => {
    const refresh = deferred<MusicInfo[]>();
    api.remote.mockResolvedValueOnce([song('A-song')]).mockImplementationOnce(() => refresh.promise).mockResolvedValueOnce([song('B-song')]);
    await mount('/playlist/A?source=tx'); await click('刷新'); await go('/playlist/B?source=tx');
    await act(async () => { refresh.reject(new Error('A late failure')); });
    expect(page()).toContain('B-song');
    expect(page()).not.toContain('A late failure');
  });

  it.each(['loading', 'error'] as const)('remote %s 切到 account/local，不残留 loading 或 error', async (phase) => {
    const remote = deferred<MusicInfo[]>();
    api.remote.mockImplementationOnce(() => remote.promise);
    api.accountSongs.mockResolvedValue([song('Owned-song')]);
    await mount('/playlist/A?source=tx');
    if (phase === 'error') await act(async () => { remote.reject(new Error('A failed')); });
    await go('/playlist/owned');
    expect(page()).toContain('Owned-song');
    expect(page()).not.toContain('正在加载歌曲');
    expect(page()).not.toContain('A failed');
    await go('/playlist/local');
    expect(page()).toContain('Local-song');
    expect(page()).not.toContain('正在加载歌曲');
    if (phase === 'loading') await act(async () => { remote.resolve([song('A late')]); });
    expect(page()).toContain('Local-song');
  });

  it('account 失败切到 remote 和 local 不残留错误；remote 可显式重试', async () => {
    api.accountSongs.mockRejectedValueOnce(new Error('owned failed'));
    api.remote.mockRejectedValueOnce(new Error('remote failed')).mockResolvedValueOnce([song('Recovered-song')]);
    await mount('/playlist/owned');
    await go('/playlist/A?source=tx');
    expect(page()).not.toContain('owned failed');
    expect(page()).toContain('remote failed');
    await click('重试');
    expect(page()).toContain('Recovered-song');
    await go('/playlist/local');
    expect(page()).toContain('Local-song');
  });

  it('远程空歌单提供重试且保持空状态稳定', async () => {
    await mount('/playlist/A?source=tx');
    expect(page()).toContain('歌单是空的');
    expect(button('重试')).toBeDefined();
    expect(api.remote).toHaveBeenCalledTimes(1);
  });

  it('A 刷新迟到不能结束 B 的 loading，B 失败也不能覆盖重新打开的 A', async () => {
    const oldA = deferred<MusicInfo[]>(), pendingB = deferred<MusicInfo[]>(), newA = deferred<MusicInfo[]>();
    api.remote.mockResolvedValueOnce([song('A-original')]).mockImplementationOnce(() => oldA.promise)
      .mockImplementationOnce(() => pendingB.promise).mockImplementationOnce(() => newA.promise);
    await mount('/playlist/A?source=tx'); await click('刷新');
    await go('/playlist/B?source=tx');
    await act(async () => { oldA.resolve([song('A-obsolete')]); });
    expect(page()).toContain('正在加载歌曲');
    expect(page()).not.toContain('A-obsolete');
    await go('/playlist/A?source=tx');
    await act(async () => { newA.resolve([song('A-new')]); pendingB.reject(new Error('B obsolete')); });
    expect(page()).toContain('A-new');
    expect(page()).not.toContain('B obsolete');
    expect(page()).not.toContain('正在加载歌曲');
  });

  it('同一个 ID 切换 account/remote/local，各自仅展示当前来源歌曲', async () => {
    const owned = deferred<MusicInfo[]>();
    api.accountSongs.mockImplementationOnce(() => owned.promise);
    api.remote.mockResolvedValueOnce([song('Tx-song')]);
    await mount('/playlist/owned');
    await go('/playlist/owned?source=tx');
    expect(page()).toContain('Tx-song');
    await act(async () => { owned.reject(new Error('account obsolete')); });
    expect(page()).not.toContain('account obsolete');
    await go('/playlist/local');
    expect(page()).toContain('Local-song');
    expect(page()).not.toContain('Tx-song');
  });

  it('账号刷新失败可以重试，不误用远程音源；收藏与虚拟列表接口保持连接', async () => {
    api.accountSongs.mockRejectedValueOnce(new Error('owned failed'));
    api.accountRefresh.mockResolvedValueOnce([song('Owned-recovered')]);
    await mount('/playlist/owned'); await click('重试');
    expect(api.accountRefresh).toHaveBeenLastCalledWith('owned');
    expect(api.remote).not.toHaveBeenCalled();
    expect(page()).toContain('Owned-recovered');
    api.remote.mockResolvedValueOnce([song('Import-song')]);
    await go('/playlist/A?source=tx');
    await click('收藏到本地歌单');
    expect(usePlaylistStore.getState().importPlaylist).toHaveBeenCalledWith('QQ 音乐歌单', expect.stringContaining('[af-imported-playlist:tx:A]'), [song('Import-song')]);
    expect(renderer!.root.findByProps({ rowHeight: 60 }).props.items).toEqual([song('Import-song')]);
    expect(renderer!.root.findByProps({ rowHeight: 60 }).props.scrollRootSelector).toBe('.af-content-scroll');
  });


  it('A 刷新经过 A-B-A 导航后迟到，即使身份相同也不能覆盖新代次', async () => {
    const oldA = deferred<MusicInfo[]>();
    api.remote.mockResolvedValueOnce([song('A-first')]).mockImplementationOnce(() => oldA.promise)
      .mockResolvedValueOnce([song('B-song')]).mockResolvedValueOnce([song('A-current')]);
    await mount('/playlist/A?source=tx'); await click('刷新');
    await go('/playlist/B?source=tx'); await go('/playlist/A?source=tx');
    await act(async () => { oldA.resolve([song('A-obsolete')]); });
    expect(page()).toContain('A-current');
    expect(page()).not.toContain('A-obsolete');
  });

});


describe('浏览页面紧凑反馈', () => {
  it('搜索部分失败使用三列 inline 反馈，不用整页空状态推远成功结果', async () => {
    api.wySearch.mockImplementation(async (_q, type) => type === 'song' ? { songs: [song('Visible-song')] } : {});
    api.txSearch.mockImplementation(async (_q, type) => { if (type === 'song') throw new Error('partial failure'); return {}; });
    await mount('/search?q=partial');
    expect(page()).toContain('Visible-song');
    const feedback = renderer!.root.findByProps({ className: 'af-page-feedback', role: 'status' });
    expect(feedback.children).toHaveLength(3);
    expect(text(feedback)).toContain('partial failure');
    expect(feedback.findByType('button').children).toEqual(['重试']);
    expect(renderer!.root.findAllByProps({ className: 'af-empty-state' })).toHaveLength(0);
  });

  it.each(['remote', 'account'] as const)('%s 刷新失败保留列表和播放入口，在标题下 inline 提示并可重试', async (kind) => {
    const refresh = deferred<MusicInfo[]>();
    api.remote.mockResolvedValueOnce([song('Kept-song')]).mockImplementationOnce(() => refresh.promise).mockResolvedValueOnce([song('Refreshed-song')]);
    api.accountSongs.mockResolvedValueOnce([song('Kept-song')]);
    api.accountRefresh.mockImplementationOnce(() => refresh.promise).mockResolvedValueOnce([song('Refreshed-song')]);
    await mount(kind === 'remote' ? '/playlist/A?source=tx' : '/playlist/owned');
    await click('刷新');
    await act(async () => { refresh.reject(new Error('refresh unavailable')); });
    expect(page()).toContain('Kept-song');
    expect(renderer!.root.findByProps({ rowHeight: 60 }).props.items).toEqual([song('Kept-song')]);
    const meta = renderer!.root.findByProps({ className: 'af-playlist-detail-meta' });
    const feedback = meta.findByProps({ className: 'af-page-feedback', role: 'status' });
    expect(meta.children[0]).toMatchObject({ type: 'h1' });
    expect(meta.children[1]).toBe(feedback);
    expect(feedback.children).toHaveLength(3);
    expect(text(feedback)).toContain('refresh unavailable');
    expect(renderer!.root.findAllByProps({ className: 'af-empty-state' })).toHaveLength(0);
    await click('播放全部');
    expect(usePlayerStore.getState().playQueue).toHaveBeenLastCalledWith([song('Kept-song')], 0);
    await act(async () => { feedback.findByType('button').props.onClick(); });
    expect(page()).toContain('Refreshed-song');
    expect(page()).not.toContain('refresh unavailable');
    expect(renderer!.root.findAllByProps({ className: 'af-page-feedback' })).toHaveLength(0);
  });

  it.each(['remote', 'account'] as const)('%s 初次请求失败仍使用整页错误和重试', async (kind) => {
    api.remote.mockRejectedValueOnce(new Error('initial unavailable'));
    api.accountSongs.mockRejectedValueOnce(new Error('initial unavailable'));
    await mount(kind === 'remote' ? '/playlist/A?source=tx' : '/playlist/owned');
    const empty = renderer!.root.findByProps({ className: 'af-empty-state' });
    expect(text(empty)).toContain('initial unavailable');
    expect(button('重试')).toBeDefined();
    expect(renderer!.root.findAllByProps({ className: 'af-page-feedback' })).toHaveLength(0);
    expect(renderer!.root.findAllByProps({ rowHeight: 60 })).toHaveLength(0);
  });

  it('已有成功空歌单时刷新失败保留空歌单页面，不误判成初次失败', async () => {
    api.remote.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('empty refresh failed'));
    await mount('/playlist/A?source=tx');
    await click('刷新');
    expect(page()).toContain('歌单是空的');
    expect(renderer!.root.findByProps({ className: 'af-playlist-detail-meta' }).findByType('h1')).toBeDefined();
    expect(text(renderer!.root.findByProps({ className: 'af-page-feedback', role: 'status' }))).toContain('empty refresh failed');
  });
});
