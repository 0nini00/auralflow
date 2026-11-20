// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { VirtualList } from '../src/components/VirtualList';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });
it('可变行高以实际高度排布，跟随主滚动容器且仅挂载窗口内条目', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const observers: ResizeObserverCallback[] = [];
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { observers.push(callback); }
    observe() {} disconnect() {}
  });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400);
  document.body.innerHTML = '<main class="af-content-scroll"><div id="root"></div></main>';
  const root = createRoot(document.getElementById('root')!);
  const items = Array.from({ length: 1000 }, (_, index) => ({ id: index }));
  try {
    act(() => root.render(<VirtualList items={items} rowHeight={100} measureRows scrollRootSelector=".af-content-scroll"
      getItemKey={item => item.id} renderItem={item => <div data-row={item.id}>Row {item.id}</div>} />));
    expect(document.querySelectorAll('[data-row]').length).toBeLessThan(30);
    const first = document.querySelector('[data-row="0"]')!.parentElement!;
    act(() => {
      for (const callback of observers) callback([{ target: first, contentRect: { height: 180 } }] as ResizeObserverEntry[], {} as ResizeObserver);
    });
    expect(document.querySelector('[data-row="1"]')!.parentElement!.style.top).toBe('180px');
    const host = document.querySelector<HTMLElement>('.af-content-scroll')!;
    vi.spyOn(document.querySelector<HTMLElement>('.af-virtual-list')!, 'getBoundingClientRect')
      .mockImplementation(() => ({ top: -host.scrollTop, height: 100080 } as DOMRect));
    act(() => { host.scrollTop = 50080; host.dispatchEvent(new Event('scroll')); });
    expect(document.querySelector('[data-row="500"]')).not.toBeNull();
    expect(document.querySelector('[data-row="0"]')).toBeNull();
    act(() => root.render(<VirtualList items={[]} rowHeight={100} measureRows scrollRootSelector=".af-content-scroll"
      getItemKey={item => (item as { id: number }).id} renderItem={() => null} />));
    expect(document.querySelectorAll('[data-row]')).toHaveLength(0);
    expect(document.querySelector<HTMLElement>('.af-virtual-list')!.firstElementChild?.getAttribute('style')).toContain('height: 0px');
  } finally { act(() => root.unmount()); }
});
