import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MusicInfo } from '@lx/core';
import { CloudDriveView } from '../src/views/CloudDriveView';
import { useCloudDriveStore } from '../src/stores/cloudDriveStore';

/**
 * 云盘页的「不要每次都重新拉」契约。
 *
 * 云盘是账号私有资源，一次拉取就是一次 weapi 请求（桌面端 200 条/页）。用户来回切页面时
 * 不该重复付这个代价：同一个账号只要已经加载过，重新进入就必须复用；只有换账号或用户
 * 明确点「刷新」才允许再请求。
 */

const api = vi.hoisted(() => ({
  cloudSongs: vi.fn(),
  account: { current: null as null | { uid: string; nickname: string } },
  loaded: { current: true },
}));

vi.mock('@/services/wyAccountService', () => ({ getCloudSongs: api.cloudSongs }));
vi.mock('@/stores/wyAccountStore', () => ({
  useWyAccountStore: (selector: (state: { account: unknown; isLoaded: boolean }) => unknown) =>
    selector({ account: api.account.current, isLoaded: api.loaded.current }),
}));
vi.mock('@/stores/playerStore', () => ({
  usePlayerStore: (selector: (state: { playQueue: () => Promise<void> }) => unknown) =>
    selector({ playQueue: async () => {} }),
}));
vi.mock('@/components/SongAddMenuButton', () => ({ SongAddMenuButton: () => null }));
vi.mock('@/components/DownloadQualityButton', () => ({ DownloadQualityButton: () => null }));

const song = (id: string): MusicInfo => ({ id, source: 'wy', name: `歌${id}`, singer: '人', interval: 200 } as MusicInfo);

let renderer: ReactTestRenderer | undefined;

async function mount() {
  await act(async () => {
    renderer = create(
      <MemoryRouter initialEntries={['/cloud']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/cloud" element={<CloudDriveView />} />
        </Routes>
      </MemoryRouter>,
    );
  });
}

function unmount() {
  act(() => renderer?.unmount());
  renderer = undefined;
}

function resetStore() {
  useCloudDriveStore.setState({
    songs: [],
    count: 0,
    usedBytes: undefined,
    maxBytes: undefined,
    nextOffset: 0,
    hasMore: false,
    loading: false,
    loadingMore: false,
    error: '',
    accountUid: '',
    loaded: false,
  });
}

function refreshButton() {
  return renderer!.root.findAllByType('button').find((node) => node.props.title === '重新读取云盘列表');
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
  api.account.current = { uid: 'uid-A', nickname: 'A' };
  api.loaded.current = true;
  api.cloudSongs.mockResolvedValue({
    songs: [song('1'), song('2')],
    count: 2,
    usedBytes: 1024,
    maxBytes: 2048,
    nextOffset: 200,
    hasMore: false,
  });
});
afterEach(() => unmount());

describe('云盘列表复用', () => {
  it('离开再回到云盘页复用已加载的列表，不重复请求', async () => {
    await mount();
    expect(api.cloudSongs).toHaveBeenCalledTimes(1);
    unmount();

    await mount();
    expect(api.cloudSongs).toHaveBeenCalledTimes(1);
    expect(useCloudDriveStore.getState().songs).toHaveLength(2);
  });

  it('只有「刷新」才强制重拉', async () => {
    await mount();
    expect(api.cloudSongs).toHaveBeenCalledTimes(1);
    await act(async () => { refreshButton()!.props.onClick(); });
    expect(api.cloudSongs).toHaveBeenCalledTimes(2);
  });

  it('换账号时丢弃旧列表并重新拉取', async () => {
    await mount();
    expect(useCloudDriveStore.getState().accountUid).toBe('uid-A');
    unmount();

    api.account.current = { uid: 'uid-B', nickname: 'B' };
    await mount();
    expect(api.cloudSongs).toHaveBeenCalledTimes(2);
    expect(useCloudDriveStore.getState().accountUid).toBe('uid-B');
  });

  it('上一账号的晚到响应不能写进新账号的列表', async () => {
    let resolveA!: (value: unknown) => void;
    api.cloudSongs.mockReturnValueOnce(new Promise((resolve) => { resolveA = resolve; }));
    await mount();
    unmount();

    api.account.current = { uid: 'uid-B', nickname: 'B' };
    api.cloudSongs.mockResolvedValue({
      songs: [song('B1')], count: 1, usedBytes: 1, maxBytes: 2, nextOffset: 200, hasMore: false,
    });
    await mount();
    await act(async () => {
      resolveA({ songs: [song('A1')], count: 1, usedBytes: 1, maxBytes: 2, nextOffset: 200, hasMore: false });
    });
    expect(useCloudDriveStore.getState().songs.map((item) => item.id)).toEqual(['B1']);
  });
});
