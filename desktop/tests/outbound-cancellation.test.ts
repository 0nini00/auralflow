import { beforeEach, expect, it, vi } from 'vitest';
const ipc = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: ipc.invoke }));
import { outboundRequest } from '../src/services/outboundHttp';

beforeEach(() => ipc.invoke.mockReset());

it('取消真正送达 Rust，等待请求退出后才释放调用方', async () => {
  let finish!: (value: unknown) => void;
  ipc.invoke.mockImplementation((command) => command === 'proxy_http_request'
    ? new Promise(resolve => { finish = resolve; }) : Promise.resolve());
  const controller = new AbortController();
  const pending = outboundRequest('https://example.com', { signal: controller.signal });
  const outcome = pending.then(() => 'success', error => error.name);
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  controller.abort();
  expect(ipc.invoke).toHaveBeenCalledWith('cancel_proxy_http_request', { requestId: expect.any(String) });
  expect(await Promise.race([outcome, Promise.resolve('pending')])).toBe('pending');
  finish({ status: 200, statusText: 'OK', headers: {}, body: '' });
  expect(await outcome).toBe('AbortError');
});

it('预先取消的请求不进入 IPC', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(outboundRequest('https://example.com', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect(ipc.invoke).not.toHaveBeenCalled();
});

it('注册尚未返回时取消，必须在注册后送达取消再结束请求', async () => {
  let registered!: () => void;
  ipc.invoke.mockImplementation(command => {
    if (command === 'register_proxy_http_request') return new Promise<void>(resolve => { registered = resolve; });
    if (command === 'proxy_http_request') return Promise.reject(new Error('出站请求已取消'));
    return Promise.resolve();
  });
  const controller = new AbortController();
  const pending = outboundRequest('https://example.com', { signal: controller.signal });
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  registered();
  await rejected;
  expect(ipc.invoke.mock.calls.map(([command]) => command)).toEqual([
    'register_proxy_http_request', 'cancel_proxy_http_request', 'proxy_http_request',
  ]);
});
