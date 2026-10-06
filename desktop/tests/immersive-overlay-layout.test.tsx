import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const deps = vi.hoisted(() => ({
  player: {} as any,
  interpolatedProgress: 25,
  loadSettings: vi.fn(), patchSettings: vi.fn(), broadcast: vi.fn(), subscribe: vi.fn(),
  getCurrentWindow: vi.fn(), toggleDesktop: vi.fn(), copy: vi.fn(),
}));
vi.mock('@/stores/playerStore', () => ({ usePlayerStore: Object.assign(() => deps.player, { getState: () => deps.player }) }));
vi.mock('@lx/tauri-bridge', () => ({
  loadSettings: deps.loadSettings, patchSettings: deps.patchSettings,
  isLyricWindowOpen: async () => false, getLyricWindowState: async () => ({ locked: false }),
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }));
vi.mock('@/stores/lyricSettingsSync', () => ({ broadcastLyricSettings: deps.broadcast, subscribeLyricSettings: deps.subscribe }));
vi.mock('@/hooks/useLyrics', () => ({ useLyrics: () => ({ lyrics: [], currentLine: 0 }) }));
vi.mock('@/hooks/useInterpolatedPlaybackProgress', () => ({ useInterpolatedPlaybackProgress: () => deps.interpolatedProgress }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: deps.getCurrentWindow }));
vi.mock('@/utils/desktopLyricToggle', () => ({ toggleDesktopLyricFromPlayer: deps.toggleDesktop }));
vi.mock('@/components/playerVisualizers/PlayerVisualizerRenderer', () => ({ PlayerVisualizerRenderer: (props: any) => <div data-testid="lyrics" {...props} /> }));
vi.mock('@/components/SongAddMenuButton', () => ({ SongAddMenuButton: () => <button aria-label="添加到我的喜欢或歌单" /> }));
// 真正的DOM焦点循环由 frontend-immersive-focus.test.tsx 验证。
vi.mock('@/hooks/useDialogFocus', () => ({ useDialogFocus: vi.fn() }));
import { ImmersiveLyricsOverlay } from '../src/components/ImmersiveLyricsOverlay';

let renderer: ReactTestRenderer;
let keydown: Array<(event: any) => void>;
let onClose: ReturnType<typeof vi.fn>;
class ElementTarget {
  isContentEditable = false;
  constructor(readonly tagName = 'BUTTON') {}
  closest(selector: string) { return selector.includes('button') && this.tagName === 'BUTTON' ? this : null; }
}
class InputTarget extends ElementTarget {}
const key = (value: string, target: any = null) => {
  const event = { key: value, target, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation: vi.fn() };
  act(() => keydown.forEach(handler => handler(event)));
  return event;
};
const button = (label: string) => renderer.root.findByProps({ 'aria-label': label });
const click = (label: string) => act(() => button(label).props.onClick());
beforeEach(() => {
  vi.resetAllMocks();
  deps.interpolatedProgress = 25;
  deps.getCurrentWindow.mockReturnValue({
    isFullscreen: async () => false,
    onResized: async () => () => {},
    onFocusChanged: async () => () => {},
    setFullscreen: vi.fn(),
  });
  deps.player = {
    current: { id: '1', source: 'wy', name: 'Song', singer: 'Singer', albumName: 'Album' },
    queue: [{ id: '1', source: 'wy', name: 'Song', singer: 'Singer' }], currentIndex: 0,
    status: 'playing', progress: 20, duration: 120, volume: 0.6, isMuted: false, playbackRate: 1, repeatMode: 'all', isShuffle: false,
    togglePlay: vi.fn(), toggleMute: vi.fn(), setVolume: vi.fn(), setProgress: vi.fn(), setPlaybackRate: vi.fn(), setPlayMode: vi.fn(),
    playByIndex: vi.fn(), prev: vi.fn(), next: vi.fn(), removeFromQueue: vi.fn(),
  };
  deps.loadSettings.mockResolvedValue({ lyricShowTranslation: true, lyricShowRomanization: true, lyricShowRuby: true });
  deps.patchSettings.mockResolvedValue({}); deps.subscribe.mockReturnValue(() => {});
  deps.toggleDesktop.mockResolvedValue({ open: true, locked: false });
  keydown = []; onClose = vi.fn();
  vi.stubGlobal('HTMLElement', ElementTarget); vi.stubGlobal('HTMLInputElement', InputTarget);
  vi.stubGlobal('HTMLTextAreaElement', class {}); vi.stubGlobal('HTMLSelectElement', class {});
  vi.stubGlobal('document', { body: { style: { overflow: '' } }, querySelector: () => null });
  vi.stubGlobal('navigator', { clipboard: { writeText: deps.copy } });
  vi.stubGlobal('window', {
    addEventListener: (name: string, handler: any) => { if (name === 'keydown') keydown.push(handler); },
    removeEventListener: (name: string, handler: any) => { if (name === 'keydown') keydown = keydown.filter(item => item !== handler); },
    requestAnimationFrame: (callback: any) => { callback(); return 1; }, cancelAnimationFrame: vi.fn(), setTimeout: vi.fn(),
  });
});
afterEach(() => { act(() => renderer?.unmount()); vi.unstubAllGlobals(); });
async function mount() { await act(async () => { renderer = create(<ImmersiveLyricsOverlay open onClose={onClose} />); }); }

