import type { MusicInfo } from '@lx/core';

export type PlaybackBackendId = 'builtinNetease' | 'customSource';

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
}

export interface PlaybackResolvedUrl {
  url: string;
  music: MusicInfo;
  quality: string;
  backend: PlaybackBackendId;
  resolverName: string;
  trace: PlaybackAttempt[];
}

export interface PlaybackBackend {
  id: PlaybackBackendId;
  name: string;
  resolve(request: PlaybackRequest): Promise<PlaybackResolvedUrl>;
}
