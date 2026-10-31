import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MusicInfo } from '@lx/core';

const fixture = vi.hoisted(() => ({
  resolve: vi.fn(),
  metadata: vi.fn(),
  cover: vi.fn(),
  lyrics: vi.fn(),
}));

vi.mock('../src/services/playback/playbackResolver', () => ({
  resolvePlaybackUrl: fixture.resolve,
  buildStreamHeaders: (source: string) => source === 'wy' ? { Referer: 'https://music.163.com' } : undefined,
}));
vi.mock('../src/stores/variantPinStore', () => ({
  useVariantPinStore: { getState: () => ({ getPinnedVariantKey: () => undefined }) },
}));
vi.mock('../src/services/persistentCache', () => ({
  isLocalCachedPlaybackUrl: (url: string) => url.startsWith('asset:') || url.includes('asset.localhost'),
}));
vi.mock('../src/services/outboundHttp', () => ({ outboundRequest: vi.fn() }));
vi.mock('../src/services/sources/sourceService', () => ({ getSource: vi.fn(() => null) }));
vi.mock('../src/services/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('@lx/tauri-bridge', () => ({
  cancelDownload: vi.fn(),
  downloadFile: vi.fn(),
  setAudioCover: fixture.cover,
  setAudioLyrics: fixture.lyrics,
  setAudioMetadata: fixture.metadata,
  writeDownloadTextFile: vi.fn(),
}));

import { enhanceDownloadedFile, prepareDownload } from '../src/services/downloadService';

const cloudSong = {
  id: '27694142',
  source: 'wy',
  name: '他和她',
  singer: '回音哥',
  interval: 223,
  wyCloud: true,
  cloudMeta: { bitrate: 1681, fileName: '他和她 - 回音哥.flac', size: 48_781_208 },
} as MusicInfo;

function resolvedCloud(quality = '320k') {
  return {
    url: 'https://m801.music.126.net/abc.flac',
    music: cloudSong,
    quality,
    backend: 'builtinProvider',
    resolverName: 'wy',
    trace: [],
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  fixture.resolve.mockResolvedValue(resolvedCloud());
});

describe('云盘曲下载', () => {
  it('忽略音质档位、不做档位校验，扩展名取上传文件的真实扩展名', async () => {
    const prepared = await prepareDownload(cloudSong, 'flac24bit');

    // 云盘不转码：不把用户选的档位往下发，也不开 exactQuality（那会拒绝原文件）
    expect(fixture.resolve).toHaveBeenCalledWith(
      cloudSong,
      expect.any(Array),
      undefined,
      { cacheMedia: false, exactQuality: false },
    );
    expect(prepared.fileName).toBe('他和她 - 回音哥.flac');
    // 展示上传文件的真实码率，而不是请求档位
    expect(prepared.quality).toBe('Hi-Res');
  });

  it('解析结果标 320k 也不报「没有 flac 下载源」', async () => {
    fixture.resolve.mockResolvedValue(resolvedCloud('320k'));
    await expect(prepareDownload(cloudSong, 'flac24bit')).resolves.toMatchObject({
      fileName: '他和她 - 回音哥.flac',
    });
  });

  it('原始文件名没有可用扩展名时退回 URL 推断，不按请求档位猜', async () => {
    fixture.resolve.mockResolvedValue({
      ...resolvedCloud(),
      url: 'https://m801.music.126.net/signed/path?token=1',
    });
    const prepared = await prepareDownload(
      { ...cloudSong, cloudMeta: { bitrate: 320 } } as MusicInfo,
      'flac24bit',
    );
    expect(prepared.fileName).toBe('他和她 - 回音哥.mp3');
    expect(prepared.quality).toBe('320k');
  });

  it('后处理整体跳过：不重写标签/封面/歌词，保留上传文件原有内嵌信息', async () => {
    const warnings = await enhanceDownloadedFile(cloudSong, 'C:/dl/他和她.flac', 'C:/dl', '他和她.flac');
    expect(warnings).toEqual([]);
    expect(fixture.metadata).not.toHaveBeenCalled();
    expect(fixture.cover).not.toHaveBeenCalled();
    expect(fixture.lyrics).not.toHaveBeenCalled();
  });
});
