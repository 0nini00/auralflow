import { buildBuiltinMusicApiUrl, type MusicInfo } from '@lx/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import { fetchBuiltinMusicApiText } from '@/services/builtinMusicApiClient';
import {
  adoptedMatchCandidateId,
  fetchNeteaseJson,
  searchNeteaseMatch,
  type LocalMatchResult,
} from '@/services/localMediaMatch';
import { cacheCoverForMusic, lookupCachedCoverPath } from '@/services/mediaCache';

/**
 * 本地曲封面自动匹配。
 *
 * 本地曲的封面今天只有两条来源：扫描时落盘的内嵌封面（local_audio.rs 无条件 persist）与用户
 * 手动指定的 coverOverride；旁挂图片（folder.jpg 之类）不读，平台封面此前也没有。这就是
 * 「有词无图」的成因——本模块补上平台那一条：搜到/已知网易歌曲 id → 取封面地址 → 落进
 * 与其它封面共用的磁盘缓存键，播放条、沉浸页、系统媒体控制因此都走既有展示链路。
 *
 * 地址来源是「官方 song/detail 为主、gdstudio 网关 pic 为兜底」，顺序由实测定：
 *  - 官方 detail 的 `songs[0].album.picUrl` 用同一批 4 个 id 取图 4/4 全部 200；
 *  - 网关 pic 同一批 4/4 都没有 url；此前唯一返回过一次的地址图床直接 404（NoSuchKey）——
 *    那是把歌曲 id 当文件名拼出来的假地址。
 * 所以 `fetchGatewayCoverUrl` 只作兜底保留（其既有用例继续钉住它自己的行为）。
 *
 * 触发点有两个，语义一致且共用并发去重：
 *  - 播放本地曲时（playerStore）：缓存命中立即回填，未命中就后台按需搜一次并当场回填；
 *  - 歌词匹配成功时（lyricsService）：已知候选 id 的顺路提前触发，不重复搜索。
 *
 * 取地址、搜索、落盘/查盘都是 IO，一律依赖注入：单测里必须能整体替换掉。
 */
export interface LocalCoverMatchDeps {
  /** 官方 song/detail 的 JSON 直取（默认复用 localMediaMatch 里带 Referer 的实现）。 */
  fetchJson?: (url: string) => Promise<any>;
  /** 网关 pic 兜底链路取文本。 */
  fetchText?: (url: string) => Promise<string>;
  cacheCover?: (music: MusicInfo, coverUrl: string) => Promise<string | null>;
  lookupCoverPath?: (music: MusicInfo) => Promise<string | null>;
  toAssetUrl?: (path: string) => string;
  /** 搜平台并判定（默认走 localMediaMatch 的网易搜索）；单测里整体替换。 */
  searchMatch?: (music: MusicInfo) => Promise<{ match: LocalMatchResult | null; candidates: MusicInfo[] }>;
}

function isHttpUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}

/** 本地曲判定：扫描入库的 source 是 local，队列/歌词两侧的构造方式不完全一致，isLocal 同样算数。 */
function isLocalMusic(music: MusicInfo): boolean {
  return music.source === 'local' || music.isLocal === true;
}

function musicKey(music: MusicInfo): string {
  return `${music.source}:${music.id}`;
}

/** 网关 pic 接口的尺寸档位，与沉浸页取的是同一档。 */
const GATEWAY_PIC_SIZE = 500;

/**
 * 【兜底】用网易歌曲 id 向 gdstudio 网关换封面地址（顶层 url 字段）。
 *
 * 实测（同一台机器、同一批 4 个 id）：网关 4/4 都没有 url；唯一返回过一次的地址是
 * `p2.music.126.net/<hash>/<歌曲id>.jpg?param=500y500`，图床直接 404（`NoSuchKey`，
 * 对象根本不存在）——等于把歌曲 id 当文件名拼出来的假地址。所以它只作兜底，
 * 主路径是 fetchNeteaseCoverUrl 里的官方 song/detail。
 *
 * 响应不合法（非 JSON / 无 url / 非 http）一律返回 null 并记 console，
 * 绝不把异常抛给调用方 —— 调用方是播放/歌词链路，封面失败不能被判成播放或歌词失败。
 */
export async function fetchGatewayCoverUrl(
  songId: string,
  deps: LocalCoverMatchDeps = {},
): Promise<string | null> {
  const id = songId?.trim();
  if (!id) return null;

  const fetchText = deps.fetchText ?? fetchBuiltinMusicApiText;
  try {
    const text = await fetchText(buildBuiltinMusicApiUrl({
      type: 'pic',
      source: 'netease',
      id,
      size: GATEWAY_PIC_SIZE,
    }));
    const coverUrl = (JSON.parse(text) as { url?: unknown } | null)?.url;
    if (!isHttpUrl(coverUrl)) {
      console.warn(`[local-cover] 网关未返回可用封面地址: ${text.slice(0, 180)}`);
      return null;
    }
    return coverUrl;
  } catch (error) {
    console.warn('[local-cover] 获取封面地址失败', error);
    return null;
  }
}

