import {
  createListeningSession, sampleListeningSession, seekListeningSession as resetSample,
  LISTENING_CHECKPOINT_MS, createListenTracker,
  type ListenTracker, type ListeningSession, type MusicInfo,
} from '@lx/core';
import { useHistoryStore } from '@/stores/historyStore';
import { usePlaybackSettingsStore } from '@/stores/playbackSettingsStore';
import { reportListeningStatsError, useListeningStatsStore } from '@/stores/listeningStatsStore';
import { logger } from '@/services/logger';
import { scrobbleWySong } from './wyScrobbleService';

let session: ListeningSession | null = null;
let currentSong: MusicInfo | null = null;
let historyTracker: ListenTracker | null = null;
let checkpointAt = 0;
let sequence = 0;
const now = () => performance.now();

function checkpoint(): void {
  if (session?.event.listenedMs) useListeningStatsStore.getState().record(session.event);
}

/** 原生播放提交成功新建会话；暂停恢复沿用会话，同曲循环独立计次。 */
export function startListeningSession(song: MusicInfo, initialPosition = 0, rate = 1, at = now()): void {
  if (session) resetListeningSession();
  const startedAt = Date.now();
  session = createListeningSession(`${startedAt}-${++sequence}-${Math.random().toString(36).slice(2)}`, song, startedAt,
    { at, position: initialPosition, playing: true, rate });
  currentSong = song;
  checkpointAt = at;
  historyTracker = createListenTracker({ durationSeconds: song.interval ?? 0 });
}

export function onPlaybackProgress(position: number, playing: boolean, rate = 1, at = now()): void {
  if (!session || !currentSong) return;
  const wasPlaying = session.sample.playing;
  const mediaDelta = position - session.sample.position;
  const previousListened = session.event.listenedMs;
  session = sampleListeningSession(session, { at, position, playing, rate });
  // 最近播放与打点继续沿用媒体进度阈值；独立事件才使用真实经过时间。
  historyTracker?.accumulate(mediaDelta, playing && session.event.listenedMs > previousListened);
  if (historyTracker?.checkAndRecord()) {
    void useHistoryStore.getState().addToHistory(currentSong).catch(error => logger.error('播放历史写入失败', error));
    if (usePlaybackSettingsStore.getState().enableScrobble && currentSong.source === 'wy') {
      void scrobbleWySong({ songId: currentSong.id, durationSeconds: historyTracker.getAccumulated() })
        .catch(error => logger.warn('网易云听歌打点失败', error));
    }
  }
  if (at - checkpointAt >= LISTENING_CHECKPOINT_MS || (wasPlaying && !playing)) {
    checkpointAt = at;
    void flushListeningSession().catch(reportListeningStatsError);
  }
}

/** 由显式 seek 调用，跳转距离永不记入收听。 */
export function seekListeningSession(position: number, playing: boolean, rate = 1, at = now()): void {
  if (session) session = resetSample(session, { at, position, playing, rate });
}

export async function flushListeningSession(): Promise<void> {
  checkpoint();
  await useListeningStatsStore.getState().flush();
}

export function resetListeningSession(): void {
  checkpoint();
  session = null;
  currentSong = null;
  historyTracker = null;
  void useListeningStatsStore.getState().flush().catch(reportListeningStatsError);
}
