import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MusicInfo, PlaylistInfo, WyLeaderboardBoard } from '@lx/core';
import { HomeView } from '../src/views/HomeView';
import { LeaderboardView } from '../src/views/LeaderboardView';
import { PlaylistSquareView } from '../src/views/PlaylistSquareView';
import { useDiscoverFeedStore } from '../src/stores/discoverFeedStore';

/**
 * 发现页 / 排行榜 / 歌单广场的行为契约。
 *
 * 这几页的数据都走网易云公开接口（不读 Cookie），所以测试里只需要证明三件事：
 * 1. 发现页的区块是「推荐歌单 + 排行榜」，原来的「最近播放」不再占位；
 * 2. 榜单/歌单点进去带的是 `source=wy` 的详情路由（缺了它详情页会猜错音源）；
 * 3. 歌单广场分页偏移按请求页大小推进，切分类会作废旧请求。
 */

const api = vi.hoisted(() => ({
  recommended: vi.fn(),
  boards: vi.fn(),
  page: vi.fn(),
  previewSongs: vi.fn(),
}));

vi.mock('@/services/wyDiscoverService', () => ({
  fetchWyRecommendedPlaylists: api.recommended,
  fetchWyLeaderboardBoards: api.boards,
  fetchWyPlaylistsByCategory: api.page,
}));
vi.mock('@/services/sources/sourceService', () => ({
  getSource: () => ({ getPlaylistDetail: api.previewSongs }),
}));
vi.mock('@/components/SongAddMenuButton', () => ({ SongAddMenuButton: () => null }));
vi.mock('@/stores/wyAccountStore', () => ({
  useWyAccountStore: (selector: (state: { account: null }) => unknown) => selector({ account: null }),
}));
vi.mock('@/stores/playerStore', () => ({
  usePlayerStore: (selector: (state: { playQueue: () => Promise<void> }) => unknown) =>
    selector({ playQueue: async () => {} }),
}));

const playlist = (id: string, name: string): PlaylistInfo =>
  ({ id, name, author: '网易云音乐', source: 'wy' } as PlaylistInfo);
const song = (id: string): MusicInfo => ({ id, source: 'wy', name: id, singer: '歌手', interval: 120 } as MusicInfo);
const board = (id: string, name: string): WyLeaderboardBoard =>
  ({ id, name, group: 'official' } as WyLeaderboardBoard);

let renderer: ReactTestRenderer | undefined;
let location = '';

function LocationProbe() {
  const current = useLocation();
  location = `${current.pathname}${current.search}`;
  return null;
}

async function mount(path: string) {
  await act(async () => {
    renderer = create(
      <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <LocationProbe />
        <Routes>
          <Route path="/" element={<HomeView />} />
          <Route path="/charts" element={<LeaderboardView />} />
          <Route path="/playlist-square" element={<PlaylistSquareView />} />
          <Route path="/playlist/:id" element={<div>歌单详情</div>} />
        </Routes>
      </MemoryRouter>,
    );
  });
}

function text(node: ReactTestInstance): string {
  if (node.type === 'style' || node.type === 'svg') return '';
  return node.children.map((child) => (typeof child === 'string' ? child : text(child))).join('');
}
const page = () => text(renderer!.root);
function byAriaLabel(label: string) {
  return renderer!.root.findAll((node) => node.type === 'button' && node.props['aria-label'] === label);
}
function byText(label: string) {
  return renderer!.root.findAllByType('button').find((node) => text(node).trim() === label);
}
async function click(label: string) {
  await act(async () => { byText(label)!.props.onClick(); });
}

