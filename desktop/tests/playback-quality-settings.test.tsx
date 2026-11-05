import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
const deps = vi.hoisted(() => ({ patch: vi.fn(async () => ({})), clear: vi.fn() }));
vi.mock('@lx/tauri-bridge', () => ({ loadSettings: vi.fn(async () => ({ defaultQuality: '320k' })), patchSettings: deps.patch }));
vi.mock('@/stores/themeStore', () => ({ useThemeStore: Object.assign(() => ({ accentColor: '#ffffff', previewAccentColor: vi.fn() }), { getState: () => ({ accentColor: '#ffffff' }) }) }));
vi.mock('@/stores/historyStore', () => ({ useHistoryStore: { getState: vi.fn() } }));
vi.mock('@/stores/customSourceStore', () => ({ useCustomSourceStore: () => [] }));
vi.mock('@/stores/lyricSettingsSync', () => ({ broadcastLyricSettings: vi.fn() }));
vi.mock('@/services/playerEngine', () => ({ playerEngine: {} }));
vi.mock('@/services/persistentCache', () => ({}));
vi.mock('@/services/lyricsService', () => ({}));
vi.mock('@/stores/playerStore', () => ({ setPlaybackFailedAutoNext: vi.fn() }));
vi.mock('@/services/playback/prefetchService', () => ({ clearPlaybackPrefetchCache: deps.clear }));
vi.mock('@/services/appBackground', () => ({ toAppBackgroundImageUrl: () => '' }));
import { useSettingsViewModel } from '../src/views/useSettingsViewModel';
let renderer: ReactTestRenderer | undefined;
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; });

it('默认音质成功保存后立即清理旧音质预取结果', async () => {
  let model!: ReturnType<typeof useSettingsViewModel>;
  function Harness() { model = useSettingsViewModel(); return null; }
  await act(async () => { renderer = create(<Harness />); });
  await act(async () => { await model.handleDefaultQualityChange('flac'); });
  expect(deps.patch).toHaveBeenCalledWith({ defaultQuality: 'flac' });
  expect(deps.clear).toHaveBeenCalledTimes(1);
});
