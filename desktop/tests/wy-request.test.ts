import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WyAuthExpiredError } from '@lx/core';
import type { MusicInfo } from '@lx/core';
import { assertWyOk, fetchWySongDetails, sendWyWeapi } from '../src/services/wyRequest';
import { wyProvider } from '../src/services/sources/wyProvider';

/**
 * 桌面端只有一条 weapi 通道：账号层与音源层共用同一份请求拼装、响应解析和
 * 登录失效判定。这里钉住的是「同一个失效 Cookie 在两层得到同一种错误」，以及
 * 取链落空时原因不被抹掉。
 */
const api = vi.hoisted(() => ({ fetch: vi.fn(), cookie: '' }));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: api.fetch }));
vi.mock('@lx/tauri-bridge', () => ({ debugLog: vi.fn() }));
vi.mock('@/services/wyAccountService', () => ({ getWyCookie: async () => api.cookie }));
vi.mock('@/services/builtinMusicApiClient', () => ({
  searchBuiltinMusicApiSongs: vi.fn(),
  getBuiltinMusicApiLyric: vi.fn(),
  resolveBuiltinMusicApiUrl: vi.fn(),
}));

const textResponse = (text: string, status = 200) => ({ ok: status < 400, status, text: async () => text });
const jsonResponse = (data: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(data), json: async () => data });
const song = { id: '123', name: 'Song', singer: 'Singer', source: 'wy' } as MusicInfo;

beforeEach(() => {
  api.fetch.mockReset();
  api.cookie = '';
});

describe('sendWyWeapi', () => {
  it('发往 weapi 路径，带上 Cookie 与表单体', async () => {
    api.fetch.mockResolvedValue(textResponse('{"code":200,"ok":true}'));
    const body = await sendWyWeapi('/user/playlist', { uid: '1' }, 'MUSIC_U=u; __csrf_token=tok');

    expect(body).toEqual({ code: 200, ok: true });
    const [url, init] = api.fetch.mock.calls[0];
    expect(url).toBe('https://music.163.com/weapi/user/playlist');
    expect(init.method).toBe('POST');
    expect(init.headers.Cookie).toBe('MUSIC_U=u; __csrf_token=tok');
    const form = new URLSearchParams(init.body);
    expect(form.get('params')).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(form.get('encSecKey')).toMatch(/^[0-9a-f]{256}$/);
  });

  it('空响应与风控页给出带路径和状态码的错误，而不是 SyntaxError', async () => {
    api.fetch.mockResolvedValueOnce(textResponse('', 200));
    await expect(sendWyWeapi('/x', {}, 'MUSIC_U=u')).rejects.toThrow('空响应（/x，HTTP 200）');
    api.fetch.mockResolvedValueOnce(textResponse('<html>blocked</html>', 403));
    await expect(sendWyWeapi('/x', {}, 'MUSIC_U=u')).rejects.toThrow('非 JSON 响应（/x，HTTP 403）');
  });
});

describe('assertWyOk', () => {
  it('200 通过；301/401/403 是带类型的登录失效；其余带上服务端文案', () => {
    expect(() => assertWyOk({ code: 200 })).not.toThrow();
    for (const code of [301, 401, 403]) {
      expect(() => assertWyOk({ code })).toThrow(WyAuthExpiredError);
    }
    expect(() => assertWyOk({ code: 400, message: '参数错误' })).toThrow('参数错误');
    expect(() => assertWyOk({ code: 500 })).toThrow('code=500');
  });
});

describe('fetchWySongDetails', () => {
  it('按 500 首分块，并把 privileges 并回对应歌曲', async () => {
    const ids = Array.from({ length: 501 }, (_, index) => index + 1);
    const request = vi.fn(async (data: Record<string, unknown>) => {
      const chunk = JSON.parse(String(data.ids)) as number[];
      return {
        songs: chunk.map((id) => ({ id })),
        privileges: chunk.map((id) => ({ id, fee: id })),
      };
    });

    const songs = await fetchWySongDetails(ids, request);
    expect(request).toHaveBeenCalledTimes(2);
    expect(songs).toHaveLength(501);
    expect(songs[500]).toEqual({ id: 501, privilege: { id: 501, fee: 501 } });
  });
});

