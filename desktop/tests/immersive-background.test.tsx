// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const deps = vi.hoisted(() => ({
  create: vi.fn(), update: vi.fn(), dispose: vi.fn(),
}));
vi.mock('../src/services/immersiveBackgroundRenderer', () => ({
  createImmersiveBackgroundRenderer: deps.create,
}));
import { ImmersiveBackground } from '../src/components/ImmersiveBackground';

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  deps.create.mockImplementation(() => ({ update: deps.update, dispose: deps.dispose }));
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it('只挂载隐藏的背景画布，模式和播放状态变更复用同一渲染器', async () => {
  await act(async () => root.render(<ImmersiveBackground mode="liquid" playing />));
  const canvas = host.querySelector('canvas');
  expect(canvas?.className).toBe('af-immersive-dynamic-background');
  expect(canvas?.getAttribute('aria-hidden')).toBe('true');
  expect(deps.create).toHaveBeenCalledTimes(1);
  expect(deps.create).toHaveBeenCalledWith(canvas, expect.objectContaining({ mode: 'liquid', playing: true }));
  await act(async () => root.render(<ImmersiveBackground mode="aurora" playing={false} />));
  expect(deps.create).toHaveBeenCalledTimes(1);
  expect(deps.update).toHaveBeenLastCalledWith({ mode: 'aurora', playing: false });
});

it('错误送到最新回调，卸载只释放一次渲染资源', async () => {
  const first = vi.fn(); const latest = vi.fn();
  await act(async () => root.render(<ImmersiveBackground mode="liquid" playing onError={first} />));
  await act(async () => root.render(<ImmersiveBackground mode="liquid" playing onError={latest} />));
  const options = deps.create.mock.calls[0][1];
  options.onError('图形上下文已丢失');
  expect(first).not.toHaveBeenCalled();
  expect(latest).toHaveBeenCalledWith('图形上下文已丢失');
  await act(async () => root.render(null));
  expect(deps.dispose).toHaveBeenCalledTimes(1);
});

it('StrictMode重复挂载会清理前一个实例，避免多条动画循环', async () => {
  await act(async () => root.render(<React.StrictMode><ImmersiveBackground mode="aurora" playing /></React.StrictMode>));
  expect(deps.create).toHaveBeenCalledTimes(2);
  expect(deps.dispose).toHaveBeenCalledTimes(1);
  await act(async () => root.render(null));
  expect(deps.dispose).toHaveBeenCalledTimes(2);
});
