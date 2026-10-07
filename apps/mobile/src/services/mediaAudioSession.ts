import { AppState } from "react-native";
import TrackPlayer, { Event, State } from "react-native-track-player";

import { usePlayerStore } from "@/stores/playerStore";
import { logger } from "@/services/logger";
import {
  getCurrentPlaybackRequestId,
  isCurrentPlaybackRequest,
  subscribePlaybackRequest,
} from "@/services/playbackRequest";

export interface MediaAudioSession {
  start(): Promise<boolean>;
  close(resume?: boolean): Promise<void>;
}

async function readNativePlayback() {
  const [track, index, playback, playWhenReady] = await Promise.all([
    TrackPlayer.getActiveTrack(),
    TrackPlayer.getActiveTrackIndex(),
    TrackPlayer.getPlaybackState(),
    TrackPlayer.getPlayWhenReady(),
  ]);
  return { track, index, state: playback.state, playWhenReady };
}

type NativePlayback = Awaited<ReturnType<typeof readNativePlayback>>;

function sameTrack(before: NativePlayback, after: NativePlayback): boolean {
  return before.track != null && after.track != null &&
    before.track.id === after.track.id &&
    before.track.url === after.track.url &&
    before.index === after.index;
}

/** 短媒体只借用音频播放权；恢复只原地 play，不解析歌曲或改动原生队列。 */
export function createMediaAudioSession(onInterrupted: () => void): MediaAudioSession {
  let requestId = getCurrentPlaybackRequestId();
  let claimingPause = false;
  let closed = false;
  let interrupted = false;
  let resumeAllowed = true;
  let pausedBySession = false;
  let snapshot: NativePlayback | undefined;
  let songUrl: string | null = null;
  let startPromise: Promise<boolean> | undefined;
  let closePromise: Promise<void> | undefined;
  const cleanups: Array<() => void> = [];

  function dispose() {
    for (const cleanup of cleanups.splice(0)) cleanup();
  }

  function ownsPlayback() {
    return !interrupted && isCurrentPlaybackRequest(requestId) && AppState.currentState === "active";
  }

  function canStart() {
    return !closed && ownsPlayback();
  }

  function canResume() {
    return resumeAllowed && pausedBySession && ownsPlayback() &&
      songUrl != null && usePlayerStore.getState().currentUrl === songUrl;
  }

  function interrupt() {
    if (interrupted) return;
    interrupted = true;
    resumeAllowed = false;
    try {
      onInterrupted();
    } catch (error) {
      logger.error("短媒体中断回调失败", error);
    }
    void close(false).catch((error) => logger.error("短媒体中断清理失败", error));
  }

  cleanups.push(subscribePlaybackRequest(() => {
    const current = getCurrentPlaybackRequestId();
    // store.pause 同步认领一次播放意图；只忽略这一次，不能忽略整个 await 窗口。
    if (claimingPause && current === requestId + 1) {
      requestId = current;
      claimingPause = false;
      return;
    }
    if (current !== requestId) interrupt();
  }));
  const appSubscription = AppState.addEventListener("change", (state) => {
    if (state !== "active") interrupt();
  });
  cleanups.push(() => appSubscription.remove());
  const duckSubscription = TrackPlayer.addEventListener(Event.RemoteDuck, ({ paused, permanent }) => {
    if (paused || permanent) interrupt();
  });
  cleanups.push(() => duckSubscription.remove());
  // RNTP 的 RemotePause 也涵盖耳机断开导致的暂停；Video 自身焦点事件由 UI close(false) 收口。
  for (const event of [Event.RemotePause, Event.RemoteStop, Event.PlaybackActiveTrackChanged] as const) {
    const subscription = TrackPlayer.addEventListener(event, interrupt);
    cleanups.push(() => subscription.remove());
  }

  function pauseSong(): Promise<void> {
    claimingPause = true;
    try {
      return usePlayerStore.getState().pause();
    } finally {
      claimingPause = false;
    }
  }

  async function runStart(): Promise<boolean> {
    if (!canStart()) {
      if (!closed) interrupt();
      return false;
    }
    snapshot = await readNativePlayback();
    if (!canStart()) return false;
    const wasPlaying = snapshot.state === State.Playing ||
      (snapshot.state === State.Buffering && snapshot.playWhenReady);
    if (!wasPlaying && !snapshot.playWhenReady) return true;
    if (snapshot.track == null || snapshot.index == null ||
        typeof snapshot.track.id !== "string" || typeof snapshot.track.url !== "string") {
      throw new Error("无法确认待暂停歌曲的原生播放信息");
    }
    songUrl = usePlayerStore.getState().currentUrl;
    await pauseSong();
    pausedBySession = wasPlaying;
    if (!canStart()) return false;
    const stillPlaying = await TrackPlayer.getPlayWhenReady();
    if (!canStart()) return false;
    if (stillPlaying) throw new Error("歌曲未能暂停，无法开始短媒体播放");
    return true;
  }

  function start(): Promise<boolean> {
    if (closed) return Promise.resolve(false);
    // 先发布 Promise 再执行，保证同步中断/close 能等待正在开始的暂停操作。
    startPromise ??= Promise.resolve().then(runStart).catch((error) => {
      dispose();
      throw error;
    });
    return startPromise;
  }

  async function stopCancelledRestore() {
    // play 已发出后后台/close(false)到达，需要撤回自己的播放；新用户意图则绝不覆盖。
    if (!snapshot || !isCurrentPlaybackRequest(requestId)) return;
    const current = await readNativePlayback();
    if (!isCurrentPlaybackRequest(requestId) || !sameTrack(snapshot, current)) return;
    await pauseSong();
  }

  async function restore() {
    if (startPromise) await startPromise;
    if (!canResume() || !snapshot) return;
    const current = await readNativePlayback();
    if (!canResume() || !sameTrack(snapshot, current)) return;
    if (current.playWhenReady || current.state !== State.Paused) return;
    // 不走 store.resume：它在 currentUrl 丢失时会重新解析并重建队列。
    await TrackPlayer.play();
    if (!canResume()) return stopCancelledRestore();
    const playback = await TrackPlayer.getPlaybackState();
    if (!canResume()) return stopCancelledRestore();
    usePlayerStore.getState().syncPlayerState(playback.state);
  }

  function close(resume = true): Promise<void> {
    closed = true;
    // 后续 close(false) 只能撤销尚在等待的恢复，不能重新执行或重新授予恢复权。
    resumeAllowed = resumeAllowed && resume;
    closePromise ??= Promise.resolve().then(restore).finally(dispose);
    return closePromise;
  }

  return { start, close };
}
