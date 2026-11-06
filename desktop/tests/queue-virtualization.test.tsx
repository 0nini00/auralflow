// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QueuePanel, IMMERSIVE_QUEUE_CLASSES } from '../src/components/QueuePanel';
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('af-immersive-queue-list') ? 320 : 0;
  });
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
});
afterEach(() => { act(() => root.unmount()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('千首队列只渲染窗口附近条目，打开即定位当前曲，播放和删除保留绝对索引', () => {
  const tracks = Array.from({ length: 1000 }, (_, id) => ({ id: String(id), source: 'wy', name: `Song ${id}` }));
  const play = vi.fn(), remove = vi.fn();
  act(() => root.render(<QueuePanel tracks={tracks} currentIndex={500} play={play} remove={remove} classes={IMMERSIVE_QUEUE_CLASSES} />));
  expect(document.querySelectorAll('.af-immersive-queue-item').length).toBeLessThan(40);
  const current = document.querySelector<HTMLButtonElement>('button[aria-label="播放 Song 500"]');
  expect(current).not.toBeNull();
  act(() => current!.click());
  expect(play).toHaveBeenCalledWith(500);
  act(() => document.querySelector<HTMLButtonElement>('button[aria-label="从播放列表移除 Song 500"]')!.click());
  expect(remove).toHaveBeenCalledWith(500);
  expect(play).toHaveBeenCalledTimes(1);
});

it('320px 视口滚动后只保留对应 DOM 范围，64px 行高与绝对索引保持一致', () => {
  const tracks = Array.from({ length: 1000 }, (_, id) => ({ id: String(id), source: 'wy', name: `Song ${id}` }));
  const play = vi.fn();
  act(() => root.render(<QueuePanel tracks={tracks} currentIndex={500} play={play} remove={vi.fn()} classes={IMMERSIVE_QUEUE_CLASSES} />));
  const list = document.querySelector<HTMLElement>('.af-immersive-queue-list')!;
  expect(list.scrollTop).toBe(500 * 64 - (320 - 64) / 2);
  expect((list.firstElementChild as HTMLElement).style.height).toBe('64000px');
  act(() => {
    list.scrollTop = 6400;
    list.dispatchEvent(new Event('scroll'));
  });
  const rows = [...document.querySelectorAll<HTMLElement>('.af-immersive-queue-item')];
  expect(rows).toHaveLength(17);
  expect(rows[0].textContent).toContain('Song 94');
  expect(rows.at(-1)!.textContent).toContain('Song 110');
  expect(document.querySelector('button[aria-label="播放 Song 500"]')).toBeNull();
  const current = document.querySelector<HTMLButtonElement>('button[aria-label="播放 Song 100"]')!;
  expect(current.parentElement!.parentElement!.style.top).toBe('6400px');
  expect(current.parentElement!.parentElement!.style.height).toBe('64px');
  act(() => current.click());
  expect(play).toHaveBeenCalledWith(100);
});
