import { createRef } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ImmersivePlayerControls, type ImmersivePlayerControlsHandle, type ImmersivePlayerControlsProps } from '../src/components/ImmersivePlayerControls';

let renderer: ReactTestRenderer;
let props: ImmersivePlayerControlsProps;
let focus: Map<string, ReturnType<typeof vi.fn>>;
const ref = createRef<ImmersivePlayerControlsHandle>();
const button = (label: string) => renderer.root.findByProps({ 'aria-label': label });
const click = (label: string) => act(() => button(label).props.onClick());
const panels = () => renderer.root.findAll(node => typeof node.type === 'string' && node.props.className?.includes('af-immersive-popover '));
beforeEach(() => {
  focus = new Map();
  vi.stubGlobal('document', { querySelector: () => null });
  vi.stubGlobal('window', { requestAnimationFrame: (fn: () => void) => { fn(); return 1; }, cancelAnimationFrame: vi.fn() });
  props = {
    playback: { isPlaying: true, volume: 0.5, isMuted: false, playbackRate: 1, mode: { id: 'sequence', label: '顺序播放' } },
    actions: { togglePlay: vi.fn(), toggleMute: vi.fn(), setVolume: vi.fn(), prev: vi.fn(), next: vi.fn(), cycleMode: vi.fn(), setPlaybackRate: vi.fn(), share: vi.fn(), exitImmersive: vi.fn() },
    timeline: { current: 25, duration: 120, onSeek: vi.fn(), onSeekStart: vi.fn(), onSeekEnd: vi.fn() },
    lyrics: { showTranslation: true, showRomanization: true, showRuby: true, pending: false, onToggle: vi.fn() },
    queue: { tracks: [{ source: 'wy', id: 'one', name: 'One', singer: 'Singer' }], currentIndex: 0, play: vi.fn(), remove: vi.fn() },
    desktopLyrics: { open: false, label: '打开桌面歌词', toggle: vi.fn() },
    onPanelOpenChange: vi.fn(),
    children: <button aria-label="收藏歌单插槽" />,
  };
  act(() => { renderer = create(<ImmersivePlayerControls {...props} ref={ref} />, { createNodeMock: element => {
    const label = element.props['aria-label'];
    const fn = focus.get(label) ?? vi.fn(); if (label) focus.set(label, fn);
    return { focus: fn, scrollIntoView: vi.fn() };
  } }); });
});
afterEach(() => { act(() => renderer.unmount()); vi.unstubAllGlobals(); });

it('默认三列且更多收纳收藏、倍速、分享，中心只有音量与 transport', () => {
  expect(renderer.root.findByProps({ className: 'af-immersive-control-row' }).children).toHaveLength(3);
  expect(renderer.root.findAllByProps({ 'aria-label': '复制歌曲链接' })).toHaveLength(0);
  click('更多');
  expect(button('收藏歌单插槽')).toBeDefined();
  expect(button('播放速度')).toBeDefined();
  click('复制歌曲链接'); expect(props.actions.share).toHaveBeenCalledOnce();
});

it('菜单互斥，打开时通知根节点，Escape 关闭归还焦点后才允许关闭 overlay', () => {
  click('更多'); expect(panels()).toHaveLength(1);
  click('歌词工具'); expect(panels()).toHaveLength(1);
  expect(renderer.root.findAllByProps({ 'aria-label': '复制歌曲链接' })).toHaveLength(0);
  expect(renderer.root.findByType('footer').props['data-panel-open']).toBe(true);
  let consumed = false;
  act(() => { consumed = ref.current!.dismissPanel(); });
  expect(consumed).toBe(true);
  expect(focus.get('歌词工具')).toHaveBeenCalledOnce();
  expect(renderer.root.findByType('footer').props['data-panel-open']).toBe(false);
  expect(ref.current!.dismissPanel()).toBe(false);
});