describe('wyProvider.getMusicUrl 的失败原因', () => {
  it('登录失效在音源层也是带类型的错误，原因进入最终报错', async () => {
    api.cookie = 'MUSIC_U=expired';
    api.fetch
      .mockResolvedValueOnce(textResponse('{"code":301}'))
      .mockResolvedValueOnce(jsonResponse({ data: [{ url: '' }] }));

    await expect(wyProvider.getMusicUrl(song, '320k')).rejects.toThrow('weapi: 网易云登录已过期');
  });

  it('两个通道都报错时，两个原因都保留', async () => {
    api.fetch.mockRejectedValue(new Error('network down'));
    await expect(wyProvider.getMusicUrl(song, '320k')).rejects.toThrow('weapi: 未登录网易云；eapi: network down');
  });

  it('通道正常应答但确实没有地址时返回 null', async () => {
    api.cookie = 'MUSIC_U=u';
    api.fetch
      .mockResolvedValueOnce(textResponse('{"code":200,"data":[{"url":null}]}'))
      .mockResolvedValueOnce(jsonResponse({ data: [{ url: null }] }));

    await expect(wyProvider.getMusicUrl(song, '320k')).resolves.toBeNull();
  });

  it('weapi 拿到地址就直接返回，不再打 eapi', async () => {
    api.cookie = 'MUSIC_U=u';
    api.fetch.mockResolvedValueOnce(textResponse('{"code":200,"data":[{"url":"https://m.example/a.mp3","level":"exhigh"}]}'));

    await expect(wyProvider.getMusicUrl(song, '320k')).resolves.toBe('https://m.example/a.mp3');
    expect(api.fetch).toHaveBeenCalledTimes(1);
  });

  it('云盘曲不走 eapi：weapi 失败时带原因抛出', async () => {
    api.cookie = 'MUSIC_U=u';
    api.fetch.mockResolvedValueOnce(textResponse('{"code":500,"message":"服务繁忙"}'));

    await expect(wyProvider.getMusicUrl({ ...song, wyCloud: true }, '320k')).rejects.toThrow('weapi: 服务繁忙');
    expect(api.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('桌面加密原语（crypto-js + node-forge）', () => {
  // 与 core、移动端原生模块共用的固定向量：算法在 core，这里验证的是桌面注入的原语。
  const BASE62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

  async function weapiWithSecretKey(secretKey: string, data: Record<string, unknown>) {
    const { weapi } = await import('../src/lib/crypto/weapi');
    const queue = [...secretKey].map((char) => (BASE62.indexOf(char) + 0.5) / BASE62.length);
    const random = vi.spyOn(Math, 'random').mockImplementation(() => queue.shift()!);
    try {
      return await weapi(data);
    } finally {
      random.mockRestore();
    }
  }

  it('weapi 的 params 与 encSecKey 等于已知密文', async () => {
    const first = await weapiWithSecretKey('JmX8r2LpQ4vZ9wKs', { csrf_token: 'abc123' });
    expect(first.params).toBe('yCi0k0x3OAKsbWpu8W53QG98Tmt7iyRYqX3tmDRizbiFLKQXKBr4cLI7vimiBwD5');

    const second = await weapiWithSecretKey('sKw9ZvQ4pL2rXm8J', {});
    expect(second.encSecKey).toBe(
      'd1b862365229f275df0f5df0a4a9a3fc946687cf72862e656960df1363b1cd691128b762c58e26000a6f24cdc1de9848015f41d1f47f8478d93a6629b3b1958288cf37272a2a5af06d5b863eba0441a3debd5be7b0e70991fa10f7f21c93b85d91e60b44d7ba7844671a8da7b58b366e4d7570403c658d6b0b3d20c13e6cd9c0',
    );
  });
});
