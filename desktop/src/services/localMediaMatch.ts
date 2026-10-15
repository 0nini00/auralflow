import {
  hasOriginalPerformerCandidate,
  selectLocalMediaMatch,
  type LocalMatchResult,
  type MusicInfo,
} from '@lx/core';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

/** 对外再从本模块引出判定结果类型，调用方（封面匹配）不必同时依赖 @lx/core。 */
export type { LocalMatchResult };

/**
 * 本地曲 ↔ 网易云平台的公共匹配层。
 *
 * 歌词匹配与封面匹配要做的是同一件事：按「曲名 + 歌手」搜网易云，再交给 @lx/core 的
 * selectLocalMediaMatch 判定。判定规则只能有一份，所以搜索/映射/判定整体收在这里，
 * 两条路径共用（实现与拆分前逐字一致，行为未变）。
 *
 * 这里不吞异常：网络失败是「这次没搜到」还是「接口挂了」，由调用方决定要不要重试/记负缓存。
 */
export interface LocalMatchSearchDeps {
  fetchJson?: (url: string) => Promise<any>;
}

/** 与歌词路径一致：一次召回 8 条候选。 */
export const SEARCH_LIMIT = 8;

/** 网易云老版搜索接口(/api/search/get/web)的条目形态。 */
export interface NeteaseSearchSong {
  id: string | number;
  name?: string;
  /** 老版 web 接口用 artists/album/duration，新接口用 ar/al/dt；两种都兼容。 */
  artists?: Array<{ name?: string }>;
  ar?: Array<{ name?: string }>;
  album?: { name?: string };
  al?: { name?: string };
  duration?: number;
  dt?: number;
}

/** 搜索条目 → 统一 MusicInfo；id 保持原样，便于反查歌词接口。 */
export function toNeteaseMusicInfo(song: NeteaseSearchSong): MusicInfo {
  const artists = song.artists ?? song.ar ?? [];
  const durationMs = song.duration ?? song.dt;
  return {
    id: String(song.id),
    name: song.name ?? '',
    // 多歌手用 / 连接，与其它来源写入 MusicInfo.singer 的写法一致
    singer: artists.map((artist) => artist.name?.trim()).filter(Boolean).join('/'),
    albumName: song.album?.name ?? song.al?.name ?? '',
    // 接口给的是毫秒，MusicInfo.interval 是秒
    interval: typeof durationMs === 'number' && Number.isFinite(durationMs) ? durationMs / 1000 : undefined,
    source: 'wy',
  };
}

/** 网易云接口的 JSON 直取（带 Referer，接口对无 Referer 的请求会拒）。 */
export async function fetchNeteaseJson(url: string): Promise<any> {
  const response = await tauriFetch(url, {
    method: 'GET',
    headers: { Referer: 'https://music.163.com' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

/**
 * 搜平台并按 @lx/core 的规则判定，返回判定结果与召回候选（候选供歌词路径继续挑词）。
 *
 * 失败/无召回复 `match: null`：显式失败（召回里没有同一录音组）由调用方按未匹配处理 ——
 * 宁可没有，也不能把别人的演唱版本静默套到本地曲上。
 */
export async function searchNeteaseMatch(
  music: MusicInfo,
  deps: LocalMatchSearchDeps = {},
): Promise<{ match: LocalMatchResult | null; candidates: MusicInfo[] }> {
  const keyword = `${music.name} ${music.singer}`.trim();
  if (!keyword) return { match: null, candidates: [] };

  const fetchJson = deps.fetchJson ?? fetchNeteaseJson;
  const searchUrl = `https://music.163.com/api/search/get/web?s=${encodeURIComponent(keyword)}&type=1&limit=${SEARCH_LIMIT}`;
  const searchData = await fetchJson(searchUrl);
  // 与拆分前逐字一致：回包不是对象时直接抛给调用方（不吞异常），由调用方决定失败语义
  const songs = (searchData.result?.songs || []) as NeteaseSearchSong[];
  if (songs.length === 0) return { match: null, candidates: [] };

  // 判定权在 @lx/core：直接搜平台召回的同名不同曲/别人的翻唱太多，
  // 只接受两种结论——同一录音，或已证实原唱不可得的同曲异唱。
  const candidates = songs.map(toNeteaseMusicInfo);
  const match = selectLocalMediaMatch(music, candidates, {
    originalPerformerUnavailable: !hasOriginalPerformerCandidate(music, candidates),
  });
  return { match, candidates };
}

/** 被采用的候选 id（同录音档取录音组代表条，异唱档只含被采用的那条）。 */
export function adoptedMatchCandidateId(match: LocalMatchResult | null): string | undefined {
  if (match?.status !== 'matched' || !match.tier) return undefined;
  return match.candidates[0]?.id;
}
