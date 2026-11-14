import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WyAuthExpiredError } from '../src/services/wyAuthError';
import { useWyAccountStore } from '../src/stores/wyAccountStore';

/**
 * 登录态失效的清理判定必须靠错误类型，不能靠文案正则。
 *
 * 旧实现用 /过期|无效|不一致|…/ 去匹配错误消息，任何「文案恰好含这些词」的业务
 * 错误（例如「歌单 ID 无效」）都会把用户的 Cookie 清掉；改文案也会让判定静默失效。
 */
const api = vi.hoisted(() => ({ check: vi.fn(), lists: vi.fn(), patch: vi.fn(), cookie: '' }));
vi.mock('@lx/tauri-bridge', () => ({ patchSettings: api.patch }));
vi.mock('@/services/wyAccountService', () => ({
  setWyCookie: (value: string) => { api.cookie = value; return value; },
  getWyCookie: async () => api.cookie,
  checkAccount: api.check,
  getUserPlaylists: api.lists,
  getPlaylistDetail: vi.fn(),
  addPlaylistTracks: vi.fn(),
  removePlaylistTracks: vi.fn(),
  subscribePlaylist: vi.fn(),
  getWyTrackId: () => null,
}));

const store = () => useWyAccountStore.getState();

beforeEach(() => {
  api.patch.mockReset().mockResolvedValue(undefined);
  api.check.mockReset();
  api.lists.mockReset();
  api.cookie = '';
});

describe('登录态失效的清理判定', () => {
  it('普通业务错误（文案含「无效」）不得清掉 Cookie', async () => {
    api.check.mockRejectedValue(new Error('歌单 ID 无效，请检查链接'));
    await store().load('cookie-A');

    expect(store().error).toContain('无效');
    expect(api.patch).not.toHaveBeenCalled();
    expect(api.cookie).toBe('cookie-A');
  });

  it('带类型的登录失效错误才清 Cookie', async () => {
    api.check.mockRejectedValue(new WyAuthExpiredError('网易云登录已过期，请重新登录'));
    await store().load('cookie-A');

    expect(api.patch).toHaveBeenCalledWith({ wyCookie: null });
    expect(api.cookie).toBe('');
  });
});
