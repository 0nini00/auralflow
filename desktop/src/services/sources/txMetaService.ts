import { createSharedRequestPool } from '../playback/sharedRequestPool';
import { throwIfAborted } from '../playback/cancellation';
import { fetchTxTrackMeta, type MusicInfo, type TxTrackMeta } from '@lx/core';
import { debugLog } from '@lx/tauri-bridge';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

/**
 * 补齐 QQ 曲目缺失的取链元数据（file.media_mid）。
 *
 * 历史歌单可能是在 txMeta 映射上线前导入的：歌单详情本身带着 `file.media_mid`
 * （例如晴天 songmid 0039MnYb0qxYhV / media_mid 003Qui1q2u1Zho），但存下来的
 * 歌曲没有该字段，LX 脚本只能拿 songmid 顶替媒体 ID，拼出的文件名会被 QQ CDN
 * 判 403。播放时按 songmid 查一次歌曲详情即可补齐，不依赖账号权限。
 *
 * 只缓存成功结果；网络失败不写缓存，下次播放仍可重试。
 */

const cache = new Map<string, TxTrackMeta | undefined>();
const inflight = createSharedRequestPool<TxTrackMeta | undefined>();

async function requestMeta(songmid: string, signal: AbortSignal): Promise<TxTrackMeta | undefined> {
  const meta = await fetchTxTrackMeta(songmid, async (url, init) => {
    const response = await tauriFetch(url, {
      signal,
      method: init.method,
      headers: init.headers,
      body: init.body,
    });
    if (!response.ok) {
      throw new Error(`QQ Music request failed: ${response.status}`);
    }
    return response.json();
  });
  throwIfAborted(signal);
  cache.set(songmid, meta);
  return meta;
}

function getMeta(songmid: string, signal?: AbortSignal): Promise<TxTrackMeta | undefined> {
  if (cache.has(songmid)) return Promise.resolve(cache.get(songmid));
  return inflight.run(songmid, async producerSignal => {
    try { return await requestMeta(songmid, producerSignal); }
    catch (error) {
      throwIfAborted(producerSignal);
      debugLog(`[txMeta] 歌曲详情查询失败 ${songmid}: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }, signal);
}

/**
 * 返回补齐后的歌曲；无需补齐或补齐失败时原样返回。
 *
 * 调用方提供生命周期；同曲共享请求只有在最后一位消费者退出后才取消。
 */
export async function hydrateTxTrackMeta(music: MusicInfo, signal?: AbortSignal): Promise<MusicInfo> {
  if (music.source !== 'tx' || !music.id || music.txMeta?.strMediaMid) return music;
  const meta = await getMeta(music.id, signal);
  if (!meta) return music;
  return { ...music, txMeta: { ...music.txMeta, ...meta } };
}

/** 测试用：清空进程内缓存。 */
export function resetTxTrackMetaCache(): void {
  cache.clear();
  inflight.clear();
}
