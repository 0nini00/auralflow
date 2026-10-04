// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Header } from '../src/components/Layout/Header';

const api = vi.hoisted(() => ({ fetch: vi.fn(), navigate: vi.fn(), record: vi.fn() }));
vi.mock('react-router-dom', () => ({
  useNavigate: () => api.navigate, useLocation: () => ({ pathname: '/' }), useSearchParams: () => [new URLSearchParams()],
}));
vi.mock('@/stores/themeStore', () => ({ useThemeStore: () => ({ effectiveTheme: 'dark', setTheme: vi.fn() }) }));
vi.mock('@/services/search/searchSuggestions', () => ({
  fetchWySearchSuggestions: api.fetch, recordSearchKeyword: api.record,
  buildSearchSuggestions: (query: string) => query ? [1, 2].map((n) => ({ value: `${query}-${n}`, label: `${query}-${n}`, meta: '本地', type: 'recent' })) : [],
  mergeSearchSuggestions: (online: unknown[], local: unknown[]) => [...online, ...local],
}));
let root: Root;
let input: HTMLInputElement;
function change(value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function key(key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  act(() => { input.dispatchEvent(event); }); return event;
}
const options = () => [...document.querySelectorAll<HTMLElement>('[role="option"]')];
const selected = () => options().find((node) => node.getAttribute('aria-selected') === 'true');
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); api.fetch.mockResolvedValue([]);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.body.innerHTML = '<div id="root"></div><button id="outside">外部</button>';
  root = createRoot(document.getElementById('root')!);
  act(() => root.render(<Header />));
  input = document.querySelector('input')!; act(() => input.focus());
});
afterEach(() => { act(() => root.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); });
it('combobox 上下选项、Enter 提交活跃项，保持 input 焦点和 aria 引用', () => {
  change('hello');
  expect(input.getAttribute('role')).toBe('combobox');
  expect(input.getAttribute('aria-autocomplete')).toBe('list');
  expect(input.getAttribute('aria-expanded')).toBe('true');
  expect(document.getElementById(input.getAttribute('aria-controls')!)?.getAttribute('role')).toBe('listbox');
  expect(key('ArrowDown').defaultPrevented).toBe(true);
  expect(selected()?.textContent).toContain('hello-1');
  expect(input.getAttribute('aria-activedescendant')).toBe(selected()?.id);
  key('ArrowDown'); expect(selected()?.textContent).toContain('hello-2');
  key('ArrowUp'); key('Enter');
  expect(api.navigate).toHaveBeenCalledWith('/search?q=hello-1');
  expect(document.activeElement).toBe(input);
  expect(input.getAttribute('aria-expanded')).toBe('false');
});
it('Escape 只关闭联想、不 blur，ArrowUp 从最后项开始', () => {
  change('hello'); key('ArrowUp'); expect(selected()?.textContent).toContain('hello-2');
  expect(key('Escape').defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(input); expect(options()).toHaveLength(0);
  key('ArrowDown'); expect(options()).toHaveLength(2);
});
it('composition 期间 Enter 和原生 submit 不提交，完成后才接受回车', () => {
  change('中文');
  act(() => { input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); });
  key('Enter', { isComposing: true });
  act(() => { input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(api.navigate).not.toHaveBeenCalled();
  act(() => { input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })); });
  key('Enter', { keyCode: 229 }); expect(api.navigate).not.toHaveBeenCalled();
  act(() => { input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(api.navigate).toHaveBeenCalledWith('/search?q=%E4%B8%AD%E6%96%87');
});
it('联想内部移动焦点超过旧 120ms 仍保留，移出搜索区域立即关闭', async () => {
  change('hello'); const option = options()[0]; expect(option).toBeDefined();
  act(() => option.focus());
  await act(async () => { await vi.advanceTimersByTimeAsync(150); });
  expect(options()).toHaveLength(2);
  act(() => option.click()); expect(api.navigate).toHaveBeenCalledWith('/search?q=hello-1');
  act(() => input.focus()); change('next');
  act(() => document.getElementById('outside')!.focus()); expect(options()).toHaveLength(0);
});
it('旧请求完成不能覆盖新查询，切换查询立即清除旧在线联想', async () => {
  let resolveOld!: (value: unknown[]) => void;
  api.fetch.mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }));
  change('old'); await act(async () => { await vi.advanceTimersByTimeAsync(220); });
  change('new');
  await act(async () => { resolveOld([{ value: 'stale', label: 'stale', type: 'song' }]); });
  expect(document.body.textContent).not.toContain('stale');
  api.fetch.mockResolvedValueOnce([{ value: 'new online', label: 'new online', type: 'song' }]);
  await act(async () => { await vi.advanceTimersByTimeAsync(220); });
  expect(document.body.textContent).toContain('new online');
  change('latest'); expect(document.body.textContent).not.toContain('new online');
});
it('无活跃项的正常表单提交仍搜索原查询', () => {
  change('query'); act(() => { input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(api.navigate).toHaveBeenCalledWith('/search?q=query'); expect(api.record).toHaveBeenCalledWith('query');
});
