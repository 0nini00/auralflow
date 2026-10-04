// @vitest-environment jsdom
import { act, useRef, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useDialogFocus } from '../src/hooks/useDialogFocus';

let root: Root;
let trigger: HTMLButtonElement;
function Dialog({ onClose, busy = false, children }: { onClose?: () => void; busy?: boolean; children?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus({ open: true, containerRef: ref, onClose, closeOnEscape: !busy });
  return <div ref={ref} role="dialog" aria-label="测试弹窗" tabIndex={-1}>
    <button id="first">首项</button><input id="initial" data-dialog-initial-focus />
    {children}<button id="last">末项</button>
  </div>;
}
function key(target: Element, key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  act(() => { target.dispatchEvent(event); }); return event;
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.body.innerHTML = '<button id="trigger">打开</button><div id="root"></div>';
  trigger = document.getElementById('trigger') as HTMLButtonElement; trigger.focus();
  root = createRoot(document.getElementById('root')!);
});
afterEach(() => { act(() => root.unmount()); vi.unstubAllGlobals(); });
const el = (id: string) => document.getElementById(id)!;
it('初始聚焦指定字段、Tab/Shift Tab 循环、关闭归还触发器', () => {
  act(() => root.render(<Dialog />));
  expect(document.activeElement).toBe(el('initial'));
  el('last').focus(); expect(key(el('last'), 'Tab').defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(el('first'));
  expect(key(el('first'), 'Tab', { shiftKey: true }).defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(el('last'));
  act(() => root.render(null)); expect(document.activeElement).toBe(trigger);
});
it('空弹窗以容器聚焦，跳过 hidden、disabled 与负 tabindex', () => {
  function Empty() {
    const ref = useRef<HTMLDivElement>(null); useDialogFocus({ open: true, containerRef: ref });
    return <div ref={ref} id="empty" tabIndex={-1}><button disabled /><div hidden><button /></div><button tabIndex={-1} /></div>;
  }
  act(() => root.render(<Empty />));
  expect(document.activeElement).toBe(el('empty'));
  expect(key(el('empty'), 'Tab').defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(el('empty'));
});
it('busy 与回调更新不重置焦点，Escape 仅使用最新回调', () => {
  const old = vi.fn(), current = vi.fn();
  act(() => root.render(<Dialog onClose={old} />)); el('last').focus();
  act(() => root.render(<Dialog onClose={current} busy />));
  expect(document.activeElement).toBe(el('last'));
  key(el('last'), 'Escape'); expect(current).not.toHaveBeenCalled();
  act(() => root.render(<Dialog onClose={current} />));
  expect(document.activeElement).toBe(el('last'));
  key(el('last'), 'Escape'); expect(current).toHaveBeenCalledOnce(); expect(old).not.toHaveBeenCalled();
});
it('不吞其他按键，尊重 IME 与组件 preventDefault', () => {
  const close = vi.fn(); act(() => root.render(<Dialog onClose={close} />));
  expect(key(el('initial'), 'ArrowDown').defaultPrevented).toBe(false);
  key(el('initial'), 'Escape', { isComposing: true });
  el('initial').addEventListener('keydown', (event) => event.preventDefault());
  key(el('initial'), 'Escape'); expect(close).not.toHaveBeenCalled();
});
it('嵌套弹窗只关闭顶层，恢复到父层入口，最后回到外部触发器', () => {
  const closed = vi.fn();
  function Nested() {
    const [inner, setInner] = useState(false);
    return <Dialog onClose={closed}><button id="nested-trigger" onClick={() => setInner(true)}>子弹窗</button>
      {inner && createPortal(<Dialog onClose={() => setInner(false)}><button id="inner">子操作</button></Dialog>, document.body)}
    </Dialog>;
  }
  act(() => root.render(<Nested />)); el('nested-trigger').focus();
  act(() => el('nested-trigger').click());
  key(el('inner'), 'Escape');
  expect(el('nested-trigger')).toBe(document.activeElement); expect(closed).not.toHaveBeenCalled();
  key(el('nested-trigger'), 'Escape'); expect(closed).toHaveBeenCalledOnce();
  act(() => root.render(null)); expect(document.activeElement).toBe(trigger);
});
it('同次挂载的 DOM 嵌套子 dialog 仍然顶层', () => {
  const parent = vi.fn(), child = vi.fn();
  act(() => root.render(<Dialog onClose={parent}><Dialog onClose={child}><button id="child" /></Dialog></Dialog>));
  key(el('child'), 'Escape'); expect(child).toHaveBeenCalledOnce(); expect(parent).not.toHaveBeenCalled();
});
it('aria-controls portal 菜单可聚焦并自行消费 Escape，不关闭弹窗', () => {
  const closed = vi.fn();
  function Menu() {
    const [open, setOpen] = useState(false);
    return <Dialog onClose={closed}><button id="menu-trigger" aria-controls="portal-menu" onClick={() => setOpen(true)}>菜单</button>
      {open && createPortal(<div id="portal-menu" role="menu" onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); setOpen(false); el('menu-trigger').focus(); } }}><button id="menu-item" role="menuitem">条目</button></div>, document.body)}
    </Dialog>;
  }
  act(() => root.render(<Menu />)); act(() => el('menu-trigger').click()); el('menu-item').focus();
  expect(document.activeElement).toBe(el('menu-item'));
  key(el('menu-item'), 'Escape'); expect(closed).not.toHaveBeenCalled(); expect(document.activeElement).toBe(el('menu-trigger'));
});
it('未归属的背景 portal 菜单不能突破当前 dialog 的焦点边界', () => {
  const closed = vi.fn(); act(() => root.render(<Dialog onClose={closed} />));
  const menu = document.createElement('div'); menu.setAttribute('role', 'menu'); menu.innerHTML = '<button id="portal-item">菜单项</button>'; document.body.append(menu);
  el('portal-item').focus(); expect(document.activeElement).toBe(el('initial'));
  key(el('initial'), 'Tab'); expect(document.activeElement).toBe(el('last'));
  expect(closed).not.toHaveBeenCalled();
});
it('焦点意外移到背景时返回当前弹窗', () => {
  act(() => root.render(<Dialog />)); trigger.focus();
  expect(document.activeElement).toBe(el('initial'));
});
it('同根多个 dialog 按非顶层先卸载时共享监听器仍完整清理', () => {
  const add = vi.spyOn(document, 'addEventListener');
  const remove = vi.spyOn(document, 'removeEventListener');
  act(() => root.render(<><Dialog /><Dialog /></>));
  const handlers = add.mock.calls.filter(([type]) => type === 'keydown' || type === 'focusin');
  act(() => root.render(null));
  for (const [type, listener] of handlers) expect(remove).toHaveBeenCalledWith(type, listener);
  add.mockRestore(); remove.mockRestore();
});
it('关联 portal 的 Tab 序列连续，不在 DOM 外部背景处丢失或卡住', () => {
  act(() => root.render(<Dialog><button aria-controls="tab-menu">打开</button>{createPortal(<div id="tab-menu" role="menu"><button id="portal-first">一</button><button id="portal-last">二</button></div>, document.body)}</Dialog>));
  el('last').focus(); key(el('last'), 'Tab'); expect(document.activeElement).toBe(el('portal-first'));
  key(el('portal-first'), 'Tab'); expect(document.activeElement).toBe(el('portal-last'));
  key(el('portal-last'), 'Tab'); expect(document.activeElement).toBe(el('first'));
  key(el('first'), 'Tab', { shiftKey: true }); expect(document.activeElement).toBe(el('portal-last'));
});
