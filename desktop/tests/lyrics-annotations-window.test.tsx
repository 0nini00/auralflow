import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { parseLyricSource } from '@lx/core';
const deps = vi.hoisted(() => ({ lyrics: [] as any[] }));
vi.mock('@lx/tauri-bridge', async (importOriginal) => ({ TAURI_EVENTS: (await importOriginal<typeof import('@lx/tauri-bridge')>()).TAURI_EVENTS, listenTauriEvent: async () => () => {}, getLyricWindowState: async () => ({ locked: false }), patchSettings: vi.fn(), prepareLyricWindowLock: vi.fn(), setLyricWindowPinned: vi.fn(), setLyricWindowLocked: vi.fn(), toggleLyricWindow: vi.fn() }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ show: async () => {}, hide: async () => {} }) }));
vi.mock('@/stores/playbackMirrorStore', () => ({ usePlaybackMirrorStore: (select: any) => select({ current: { id: 'one', source: 'local' }, status: 'playing', progress: 1.5, duration: 10, playbackRate: 1 }) }));
vi.mock('@/stores/playerSync', () => ({ dispatchLyricAction: vi.fn(), setupSecondaryPlayerSync: vi.fn() }));
vi.mock('@/hooks/useLyrics', () => ({ useLyrics: () => ({ lyrics: deps.lyrics, currentLine: 0 }) }));
vi.mock('@/hooks/useInterpolatedPlaybackProgress', () => ({ useInterpolatedPlaybackProgress: () => 1.5 }));
import { LyricWindowView } from '../src/views/LyricWindowView';
import { __resetSettingsStoreForTests, useSettingsStore, type AppSettings } from '../src/stores/settingsStore';
import { seedSettings } from './helpers/settingsFixture';
let renderer: ReactTestRenderer;
const loaded = { lyricShowRomanization: true, lyricShowRuby: true, lyricShowTranslation: true, lyricShowNextLine: true, lyricMaxLineNum: 2 };
/** 模拟别的窗口改了设置：本窗口的 store 在 settings-changed 之后刷新。 */
const patch = (value: Partial<AppSettings>) => seedSettings({ ...useSettingsStore.getState().settings, ...value });
beforeEach(() => {
  vi.resetAllMocks();
  seedSettings(loaded);
});
afterEach(() => act(() => renderer?.unmount()));
for (const content of ['[00:01]<ruby>日<rt>ひ</rt></ruby>', '[00:01]<00:01><ruby>日<rt>ひ</rt></ruby><00:02>へ']) {
  it(`桌面纯行/逐字歌词按设置显示读音，并跟随设置刷新 ${content}`, async () => {
    deps.lyrics = parseLyricSource({ content });
    deps.lyrics[0].roma = 'hi'; deps.lyrics[0].tr = '太阳';
    deps.lyrics.push({ time: 3, text: '月', roma: 'tsuki', ruby: [{ text: '月', reading: 'つき' }] });
    await act(async () => { renderer = create(<LyricWindowView />); });
    expect(renderer.root.findAllByType('ruby').length).toBeGreaterThanOrEqual(2);
    expect(renderer.root.findAllByProps({ className: 'af-lyric-romanization' })).toHaveLength(2);
    expect(renderer.root.findAllByProps({ className: 'af-lyric-line-translation' })[0].children).toContain('太阳');
    act(() => patch({ lyricShowRuby: false }));
    expect(renderer.root.findAllByType('ruby')).toHaveLength(0);
    expect(renderer.root.findAllByProps({ className: 'af-lyric-romanization' })).toHaveLength(2);
    act(() => patch({ lyricShowRomanization: false }));
    expect(renderer.root.findAllByProps({ className: 'af-lyric-romanization' })).toHaveLength(0);
  });
}
it('设置没读到时不拿默认样式渲染歌词；读取失败把原因显示出来', async () => {
  __resetSettingsStoreForTests();
  await act(async () => { renderer = create(<LyricWindowView />); });
  expect(renderer.toJSON()).toBeNull();
  act(() => useSettingsStore.setState({ loadError: '解析配置文件失败' }));
  expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toBe('读取设置失败：解析配置文件失败');
  act(() => seedSettings(loaded));
  expect(renderer.root.findAllByProps({ className: 'af-lyric-scroll' })).toHaveLength(1);
});
