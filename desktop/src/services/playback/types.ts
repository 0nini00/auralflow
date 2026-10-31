import type { MusicInfo } from '@lx/core';

export type PlaybackBackendId = 'builtinNetease' | 'builtinProvider' | 'customSource' | 'hiddenSource';

export interface PlaybackAttempt {
  backend: PlaybackBackendId;
  resolverName: string;
  source: MusicInfo['source'];
  quality: string;
  status: 'success' | 'failed';
  error?: string;
}

export interface PlaybackRequest {
  primary: MusicInfo;
  variants?: MusicInfo[];
  qualityPreference: string[];
  /** 本次解析的绝对截止时间（Date.now() 时间戳），后端据此给探活/媒体缓存留余量。 */
  deadlineAt?: number;
}

export interface PlaybackResolvedUrl {
  url: string;
  music: MusicInfo;
  quality: string;
  backend: PlaybackBackendId;
  resolverName: string;
  fromCache?: boolean;
  cacheKey?: string;
  /** 命中的持久化条目写入时间；仅 fromCache 时有值，用于判断远端签名地址是否该重新验证。 */
  cachedAt?: number;
  trace: PlaybackAttempt[];
  /**
   * 同一轮竞速里已经结算、但没有胜出的候选（按音质降序 → 源序升序）。
   *
   * 胜出地址探活被服务端明确拒绝（403/404）时，调用方按序回退即可，
   * 不必把整轮结果丢掉从零重来。只有自定义源会填这个字段。
   */
  fallbacks?: PlaybackResolvedUrl[];
}

export interface PlaybackBackend {
  id: PlaybackBackendId;
  name: string;
  resolve(request: PlaybackRequest): Promise<PlaybackResolvedUrl>;
}
