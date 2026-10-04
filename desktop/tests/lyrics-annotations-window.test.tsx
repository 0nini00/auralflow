import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { parseLyricSource } from '@lx/core';
const deps = vi.hoisted(() => ({ loadSettings: vi.fn(), subscribe: vi.fn(), lyrics: [] as any[] }));
vi.mock('@lx/tauri-bridge', () => ({ loadSettings: deps.loadSettings, getLyricWindowState: async () => ({ locked: false }), patchSettings: vi.fn(), prepareLyricWindowLock: vi.fn(), setLyricWindowPinned: vi.fn(), setLyricWindowLocked: vi.fn(), toggleLyricWindow: vi.fn() }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ show: async () => {}, hide: async () => {} }) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }));
vi.mock('@/stores/playerStore', () => ({ usePlayerStore: (select: any) => select({ current: { id: 'one', source: 'local' }, status: 'playing', progress: 1.5, duration: 10, playbackRate: 1 }) }));
vi.mock('@/stores/playerSync', () => ({ dispatchLyricAction: vi.fn() }));
vi.mock('@/stores/lyricSettingsSync', () => ({ subscribeLyricSettings: deps.subscribe, broadcastLyricSettings: vi.fn() }));
vi.mock('@/hooks/useLyrics', () => ({ useLyrics: () => ({ lyrics: deps.lyrics, currentLine: 0 }) }));
vi.mock('@/hooks/useInterpolatedPlaybackProgress', () => ({ useInterpolatedPlaybackProgress: () => 1.5 }));
import { LyricWindowView } from '../src/views/LyricWindowView';
let renderer: ReactTestRenderer;
let patch: (value: object) => void;
beforeEach(() => {
  vi.resetAllMocks();
  deps.loadSettings.mockResolvedValue({ lyricShowRomanization: true, lyricShowRuby: true, lyricShowTranslation: true, lyricShowNextLine: true, lyricMaxLineNum: 2 });
  deps.subscribe.mockImplementation(handler => { patch = handler; return () => {}; });
});
afterEach(() => act(() => renderer?.unmount()));
for (const content of ['[00:01]<ruby>日<rt>ひ</rt></ruby>', '[00:01]<00:01><ruby>日<rt>ひ</rt></ruby><00:02>へ']) {
  it(`桌面纯行/逐字歌词接收持久化开关及跨窗更新 ${content}`, async () => {
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