it('不渲染顶部退出和全屏入口，封面信息与底栏三列保持不变', async () => {
  await mount();
  expect(renderer.root.findAllByType('header')).toHaveLength(0);
  for (const label of ['进入全屏', '退出全屏', '退出沉浸式播放']) {
    expect(renderer.root.findAllByProps({ 'aria-label': label })).toHaveLength(0);
  }
  const cover = renderer.root.findByProps({ className: 'af-immersive-cover-section' });
  expect(cover.findByType('h1').children).toContain('Song');
  expect(JSON.stringify(cover.findByProps({ className: 'af-immersive-heading' }).children.map(child => typeof child === 'string' ? child : child.children))).toContain('Album');
  expect(renderer.root.findByProps({ className: 'af-immersive-control-row' }).children).toHaveLength(3);
});

it('原有 roma/ruby/translation 传给可视化器且快速设置持久化后广播', async () => {
  await mount();
  expect(renderer.root.findByProps({ 'data-testid': 'lyrics' }).props).toMatchObject({ showTranslation: true, showRomanization: true, showRuby: true });
  click('歌词工具');
  await act(async () => button('罗马音').props.onClick());
  expect(deps.patchSettings).toHaveBeenCalledWith({ lyricShowRomanization: false });
  expect(deps.broadcast).toHaveBeenCalledWith({ lyricShowRomanization: false });
  expect(renderer.root.findByProps({ 'data-testid': 'lyrics' }).props.showRomanization).toBe(false);
});

it('歌词设置保存失败保留原状态并显示失败信息，不广播成功', async () => {
  await mount(); deps.patchSettings.mockRejectedValueOnce(new Error('disk unavailable'));
  click('歌词工具');
  await act(async () => button('注音').props.onClick());
  expect(renderer.root.findByProps({ 'data-testid': 'lyrics' }).props.showRuby).toBe(true);
  expect(deps.broadcast).not.toHaveBeenCalled();
  expect(renderer.root.findAllByProps({ role: 'alert' }).some(node => JSON.stringify(node.children).includes('disk unavailable'))).toBe(true);
});

it('range 左右键与按钮空格不被全局播放快捷键抢走', async () => {
  await mount();
  key('ArrowRight', new InputTarget('INPUT'));
  key(' ', new ElementTarget('BUTTON'));
  expect(deps.player.setProgress).not.toHaveBeenCalled();
  expect(deps.player.togglePlay).not.toHaveBeenCalled();
  key('ArrowRight'); expect(deps.player.setProgress).toHaveBeenCalledWith(25);
});

it('已经处理的 Escape 不关闭 overlay，未处理的 Escape 关闭', async () => {
  await mount();
  act(() => keydown.forEach(handler => handler({ key: 'Escape', defaultPrevented: true, preventDefault: vi.fn() })));
  expect(onClose).not.toHaveBeenCalled();
  key('Escape'); expect(onClose).toHaveBeenCalledOnce();
});

it.each(['onPointerUp', 'onPointerCancel', 'onBlur'])('进度拖动经 %s 结束后恢复实时进度', async (end) => {
  await mount();
  const progress = () => button('播放进度');
  act(() => progress().props.onPointerDown());
  act(() => progress().props.onChange({ target: { value: '50' } }));
  expect(progress().props.value).toBe(50);
  expect(deps.player.setProgress).toHaveBeenCalledWith(50);
  act(() => progress().props[end]());
  expect(progress().props.value).toBe(25);
});

it('全局 Escape 先关闭菜单并归还触发焦点，第二次才关闭 overlay', async () => {
  const focus = vi.fn();
  await act(async () => {
    renderer = create(<ImmersiveLyricsOverlay open onClose={onClose} />, {
      createNodeMock: () => ({ focus, scrollIntoView: vi.fn() }),
    });
  });
  click('更多');
  expect(renderer.root.findByProps({ 'aria-label': '沉浸式歌词' }).props['data-panel-open']).toBe(true);
  key('Escape');
  expect(onClose).not.toHaveBeenCalled();
  expect(focus).toHaveBeenCalledOnce();
  expect(renderer.root.findByProps({ 'aria-label': '沉浸式歌词' }).props['data-panel-open']).toBe(false);
  key('Escape'); expect(onClose).toHaveBeenCalledOnce();
});