function resetFeed() {
  useDiscoverFeedStore.setState({
    recommended: [],
    recommendedStatus: 'idle',
    recommendedError: '',
    boards: [],
    boardsStatus: 'idle',
    boardsError: '',
    boardsDegraded: false,
    previewBoardId: '',
    previewBoardName: '',
    previewSongs: [],
    previewStatus: 'idle',
    previewError: '',
    fetchedAt: 0,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetFeed();
  location = '';
  api.recommended.mockResolvedValue([playlist('p1', '推荐一')]);
  api.boards.mockResolvedValue({ boards: [board('19723756', '飙升榜')], degraded: false });
  api.previewSongs.mockResolvedValue([song('s1'), song('s2')]);
  api.page.mockResolvedValue({ playlists: [playlist('sq1', '广场一')], hasMore: false });
});
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

describe('发现页区块', () => {
  it('推荐歌单与排行榜取代最近播放', async () => {
    await mount('/');
    const content = page();
    expect(content).toContain('推荐歌单');
    expect(content).toContain('推荐一');
    expect(content).toContain('排行榜 · 飙升榜');
    expect(content).toContain('s1');
    expect(content).not.toContain('最近播放');
  });

  it('点推荐歌单进详情页时带上 source=wy', async () => {
    await mount('/');
    const hit = byAriaLabel('打开 推荐一 - 网易云音乐')[0];
    expect(hit).toBeTruthy();
    await act(async () => { hit.props.onClick(); });
    expect(location).toBe('/playlist/p1?source=wy');
  });
});

describe('排行榜页', () => {
  it('榜单来自 store，点开带 source=wy', async () => {
    await mount('/charts');
    expect(page()).toContain('飙升榜');
    const tile = byAriaLabel('打开榜单 飙升榜')[0];
    await act(async () => { tile.props.onClick(); });
    expect(location).toBe('/playlist/19723756?source=wy');
  });

  it('榜单接口降级时说明缺了什么，页面仍可用', async () => {
    useDiscoverFeedStore.setState({ fetchedAt: 0 });
    api.boards.mockResolvedValue({ boards: [board('19723756', '飙升榜')], degraded: true });
    await mount('/charts');
    expect(page()).toContain('榜单封面与更新频率暂时取不到');
    expect(page()).toContain('飙升榜');
  });
});

describe('歌单广场', () => {
  it('续页偏移按请求页大小推进，切分类重新从 0 开始', async () => {
    // 每页给不同 id：同一份 mock 连拉两页会让列表里出现重复 key，测试会淹没在
    // React 的重复 key 警告里，也测不出「续页是追加」这件事。
    api.page.mockImplementation(async (cat: string, order: string, limit: number, offset: number) => ({
      playlists: [playlist(`sq-${cat}-${order}-${offset}`, `广场${offset}`)],
      hasMore: true,
    }));
    await mount('/playlist-square');
    expect(api.page).toHaveBeenNthCalledWith(1, '全部', 'hot', 24, 0);

    await click('加载更多');
    expect(api.page).toHaveBeenNthCalledWith(2, '全部', 'hot', 24, 24);

    await click('华语');
    expect(api.page).toHaveBeenNthCalledWith(3, '华语', 'hot', 24, 0);
  });

  it('没有更多时不再请求下一页', async () => {
    api.page.mockResolvedValue({ playlists: [playlist('sq1', '广场一')], hasMore: false });
    await mount('/playlist-square');
    expect(byText('加载更多')).toBeUndefined();
    expect(page()).toContain('没有更多歌单了');
  });
});

describe('发现数据缓存', () => {
  it('TTL 内重复 load 不再请求，force 才重发', async () => {
    await act(async () => { await useDiscoverFeedStore.getState().load(); });
    expect(api.recommended).toHaveBeenCalledTimes(1);
    expect(api.boards).toHaveBeenCalledTimes(1);

    await act(async () => { await useDiscoverFeedStore.getState().load(); });
    expect(api.recommended).toHaveBeenCalledTimes(1);

    await act(async () => { await useDiscoverFeedStore.getState().load({ force: true }); });
    expect(api.recommended).toHaveBeenCalledTimes(2);
  });

  it('推荐歌单失败不影响榜单区块', async () => {
    api.recommended.mockRejectedValue(new Error('推荐接口挂了'));
    await act(async () => { await useDiscoverFeedStore.getState().load(); });
    const state = useDiscoverFeedStore.getState();
    expect(state.recommendedStatus).toBe('error');
    expect(state.recommendedError).toBe('推荐接口挂了');
    expect(state.boardsStatus).toBe('ready');
    expect(state.previewSongs).toHaveLength(2);
  });
});
