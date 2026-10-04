import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MusicInfo } from '@lx/core';
import type { PlaybackBackendId, PlaybackResolvedUrl } from '../src/services/playback/types';
const bridge = vi.hoisted(() => ({ lookup: vi.fn(), audio: vi.fn(), image: vi.fn(), remove: vi.fn() }));
vi.mock('@lx/tauri-bridge', () => ({ lookupCachedMedia: bridge.lookup, cacheRemoteAudio: bridge.audio, cacheRemoteImage: bridge.image, removeCachedMedia: bridge.remove }));
vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (path: string) => `asset://${path}` }));
import { cacheResolvedPlaybackMedia, removeCachedAudioForMusic } from '../src/services/mediaCache';
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
  it('定向失效覆盖所有新 backend 分区', async () => {
    await removeCachedAudioForMusic(music);
    for (const backend of ['customSource', 'builtinNetease', 'builtinProvider']) {
      expect(bridge.remove).toHaveBeenCalledWith('audio', `wy-1-audio-${backend}-128k`);
    }
  });
});
