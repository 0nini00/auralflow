import CryptoJS from 'crypto-js';
import { beforeEach, expect, it, vi } from 'vitest';
import type { MusicInfo } from '@lx/core';
import { wyProvider } from '../src/services/sources/wyProvider';
import { txProvider } from '../src/services/sources/txProvider';

const api = vi.hoisted(() => ({ fetch: vi.fn(), metadata: vi.fn() }));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: api.fetch }));
vi.mock('@lx/tauri-bridge', () => ({ debugLog: vi.fn() }));
vi.mock('@/services/wyAccountService', () => ({ getWyCookie: async () => '' }));
vi.mock('@/services/builtinMusicApiClient', () => ({
  searchBuiltinMusicApiSongs: api.metadata,
  getBuiltinMusicApiLyric: vi.fn(),
  resolveBuiltinMusicApiUrl: vi.fn(),
}));

beforeEach(() => {
  api.fetch.mockReset();
  api.metadata.mockReset().mockResolvedValue([]);
});

const response = (data: unknown) => ({ ok: true, json: async () => data });

function wyParams() {
  const body = api.fetch.mock.calls.at(-1)![1].body;
  const ciphertext = new URLSearchParams(body).get('params')!;
  const plain = CryptoJS.AES.decrypt(
    CryptoJS.lib.CipherParams.create({ ciphertext: CryptoJS.enc.Hex.parse(ciphertext) }),
    CryptoJS.enc.Utf8.parse('e82ckenh8dichen8'),
    { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 },
  ).toString(CryptoJS.enc.Utf8);
  return JSON.parse(plain.split('-36cd479b6b5-')[1]);
}

it('网易分类按接口大小推进 offset，满页后可继续、末页停止', async () => {
  api.fetch.mockResolvedValueOnce(response({ result: { albums: Array.from({ length: 100 }, (_, id) => ({ id, name: `Album-${id}` })) } }))
    .mockResolvedValueOnce(response({ result: { albums: [{ id: 101, name: 'Last' }] } }));
  const first = await wyProvider.search('alpha', 'album', 1);
  expect(wyParams()).toMatchObject({ offset: 0, limit: 100, type: 10 });
  expect(first.hasMore).toBe(true);
  const second = await wyProvider.search('alpha', 'album', 2);
  expect(wyParams()).toMatchObject({ offset: 100, limit: 100, type: 10 });
  expect(second.albums?.map(item => item.id)).toEqual(['101']);
  expect(second.hasMore).toBe(false);
});

it('网易歌单使用 30 条页大小，不与专辑的 offset 混用', async () => {
  api.fetch.mockResolvedValue(response({ result: { playlists: [{ id: 31, name: 'Last' }] } }));
  const result = await wyProvider.search('alpha', 'playlist', 2);
  expect(wyParams()).toMatchObject({ offset: 30, limit: 30, type: 1000 });
  expect(result.hasMore).toBe(false);
});

it('QQ 使用真实 page_num 且按原始页大小决定是否继续，不被无效条目过滤截断', async () => {
  api.fetch.mockResolvedValueOnce(response({ code: 0, request: { code: 0, data: { body: {
    item_songlist: [{}, ...Array.from({ length: 29 }, (_, id) => ({ dissid: id + 1, dissname: `List-${id}` }))],
  } } } })).mockResolvedValueOnce(response({ code: 0, request: { code: 0, data: { body: { item_songlist: [] } } } }));
  const first = await txProvider.search('alpha', 'playlist', 1);
  expect(first.playlists).toHaveLength(29);
  expect(first.hasMore).toBe(true);
  const second = await txProvider.search('alpha', 'playlist', 2);
  const payload = JSON.parse(api.fetch.mock.calls.at(-1)![1].body);
  expect(payload.request.param).toMatchObject({ page_num: 2, num_per_page: 30, search_type: 3 });
  expect(second.hasMore).toBe(false);
});

it('单曲主源结束时，仍能继续翻满页的元数据来源', async () => {
  api.fetch.mockResolvedValue(response({ result: { songs: [{ id: 1, name: 'Primary', ar: [{ name: 'Singer' }] }] } }));
  api.metadata.mockResolvedValue(Array.from({ length: 30 }, (_, id) => ({ id: `meta-${id}`, name: `Meta-${id}`, singer: 'Other', source: 'wy' } as MusicInfo)));
  const result = await wyProvider.search('alpha', 'song', 2);
  expect(wyParams()).toMatchObject({ offset: 100, limit: 100, type: 1 });
  expect(api.metadata).toHaveBeenCalledWith('netease', 'alpha', 2, 30, 'wy');
  expect(result.hasMore).toBe(true);
});
