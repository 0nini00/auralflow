import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ emit: vi.fn(), listeners: [] as ((event: any) => void)[], next: vi.fn(), prev: vi.fn(), pause: vi.fn(), resume: vi.fn(), play: vi.fn(), setState: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ emit: mocks.emit, listen: async (_name: string, callback: any) => { mocks.listeners.push(callback); return () => {}; } }));
vi.mock('../src/stores/playerStore', () => ({ usePlayerStore: { getState: () => mocks, setState: mocks.setState, subscribe: () => () => {} } }));
vi.mock('../src/services/playback/playbackSnapshot', () => ({ getPlaybackSnapshotFromStore: () => ({ current: { id: 'one' }, status: 'playing', progress: 1 }), applyPlaybackSnapshotToStorePatch: (value: unknown) => value }));
class Channel {
  static channels: Channel[] = [];
  listeners: ((event: any) => void)[] = [];
  postMessage = vi.fn((message: any) => { this.listeners.forEach(callback => callback({ data: message })); });
  constructor() { Channel.channels.push(this); }
  addEventListener(_name: string, callback: any) { this.listeners.push(callback); }
}
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); mocks.listeners.length = 0; Channel.channels.length = 0;
  mocks.next.mockResolvedValue(undefined); mocks.prev.mockResolvedValue(undefined);
  mocks.emit.mockImplementation(async (_name, message) => { mocks.listeners.forEach(callback => callback({ payload: message })); });
  vi.stubGlobal('BroadcastChannel', Channel);
});
afterEach(() => vi.unstubAllGlobals());
it.each(['next', 'prev', 'play-pause'] as const)('双通道可达时一次%s只执行一次', async action => {
  const { setupPlayerSync, dispatchLyricAction } = await import('../src/stores/playerSync');
  setupPlayerSync('main');
  dispatchLyricAction(action);
  await Promise.resolve();
  expect(action === 'next' ? mocks.next : action === 'prev' ? mocks.prev : mocks.pause).toHaveBeenCalledTimes(1);
});
it('没有BroadcastChannel仍可用Tauri执行歌词动作', async () => {
  vi.stubGlobal('BroadcastChannel', undefined);
  const { setupPlayerSync, dispatchLyricAction } = await import('../src/stores/playerSync');
  setupPlayerSync('main'); dispatchLyricAction('next'); await Promise.resolve();
  expect(mocks.next).toHaveBeenCalledTimes(1);
});
