// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CloseConfirmModal } from '../src/components/CloseConfirmModal';

const api = vi.hoisted(() => ({
  resolve: vi.fn(),
  ack: vi.fn(),
  listeners: new Map<string, Array<(event: unknown) => void>>(),
}));

vi.mock('@lx/tauri-bridge', () => ({ resolveCloseRequest: api.resolve, ackCloseRequest: api.ack }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: (name: string, handler: (event: unknown) => void) => {
    const list = api.listeners.get(name) ?? [];
    list.push(handler);
    api.listeners.set(name, list);
    return Promise.resolve(() => {
      api.listeners.set(name, (api.listeners.get(name) ?? []).filter((item) => item !== handler));
    });
  },
}));

let root: Root;

const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent === label)!;
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const rememberSwitch = () => document.querySelector<HTMLInputElement>('input[role="switch"]')!;

/** Rust 侧 emit("app-close-requested") */
async function requestClose() {
  await act(async () => {
    for (const handler of api.listeners.get('app-close-requested') ?? []) handler({ payload: null });
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  api.listeners.clear();
  api.ack.mockResolvedValue(undefined);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
  act(() => {
    root.render(<CloseConfirmModal />);
  });
});

afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

it('首次关闭时弹出确认框，默认「记住我的选择」并选中「最小化到托盘」', async () => {
  expect(dialog()).toBeNull();
  await requestClose();
  expect(dialog()?.getAttribute('aria-labelledby')).toBe('af-close-confirm-title');
  expect(rememberSwitch().checked).toBe(true);
  // 弹窗一出现就报告「框已经画出来了」，Rust 侧据此取消无人应答兜底
  expect(api.ack).toHaveBeenCalledTimes(1);

  api.resolve.mockResolvedValue(undefined);
  await act(async () => {
    button('最小化到托盘').click();
  });

  expect(api.resolve).toHaveBeenCalledWith('tray', true);
  expect(dialog()).toBeNull();
});

it('取消勾选「记住我的选择」时只对本次生效', async () => {
  api.resolve.mockResolvedValue(undefined);
  await requestClose();
  await act(async () => {
    rememberSwitch().click();
  });
  expect(rememberSwitch().checked).toBe(false);

  await act(async () => {
    button('退出应用').click();
  });
  expect(api.resolve).toHaveBeenCalledWith('quit', false);
});

it('取消与 Esc 只收起弹窗，不替用户做决定', async () => {
  await requestClose();
  await act(async () => {
    button('取消').click();
  });
  expect(dialog()).toBeNull();

  await requestClose();
  await act(async () => {
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
  });
  expect(dialog()).toBeNull();
  expect(api.resolve).not.toHaveBeenCalled();
});

it('命令失败时保留弹窗并给出错误，按钮可再次操作', async () => {
  api.resolve.mockRejectedValueOnce(new Error('找不到主窗口'));
  await requestClose();
  await act(async () => {
    button('最小化到托盘').click();
  });

  expect(dialog()).not.toBeNull();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('找不到主窗口');
  expect(button('最小化到托盘').disabled).toBe(false);
});
