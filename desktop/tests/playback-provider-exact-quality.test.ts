import { expect, it, vi } from 'vitest';
const provider = vi.hoisted(() => ({ name: 'QQ 音乐', getMusicUrl: vi.fn(async () => 'https://audio/unknown.m4a') }));
vi.mock('../src/services/sources/sourceService', () => ({ getSource: () => provider }));
import { builtinProviderBackend } from '../src/services/playback/builtinProviderBackend';
import type { PlaybackRequest } from '../src/services/playback/types';

it('QQ 官方普通链接不能作为已证明精确音质的下载结果', async () => {
  const request = { primary: { id: 'qq', source: 'tx', name: 'QQ', singer: 'Singer' }, qualityPreference: ['flac'], exactQuality: true } as PlaybackRequest;
  await expect(builtinProviderBackend.resolve(request)).rejects.toThrow('无法确认');
  expect(provider.getMusicUrl).not.toHaveBeenCalled();
});