it('收藏歌单 portal 打开时 Escape 留给自身的全局监听，不误关更多与 overlay', async () => {
  await mount(); click('更多');
  document.querySelector = vi.fn().mockReturnValue({});
  expect(key('Escape').defaultPrevented).toBe(true);
  expect(onClose).not.toHaveBeenCalled();
  expect(renderer.root.findByType('footer').props['data-panel-open']).toBe(true);
});

it.each([
  ['译文', 'lyricShowTranslation', 'showTranslation'],
  ['罗马音', 'lyricShowRomanization', 'showRomanization'],
  ['注音', 'lyricShowRuby', 'showRuby'],
])('%s 快速开关保存成功后才改变歌词，且可接收跨窗更新', async (label, setting, prop) => {
  await mount(); click('歌词工具');
  let resolve!: () => void;
  deps.patchSettings.mockImplementationOnce(() => new Promise<void>(done => { resolve = done; }));
  act(() => { button(label).props.onClick(); });
  expect(renderer.root.findByProps({ 'data-testid': 'lyrics' }).props[prop]).toBe(true);
  expect(button(label).props.disabled).toBe(true);
  await act(async () => resolve());
  expect(deps.broadcast).toHaveBeenCalledWith({ [setting]: false });
  expect(renderer.root.findByProps({ 'data-testid': 'lyrics' }).props[prop]).toBe(false);
  act(() => deps.subscribe.mock.calls[0][0]({ [setting]: true }));
  expect(renderer.root.findByProps({ 'data-testid': 'lyrics' }).props[prop]).toBe(true);
});

it('桌面歌词错误保留可见反馈，分享保留状态反馈', async () => {
  await mount();
  deps.toggleDesktop.mockRejectedValueOnce(new Error('desktop denied'));
  await act(async () => button('打开桌面歌词').props.onClick());
  expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toContain('desktop denied');
  click('更多'); deps.copy.mockRejectedValueOnce(new Error('clipboard denied'));
  await act(async () => button('复制歌曲链接').props.onClick());
  expect(renderer.root.findByProps({ role: 'status' }).children).toContain('复制失败');
});
it('更多面板分享关闭只执行一次焦点恢复', async () => {
  const focus = vi.fn();
  await act(async () => {
    renderer = create(<ImmersiveLyricsOverlay open onClose={onClose} />, { createNodeMock: () => ({ focus }) });
  });
  click('更多');
  await act(async () => button('复制歌曲链接').props.onClick());
  expect(focus).toHaveBeenCalledOnce();
});

it('键盘调整进度后保留焦点时，显示进度继续跟随播放而不是停留在seek值', async () => {
  await mount();
  act(() => button('播放进度').props.onChange({ target: { value: '40' } }));
  expect(deps.player.setProgress).toHaveBeenCalledWith(40);
  deps.interpolatedProgress = 42;
  act(() => renderer.update(<ImmersiveLyricsOverlay open onClose={onClose} />));
  expect(button('播放进度').props.value).toBe(42);
});
it('歌词手动偏移同时传给高亮时间，播放进度保持真实音频时间', async () => {
  deps.loadSettings.mockResolvedValue({ lyricManualOffsetMs: 2000, lyricShowTranslation: true });
  await mount();
  expect(renderer.root.findByProps({ 'data-testid': 'lyrics' }).props.currentTime).toBe(27);
  expect(button('播放进度').props.value).toBe(25);
  act(() => deps.subscribe.mock.calls[0][0]({ lyricManualOffsetMs: -1500 }));
  expect(renderer.root.findByProps({ 'data-testid': 'lyrics' }).props.currentTime).toBe(23.5);
  expect(button('播放进度').props.value).toBe(25);
});


it('更多菜单提供唯一退出入口并关闭沉浸页一次', async () => {
  await mount();
  click('更多');
  const panel = renderer.root.findByProps({ 'aria-label': '更多播放操作' });
  expect(panel.findAllByProps({ 'aria-label': '退出沉浸式播放' })).toHaveLength(1);
  click('退出沉浸式播放');
  expect(onClose).toHaveBeenCalledOnce();
  expect(renderer.root.findByType('footer').props['data-panel-open']).toBe(false);
});


it('打开和关闭沉浸页不再访问原生窗口全屏接口', async () => {
  await mount();
  act(() => renderer.update(<ImmersiveLyricsOverlay open={false} onClose={onClose} />));
  expect(deps.getCurrentWindow).not.toHaveBeenCalled();
});
