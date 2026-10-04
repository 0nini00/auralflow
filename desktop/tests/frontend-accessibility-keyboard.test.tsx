// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useKeyboardShortcuts } from '../src/hooks/useKeyboardShortcuts';

const player = vi.hoisted(() => ({
  togglePlay: vi.fn(), next: vi.fn(), prev: vi.fn(), setVolume: vi.fn(),
  setProgress: vi.fn(), toggleMute: vi.fn(), volume: 0.5, progress: 20, duration: 100,
}));
vi.mock('@/stores/playerStore', () => ({ usePlayerStore: { getState: () => player } }));
function Harness() { useKeyboardShortcuts(); return null; }
let root: Root;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
  act(() => root.render(<Harness />));
});
afterEach(() => { act(() => root.unmount()); vi.unstubAllGlobals(); });
function key(target: Element, key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}
it('普通空白区域仍派发最新播放进度与音量操作', () => {
  expect(key(document.body, ' ').defaultPrevented).toBe(true);
  key(document.body, 'ArrowRight'); key(document.body, 'ArrowDown');
  expect(player.togglePlay).toHaveBeenCalledOnce();
  expect(player.setProgress).toHaveBeenCalledWith(25);
  expect(player.setVolume).toHaveBeenCalledWith(0.4);
});
it('先尊重 defaultPrevented 和 IME，不能再次消费', () => {
  const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
  event.preventDefault(); document.body.dispatchEvent(event);
  key(document.body, 'ArrowRight', { isComposing: true });
  key(document.body, ' ', { keyCode: 229 });
  expect(player.togglePlay).not.toHaveBeenCalled();
  expect(player.setProgress).not.toHaveBeenCalled();
});
it.each([
  '<input />', '<textarea></textarea>', '<select></select>', '<button><span>x</span></button>',
  '<a href="#"><span>x</span></a>', '<div role="tab"><span>x</span></div>',
  '<div role="menuitem"><span>x</span></div>', '<div role="slider"></div>',
  '<div role="option"></div>', '<div contenteditable="true"><span>x</span></div>',
  '<div tabindex="0"></div>', '<details><summary>x</summary></details>',
])('交互目标 %s 不抢按键', (html) => {
  const host = document.createElement('div'); host.innerHTML = html; document.body.append(host);
  const target = host.querySelector('span, summary') ?? host.firstElementChild!;
  expect(key(target, ' ').defaultPrevented).toBe(false);
  key(target, 'ArrowDown'); key(target, 'm');
  expect(player.togglePlay).not.toHaveBeenCalled();
  expect(player.setVolume).not.toHaveBeenCalled();
  expect(player.toggleMute).not.toHaveBeenCalled();
});
it.each(['<section role="dialog" aria-modal="true"></section>', '<dialog open></dialog>', '<div class="af-immersive-lyrics"></div>'])('顶层对话框与沉浸页自己处理按键 %s', (html) => {
  document.body.insertAdjacentHTML('beforeend', html);
  expect(key(document.body, ' ').defaultPrevented).toBe(false);
  expect(player.togglePlay).not.toHaveBeenCalled();
});