/** 官方 song/detail 的封面字段位置：新接口 `songs[0].album.picUrl`，老接口 `songs[0].al.picUrl`。 */
async function fetchOfficialCoverUrl(id: string, deps: LocalCoverMatchDeps): Promise<string | null> {
  const fetchJson = deps.fetchJson ?? fetchNeteaseJson;
  try {
    const detail = await fetchJson(
      `https://music.163.com/api/song/detail?ids=${encodeURIComponent(JSON.stringify([id]))}`,
    );
    const raw = detail?.songs?.[0]?.album?.picUrl ?? detail?.songs?.[0]?.al?.picUrl;
    const url = typeof raw === 'string' ? raw.trim() : '';
    if (!url) return null;
    // 实测偶有 http 地址：图床 https 同样可用，直接升级，避免应用内混合内容
    const httpsUrl = url.startsWith('http://') ? `https://${url.slice('http://'.length)}` : url;
    return isHttpUrl(httpsUrl) ? httpsUrl : null;
  } catch (error) {
    console.warn('[local-cover] 官方封面接口失败', error);
    return null;
  }
}

/**
 * 取封面地址：官方 song/detail 为主，网关 pic 兜底。
 *
 * 两步都各自吞异常、都失败才返回 null 并记一条 console；**不记负缓存** ——
 * 接口抖动/限流不该让一首歌在本次会话里永久失去封面，下次播放仍要能重试。
 */
export async function fetchNeteaseCoverUrl(
  songId: string,
  deps: LocalCoverMatchDeps = {},
): Promise<string | null> {
  const id = songId?.trim();
  if (!id) return null;

  const official = await fetchOfficialCoverUrl(id, deps);
  if (official) return official;

  const gateway = await fetchGatewayCoverUrl(id, deps);
  if (gateway) return gateway;

  console.warn(`[local-cover] 未取到封面地址: id=${id}`);
  return null;
}

/**
 * 会话级负缓存：已确认「搜过平台、但没有任何可用候选」的曲目（键 `source:id`）。
 *
 * 只记这种确定性结论：接口挂了/网关失败都不记，下次播放仍要能重试（弱网下的常见情形）。
 */
const noCandidateKeys = new Set<string>();

/** 同一首的并发触发（播放路径 + 歌词路径可能同时来）只跑一次，避免重复搜索与重复下载。 */
const inFlight = new Map<string, Promise<string | null>>();

/**
 * 为本地曲取一张自动匹配封面，返回可直接展示的 asset 地址（没有就 null）。
 *
 * 顺序：磁盘缓存 → （只有缺 id 时才搜平台）→ 官方 song/detail 换地址（网关兜底）→ 落盘回填地址。
 * 有内嵌/手动封面的曲目直接 null，一张网络请求都不发。
 */
export function matchLocalCover(
  music: MusicInfo,
  songId?: string,
  deps: LocalCoverMatchDeps = {},
): Promise<string | null> {
  if (!isLocalMusic(music)) return Promise.resolve(null);
  // 有内嵌封面或手动 coverOverride（已写进 picUrl）就不该打网络，更不能覆盖用户的选择
  if (music.picUrl || music.img) return Promise.resolve(null);

  const key = musicKey(music);
  const running = inFlight.get(key);
  if (running) return running;

  const task = runMatch(music, key, songId, deps);
  const tracked = task.finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, tracked);
  return tracked;
}

async function runMatch(
  music: MusicInfo,
  key: string,
  songId: string | undefined,
  deps: LocalCoverMatchDeps,
): Promise<string | null> {
  // 1) 缓存命中立刻返回：不搜平台、不重复下载（歌词路径显式带 id 时也只走这一步）
  const cached = await lookupCachedAsset(music, deps);
  if (cached) return cached;

  // 2) 没有现成 id 才搜索；「搜到过但无可用候选」是确定性结论，本次会话不再重复搜
  let id = songId?.trim() || undefined;
  if (!id) {
    if (noCandidateKeys.has(key)) return null;
    let found: string | undefined;
    try {
      const { match } = await (deps.searchMatch ?? searchNeteaseMatch)(music);
      found = adoptedMatchCandidateId(match);
    } catch (error) {
      // 搜索失败（网络/接口异常）不记负缓存：下次播放还得能重试
      console.warn('[local-cover] 搜索匹配失败', error);
      return null;
    }
    if (!found) {
      noCandidateKeys.add(key);
      return null;
    }
    id = found;
  }

  // 3) 官方 song/detail（主）→ 网关 pic（兜底）；两步都失败也不记负缓存（接口抖动不该让一首歌永久没封面）
  const coverUrl = await fetchNeteaseCoverUrl(id, deps);
  if (!coverUrl) return null;

  return cacheCoverAsset(music, coverUrl, deps);
}

async function lookupCachedAsset(music: MusicInfo, deps: LocalCoverMatchDeps): Promise<string | null> {
  try {
    const path = await (deps.lookupCoverPath ?? lookupCachedCoverPath)(music);
    return path ? (deps.toAssetUrl ?? convertFileSrc)(path) : null;
  } catch {
    // 查缓存失败按「没有封面」处理，继续走后面的搜索/下载
    return null;
  }
}

async function cacheCoverAsset(
  music: MusicInfo,
  coverUrl: string,
  deps: LocalCoverMatchDeps,
): Promise<string | null> {
  try {
    return await (deps.cacheCover ?? cacheCoverForMusic)(music, coverUrl);
  } catch {
    return null;
  }
}