it('队列播放与移除是兄弟原生按钮，没有嵌套交互容器', () => {
  click('播放列表');
  const remove = button('从播放列表移除 One');
  expect(remove.parent?.props.role).not.toBe('button');
  expect(remove.parent?.type).not.toBe('button');
  expect(remove.parent?.props.onKeyDown).toBeUndefined();
  click('从播放列表移除 One');
  expect(props.queue.remove).toHaveBeenCalledWith(0);
  expect(props.queue.play).not.toHaveBeenCalled();
  click('播放 One'); expect(props.queue.play).toHaveBeenCalledWith(0);
});

it('进度和音量保留原生 range，取消/失焦都结束拖动', () => {
  const progress = button('播放进度');
  expect(progress.props.type).toBe('range');
  act(() => progress.props.onPointerDown());
  act(() => progress.props.onChange({ target: { value: '42' } }));
  act(() => progress.props.onPointerCancel());
  act(() => progress.props.onBlur());
  expect(props.timeline.onSeek).toHaveBeenCalledWith(42);
  expect(props.timeline.onSeekStart).toHaveBeenCalledOnce();
  expect(props.timeline.onSeekEnd).toHaveBeenCalledTimes(2);
  act(() => button('音量').props.onChange({ target: { value: '0.3' } }));
  expect(props.actions.setVolume).toHaveBeenCalledWith(0.3);
});

it('footer Escape 捕获只消费菜单关闭，背景点击同样关闭', () => {
  click('更多');
  const event = { key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn() };
  act(() => renderer.root.findByType('footer').props.onKeyDownCapture(event));
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(event.stopPropagation).toHaveBeenCalledOnce();
  expect(focus.get('更多')).toHaveBeenCalledOnce();
  click('歌词工具');
  act(() => renderer.root.findByProps({ className: 'af-immersive-popover-backdrop' }).props.onClick());
  expect(panels()).toHaveLength(0);
});

it('全部基础播放动作与倍速由 props 派发，歌词设置等待时不可重复操作', () => {
  click('暂停'); click('上一首'); click('下一首'); click('静音'); click('播放模式：顺序播放');
  for (const action of ['togglePlay', 'prev', 'next', 'toggleMute', 'cycleMode'] as const) {
    expect(props.actions[action]).toHaveBeenCalledOnce();
  }
  click('更多');
  act(() => button('播放速度').props.onChange({ target: { value: '1.5' } }));
  expect(props.actions.setPlaybackRate).toHaveBeenCalledWith(1.5);
  click('歌词工具');
  click('译文'); expect(props.lyrics.onToggle).toHaveBeenCalledWith('translation');
  act(() => renderer.update(<ImmersivePlayerControls {...props} lyrics={{ ...props.lyrics, pending: true }} ref={ref} />));
  expect(button('译文').props.disabled).toBe(true);
  expect(button('罗马音').props.disabled).toBe(true);
  expect(button('注音').props.disabled).toBe(true);
});
it('更多操作是四条一致的菜单行，包含退出沉浸式播放', () => {
  click('更多');
  const grid = renderer.root.findByProps({ className: 'af-immersive-more-grid' });
  expect(grid.children).toHaveLength(4);
  expect(grid.findAllByProps({ className: 'af-immersive-add-action' })).toHaveLength(0);
  const select = button('播放速度');
  expect(select.type).toBe('select');
  expect(select.parent?.findAllByType('svg').length).toBe(1);
  const share = button('复制歌曲链接');
  expect(share.findAllByType('span').map(node => node.children.join(''))).toContain('复制歌曲链接');
});


it('退出只在更多面板显示，关闭面板后派发退出动作一次', () => {
  expect(renderer.root.findAllByProps({ 'aria-label': '退出沉浸式播放' })).toHaveLength(0);
  click('更多');
  click('退出沉浸式播放');
  expect(panels()).toHaveLength(0);
  expect(focus.get('更多')).toHaveBeenCalledOnce();
  expect(props.actions.exitImmersive).toHaveBeenCalledOnce();
});
