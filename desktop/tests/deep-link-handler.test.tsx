// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

/**
 * 冷启动场景：应用被 auralflow:// 深链拉起时，插件的 CLI 转发发生在前端挂载之前，
 * onOpenUrl 收不到那一次；必须主动 getCurrent() 取回启动 URL，否则深链只在
 * 「应用已在运行」时生效，点桌面快捷方式/外部链接启动时静默无反应。
 */
const plugin = vi.hoisted(() => ({
  getCurrent: vi.fn(async (): Promise<string[] | null> => null),
  onOpenUrl: vi.fn(async (_handler: (urls: string[]) => void) => () => {}),
}));
vi.mock('@tauri-apps/plugin-deep-link', () => plugin);

import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { DeepLinkHandler } from '../src/components/DeepLinkHandler';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

let root: Root;
let container: HTMLDivElement;

async function mount() {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/']}>
        <DeepLinkHandler />
        <Routes>
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  plugin.getCurrent.mockResolvedValue(null);
  plugin.onOpenUrl.mockImplementation(async () => () => {});
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it('冷启动：getCurrent 返回的深链也要被处理', async () => {
  plugin.getCurrent.mockResolvedValue(['auralflow://playlist/123']);
  await mount();
  await vi.waitFor(() => {
    expect(container.querySelector('[data-testid="location"]')?.textContent).toBe('/playlist/123');
  });
});

it('运行中：onOpenUrl 推送的深链照常处理', async () => {
  await mount();
  const handler = plugin.onOpenUrl.mock.calls[0]?.[0];
  expect(typeof handler).toBe('function');
  await act(async () => { handler!(['auralflow://search/周杰伦']); });
  await vi.waitFor(() => {
    expect(container.querySelector('[data-testid="location"]')?.textContent)
      .toBe(`/search?q=${encodeURIComponent('周杰伦')}`);
  });
});
