import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const tauri = vi.hoisted(() => ({ emit: vi.fn(async () => undefined), listeners: [] as ((event: { payload: unknown }) => void)[] }));
vi.mock('@tauri-apps/api/event', () => ({
  emit: tauri.emit,
  listen: async (_name: string, callback: (event: { payload: unknown }) => void) => { tauri.listeners.push(callback); return () => {}; },
}));

const snapshot = (id: string, updatedAt: number) => ({
  current: { id, source: 'wy', name: id }, status: 'playing', progress: 12, progressSampledAt: 1000, duration: 200, playbackRate: 1.25,
  volume: 0.5, isMuted: false, updatedAt,
});

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); tauri.listeners.length = 0;
  vi.stubGlobal('BroadcastChannel', undefined);
});
afterEach(() => vi.unstubAllGlobals());

async function setup() {
  const { setupSecondaryPlayerSync } = await import('../src/stores/playerSync');
  const { usePlaybackMirrorStore } = await import('../src/stores/playbackMirrorStore');
  setupSecondaryPlayerSync();
  await Promise.resolve();
  const receive = (payload: unknown) => tauri.listeners.forEach((listener) => listener({ payload }));
  return { usePlaybackMirrorStore, receive, setupSecondaryPlayerSync };
}

it('副窗口启动时向主窗口要一次状态，重复调用不重复订阅', async () => {
  const { setupSecondaryPlayerSync } = await setup();
  setupSecondaryPlayerSync();
  expect(tauri.emit.mock.calls.map(([, message]) => message)).toEqual([{ type: 'request-state' }]);
  expect(tauri.listeners).toHaveLength(1);
});

it('主窗口的快照写进镜像，只留副窗口界面用到的字段', async () => {
  const { usePlaybackMirrorStore, receive } = await setup();
  receive({ type: 'state', snapshot: snapshot('one', 10) });
  expect(usePlaybackMirrorStore.getState()).toEqual({
    current: { id: 'one', source: 'wy', name: 'one' }, status: 'playing', progress: 12, progressSampledAt: 1000, duration: 200, playbackRate: 1.25,
  });
});

it('晚到的旧快照不会把新状态写回去', async () => {
  const { usePlaybackMirrorStore, receive } = await setup();
  receive({ type: 'state', snapshot: snapshot('new', 20) });
  receive({ type: 'state', snapshot: snapshot('old', 10) });
  expect(usePlaybackMirrorStore.getState().current?.id).toBe('new');
});

it('别的窗口发的动作与握手不影响镜像', async () => {
  const { usePlaybackMirrorStore, receive } = await setup();
  const before = usePlaybackMirrorStore.getState();
  receive({ type: 'action', action: 'next' });
  receive({ type: 'request-state' });
  expect(usePlaybackMirrorStore.getState()).toBe(before);
});
