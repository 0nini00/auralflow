import type { MusicInfo } from "@lx/core";
import { createListenTracker, type ListenTracker } from "@lx/core";
import { useHistoryStore } from "@/stores/historyStore";
import { usePlaybackSettingsStore } from "@/stores/playbackSettingsStore";
import { scrobbleWySong } from "./wyScrobbleService";

let currentTracker: ListenTracker | null = null;
let currentSong: MusicInfo | null = null;
let lastPosition = 0;

/**
 * 当一首新歌开始播放时，启动听歌时长/比例追踪器。
 * 满足 2 分钟或 50% 播放条件后，才写入播放历史与网易云听歌打点。
 */
export function startListeningSession(song: MusicInfo, initialPosition = 0): void {
  currentSong = song;
  lastPosition = initialPosition;
  const durationSeconds = song.interval && song.interval > 0 ? song.interval : 0;
  currentTracker = createListenTracker({ durationSeconds });
}

/**
 * 接收播放进度更新事件（0.25s 间隔）。
 * 计算相邻步进差值，累加连续播放时间并在达到阈值时原子触发记录。
 */
export function onPlaybackProgress(position: number, isPlaying: boolean): void {
  if (!currentTracker || !currentSong) return;

  const delta = position - lastPosition;
  lastPosition = position;

  currentTracker.accumulate(delta, isPlaying);

  if (currentTracker.checkAndRecord()) {
    const songToRecord = currentSong;
    const accumulated = currentTracker.getAccumulated();

    // 1. 写入本地历史记录
    void useHistoryStore.getState().addToHistory(songToRecord);

    // 2. 若为网易云曲目且打点开关开启，执行异步听歌打点
    const enableScrobble = usePlaybackSettingsStore.getState().enableScrobble;
    if (enableScrobble && songToRecord.source === "wy") {
      void scrobbleWySong({
        songId: songToRecord.id,
        durationSeconds: accumulated,
      });
    }
  }
}

/**
 * 重置当前听歌会话（切歌、停播或播放失败时）。
 */
export function resetListeningSession(): void {
  if (currentTracker) {
    currentTracker.reset();
  }
  currentTracker = null;
  currentSong = null;
  lastPosition = 0;
}
