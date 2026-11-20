import { fetchTxTrackMeta, type MusicInfo, type TxTrackMeta } from "@lx/core";
import { logger } from "@/services/logger";
import { fetchWithTimeout } from "@/utils/fetchWithTimeout";

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

const METADATA_REQUEST_TIMEOUT_MS = 4_000;

const cache = new Map<string, TxTrackMeta | undefined>();
const inflight = new Map<string, Promise<TxTrackMeta | undefined>>();

async function requestMeta(songmid: string): Promise<TxTrackMeta | undefined> {
  const meta = await fetchTxTrackMeta(songmid, async (url, init) => {
    const response = await fetchWithTimeout(
      url,
      {
        method: init.method,
        headers: init.headers,
        body: init.body,
      },
      METADATA_REQUEST_TIMEOUT_MS,
    );
    if (!response.ok) {
      throw new Error(`QQ 音乐歌曲详情请求失败: ${response.status}`);
    }
    return response.json();
  });
  cache.set(songmid, meta);
  return meta;
}

function getMeta(songmid: string): Promise<TxTrackMeta | undefined> {
  if (cache.has(songmid)) return Promise.resolve(cache.get(songmid));
  const pending = requestMeta(songmid).catch((error: unknown) => {
    logger.debug(
      `[txMeta] 歌曲详情查询失败 ${songmid}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  });
  inflight.set(songmid, pending);
  void pending.finally(() => {
    if (inflight.get(songmid) === pending) inflight.delete(songmid);
  });
  return pending;
}

/**
 * 返回补齐后的歌曲；无需补齐或补齐失败时原样返回。
 *
 * 调用方负责加超时（播放解析预算不应被歌曲详情请求吃住）；超时后请求会在
 * 后台完成并写入缓存，下一次播放直接命中。
 */
export async function hydrateTxTrackMeta(music: MusicInfo): Promise<MusicInfo> {
  if (music.source !== "tx" || !music.id || music.txMeta?.strMediaMid) return music;
  const pending = inflight.get(music.id) ?? getMeta(music.id);
  const meta = await pending;
  if (!meta) return music;
  return { ...music, txMeta: { ...music.txMeta, ...meta } };
}
