import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MusicInfo } from '@lx/core';
import type { PlaybackBackendId, PlaybackResolvedUrl } from '../src/services/playback/types';
const bridge = vi.hoisted(() => ({ lookup: vi.fn(), audio: vi.fn(), image: vi.fn(), remove: vi.fn() }));
vi.mock('@lx/tauri-bridge', () => ({ lookupCachedMedia: bridge.lookup, cacheRemoteAudio: bridge.audio, cacheRemoteImage: bridge.image, removeCachedMedia: bridge.remove }));
vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (path: string) => `asset://${path}` }));
import { cacheResolvedPlaybackMedia, findCachedPlaybackMedia, removeCachedAudioForMusic, StalePlaybackCacheError } from '../src/services/mediaCache';
const music = { id: '1', source: 'wy', name: '歌曲', singer: '歌手' } as MusicInfo;
function resolved(backend: PlaybackBackendId = 'customSource'): PlaybackResolvedUrl {
  return { music, backend, quality: '128k', url: 'https://audio/music', resolverName: backend, trace: [] };
}
function operation() {
  const controller = new AbortController();
  return {
    controller,
    token: {
      signal: controller.signal,
      isActive: () => !controller.signal.aborted,
      assertActive() { if (controller.signal.aborted) throw new Error('LX 操作已失效'); },
    },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  vi.resetAllMocks();
  bridge.lookup.mockResolvedValue(null);
  bridge.audio.mockResolvedValue('audio-file');
  bridge.image.mockResolvedValue('cover-file');
  bridge.remove.mockResolvedValue(true);
});
describe('LX 媒体缓存隔离', () => {
  it('同一 wy 歌曲的音频按 backend 分区，不查询旧来源不明 key', async () => {
    const { token } = operation();
    await cacheResolvedPlaybackMedia(music, resolved(), token);
    await cacheResolvedPlaybackMedia(music, resolved('builtinNetease'));
    await cacheResolvedPlaybackMedia(music, resolved('builtinProvider'));
    const keys = bridge.audio.mock.calls.map(([input]) => input.cacheKey);
    expect(new Set(keys).size).toBe(3);
    expect(keys).toEqual(expect.arrayContaining(['wy-1-audio-customSource-128k', 'wy-1-audio-builtinNetease-128k', 'wy-1-audio-builtinProvider-128k']));
    expect(bridge.lookup).not.toHaveBeenCalledWith('audio', 'wy-1-audio-128k');
    expect(bridge.remove).not.toHaveBeenCalled();
  });
  it.each([null, 'already-cached-file'])('LX lookup 等待后失效，不下载也不返回旧结果：%s', async (path) => {
    const lookup = deferred<string | null>();
    bridge.lookup.mockReturnValue(lookup.promise);
    const { controller, token } = operation();
    const pending = cacheResolvedPlaybackMedia(music, resolved(), token);
    const rejection = expect(pending).rejects.toThrow('失效');
    controller.abort();
    lookup.resolve(path);
    await rejection;
    expect(bridge.audio).not.toHaveBeenCalled();
  });
  it('开启时仍缓存 LX 音频，已发出的下载不等待完成', async () => {
    bridge.audio.mockReturnValue(new Promise(() => {}));
    const { token, controller } = operation();
    expect((await cacheResolvedPlaybackMedia(music, resolved(), token)).url).toBe('https://audio/music');
    controller.abort();
    expect(bridge.audio).toHaveBeenCalledTimes(1);
  });
  it('音频已发出但封面查询尚在等待，关闭后不能返回给播放', async () => {
    const cover = deferred<string | null>();
    bridge.lookup.mockImplementation((kind) => kind === 'cover' ? cover.promise : Promise.resolve(null));
    const target = { ...music, picUrl: 'https://cover/image.jpg' };
    const { token, controller } = operation();
    const pending = cacheResolvedPlaybackMedia(target, { ...resolved(), music: target }, token);
    const rejection = expect(pending).rejects.toThrow('失效');
    await vi.waitFor(() => expect(bridge.audio).toHaveBeenCalled());
    controller.abort();
    cover.resolve(null);
    await rejection;
    expect(bridge.image).not.toHaveBeenCalled();
    expect(bridge.remove).not.toHaveBeenCalled();
  });
  it('定向失效覆盖所有新 backend 分区与旧命名', async () => {
    await removeCachedAudioForMusic(music);
    for (const backend of ['customSource', 'builtinNetease', 'builtinProvider']) {
      expect(bridge.remove).toHaveBeenCalledWith('audio', `wy-1-audio-${backend}-128k`);
    }
    // 旧命名现在会被解析兜底命中，失效时必须一起删掉，否则下次还播同一个坏文件
    expect(bridge.remove).toHaveBeenCalledWith('audio', 'wy-1-audio-128k');
  });
});

