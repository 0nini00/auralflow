import { beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ recommended: vi.fn(), boards: vi.fn(), preview: vi.fn() }));
vi.mock('@/services/wyDiscoverService', () => ({ fetchWyRecommendedPlaylists: vi.fn(), fetchWyLeaderboardBoards: api.boards }));
vi.mock('@/services/wyAccountService', () => ({ getPersonalizedPlaylists: api.recommended }));
vi.mock('@lx/tauri-bridge', () => ({ debugLog: vi.fn() }));
vi.mock('@/services/sources/sourceService', () => ({ getSource: () => ({ getPlaylistDetail: api.preview }) }));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => { vi.resetModules(); vi.resetAllMocks(); });
it('榜单返回即启动试读，推荐慢请求不阻塞榜单展示', async () => {
  const slow = deferred<unknown[]>(); api.recommended.mockReturnValue(slow.promise);
  api.boards.mockResolvedValue({ boards: [{ id: 'board', name: 'Board', group: 'official' }], degraded: false });
  api.preview.mockResolvedValue([{ id: 'song' }]);
  const { useDiscoverFeedStore } = await import('../src/stores/discoverFeedStore');
  const loading = useDiscoverFeedStore.getState().load();
  try {
    await new Promise(setImmediate);
    expect(useDiscoverFeedStore.getState().boardsStatus).toBe('ready');
    expect(useDiscoverFeedStore.getState().previewStatus).toBe('ready');
    expect(api.preview.mock.calls.length).toBe(1);
    expect(useDiscoverFeedStore.getState().recommendedStatus).toBe('loading');
  } finally { slow.resolve([{ id: 'playlist' }]); await loading; }
});
it('推荐先返回即显示，榜单失败独立呈现且刷新可重试', async () => {
  const slow = deferred<unknown>(); api.boards.mockReturnValue(slow.promise);
  api.recommended.mockResolvedValue([{ id: 'playlist', name: 'Playlist' }]);
  const { useDiscoverFeedStore } = await import('../src/stores/discoverFeedStore');
  const loading = useDiscoverFeedStore.getState().load();
  try {
    await new Promise(setImmediate);
    expect(useDiscoverFeedStore.getState().recommendedStatus).toBe('ready');
  } finally { slow.resolve({ boards: [], degraded: false }); await loading; }
  api.boards.mockRejectedValue(new Error('boards offline'));
  await useDiscoverFeedStore.getState().load({ force: true });
  expect(useDiscoverFeedStore.getState().boardsError).toBe('boards offline');
  expect(useDiscoverFeedStore.getState().recommendedStatus).toBe('ready');
});