describe('本地磁盘缓存命中的判定', () => {
  const longSong = { ...music, interval: 240 } as MusicInfo;
  const localPath = 'C:/cache/wy-1-audio-builtinNetease-320k.mp3';

  it('体积正常时直接用本地文件，不再后台下载', async () => {
    bridge.lookup.mockResolvedValue({ path: localPath, bytes: 9_600_000 });
    const { token } = operation();
    const out = await cacheResolvedPlaybackMedia(longSong, { ...resolved('builtinNetease'), quality: '320k' }, token);
    expect(out.url).toBe(`asset://${localPath}`);
    expect(bridge.audio).not.toHaveBeenCalled();
  });

  it('体积明显短于歌曲时长 → 判定试听片段：清掉文件并改用远端地址', async () => {
    // 320k 下 500 KB ≈ 12.5 秒，远低于 240 秒歌曲的判定门槛（min(60s, 50%)）
    bridge.lookup.mockResolvedValue({ path: localPath, bytes: 500_000 });
    const { token } = operation();
    const out = await cacheResolvedPlaybackMedia(longSong, { ...resolved('builtinNetease'), quality: '320k' }, token);
    expect(bridge.remove).toHaveBeenCalledWith('audio', 'wy-1-audio-builtinNetease-320k');
    expect(out.url).toBe('https://audio/music');
  });

  it('待播地址是本地文件而当前 key 查不到 → 抛 StalePlaybackCacheError', async () => {
    bridge.lookup.mockResolvedValue(null);
    const { token } = operation();
    await expect(
      cacheResolvedPlaybackMedia(
        longSong,
        { ...resolved('builtinNetease'), quality: 'flac', url: 'http://asset.localhost/C%3A%5Ccache%5Cwy-1-audio-flac.mp3' },
        token,
      ),
    ).rejects.toBeInstanceOf(StalePlaybackCacheError);
    // 死链绝不能交给播放器，也不能顺手再下载一次
    expect(bridge.audio).not.toHaveBeenCalled();
  });
});

describe('解析前先找已落盘音频', () => {
  const longSong = { ...music, interval: 240 } as MusicInfo;
  const localPath = 'C:/cache/wy-1-audio-builtinProvider-320k.mp3';

  it('URL 缓存过期也不影响：直接返回磁盘上的整曲', async () => {
    bridge.lookup.mockImplementation(async (_kind: string, key: string) =>
      key === 'wy-1-audio-builtinProvider-320k' ? { path: localPath, bytes: 9_600_000 } : null,
    );
    const out = await findCachedPlaybackMedia(longSong, ['320k', '128k']);
    expect(out).toMatchObject({ quality: '320k', backend: 'builtinProvider', fromCache: true });
    expect(out?.url).toBe(`asset://${localPath}`);
    // 命中即返回，不再试更低档位
    expect(bridge.lookup).not.toHaveBeenCalledWith('audio', 'wy-1-audio-builtinProvider-128k');
    expect(bridge.audio).not.toHaveBeenCalled();
  });

  it('音质按降级链顺序找：高音质没有文件时退到低音质', async () => {
    bridge.lookup.mockImplementation(async (_kind: string, key: string) =>
      key === 'wy-1-audio-builtinNetease-128k' ? { path: 'C:/cache/wy-1-audio-builtinNetease-128k.mp3', bytes: 4_000_000 } : null,
    );
    const out = await findCachedPlaybackMedia(longSong, ['320k', '128k']);
    expect(out).toMatchObject({ quality: '128k', backend: 'builtinNetease' });
  });

  it('自定义源关闭时不复用其脚本落盘的音频', async () => {
    bridge.lookup.mockImplementation(async (_kind: string, key: string) =>
      key === 'wy-1-audio-customSource-320k' ? { path: 'C:/cache/lx.mp3', bytes: 9_600_000 } : null,
    );
    expect(await findCachedPlaybackMedia(longSong, ['320k'])).toBeNull();
    const { token } = operation();
    expect(await findCachedPlaybackMedia(longSong, ['320k'], token)).toMatchObject({
      backend: 'customSource',
      quality: '320k',
    });
  });

  it('落盘的是试听残包时清掉并继续找下一档，不把 30s 文件当整曲', async () => {
    bridge.lookup.mockImplementation(async (_kind: string, key: string) => {
      if (key === 'wy-1-audio-builtinNetease-320k') return { path: 'C:/cache/preview.mp3', bytes: 500_000 };
      if (key === 'wy-1-audio-builtinNetease-128k') return { path: 'C:/cache/full.mp3', bytes: 9_600_000 };
      return null;
    });
    const out = await findCachedPlaybackMedia(longSong, ['320k', '128k']);
    expect(bridge.remove).toHaveBeenCalledWith('audio', 'wy-1-audio-builtinNetease-320k');
    expect(out).toMatchObject({ quality: '128k', backend: 'builtinNetease' });
  });

  it('不可缓存的来源 / 查询异常都按未命中处理', async () => {
    expect(await findCachedPlaybackMedia({ ...longSong, source: 'local' } as MusicInfo, ['320k'])).toBeNull();
    bridge.lookup.mockRejectedValue(new Error('bridge down'));
    expect(await findCachedPlaybackMedia(longSong, ['320k'])).toBeNull();
  });
});

describe('旧命名（v0.6.8 前不带 backend）音频复用', () => {
  const longSong = { ...music, interval: 240 } as MusicInfo;
  const legacyKey = 'wy-1-audio-320k';

  it('新版分区全部未命中时命中旧文件，直接本地播放且不复制一份新 key', async () => {
    bridge.lookup.mockImplementation(async (kind: string, key: string) =>
      kind === 'audio' && key === legacyKey ? { path: 'C:/cache/legacy.mp3', bytes: 9_600_000 } : null,
    );
    const out = await findCachedPlaybackMedia(longSong, ['320k']);
    expect(out).toMatchObject({ quality: '320k', backend: 'builtinNetease', fromCache: true });
    expect(out?.url).toBe('asset://C:/cache/legacy.mp3');
    // 只读命中：缓存里没有多出一个新命名的文件
    expect(bridge.audio).not.toHaveBeenCalled();
  });

  it('旧文件是 30s 试听残包时删掉它，继续往低音质找', async () => {
    bridge.lookup.mockImplementation(async (kind: string, key: string) => {
      if (kind !== 'audio') return null;
      if (key === legacyKey) return { path: 'C:/cache/legacy-preview.mp3', bytes: 500_000 };
      if (key === 'wy-1-audio-builtinNetease-128k') return { path: 'C:/cache/full.mp3', bytes: 9_600_000 };
      return null;
    });
    const out = await findCachedPlaybackMedia(longSong, ['320k', '128k']);
    expect(bridge.remove).toHaveBeenCalledWith('audio', legacyKey);
    expect(out).toMatchObject({ quality: '128k', backend: 'builtinNetease' });
    expect(out?.url).toBe('asset://C:/cache/full.mp3');
  });

  it('旧 key 标 flac、落盘其实是 mp3：按真实容器估算，不把短歌误删成试听残包', async () => {
    // 5 MB 若按 flac(900k) 估算只有 44 秒，会被判成试听；按 mp3 最高档(320k) 则是 125 秒。
    bridge.lookup.mockImplementation(async (kind: string, key: string) =>
      kind === 'audio' && key === 'wy-1-audio-flac' ? { path: 'C:/cache/legacy.mp3', bytes: 5_000_000 } : null,
    );
    const out = await findCachedPlaybackMedia(longSong, ['flac']);
    expect(out?.url).toBe('asset://C:/cache/legacy.mp3');
    expect(out?.quality).toBe('flac');
    expect(bridge.remove).not.toHaveBeenCalled();
  });

  it('新分区命中时优先用新文件，不再看旧 key', async () => {
    bridge.lookup.mockImplementation(async (kind: string, key: string) => {
      if (kind !== 'audio') return null;
      if (key === 'wy-1-audio-builtinNetease-320k') return { path: 'C:/cache/new.mp3', bytes: 9_600_000 };
      if (key === legacyKey) return { path: 'C:/cache/legacy.mp3', bytes: 9_600_000 };
      return null;
    });
    const out = await findCachedPlaybackMedia(longSong, ['320k']);
    expect(out?.url).toBe('asset://C:/cache/new.mp3');
    expect(bridge.lookup).not.toHaveBeenCalledWith('audio', legacyKey);
  });
});
