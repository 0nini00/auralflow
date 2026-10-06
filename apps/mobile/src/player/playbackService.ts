import { DeviceEventEmitter } from "react-native";
import TrackPlayer, { Event, State, type EventPayloadByEvent } from "react-native-track-player";
import {
  cancelPendingPlayback, invalidatePrefetchForSong, playFromQueue, playNext,
  playPrevious, playSong, prefetchUpcomingSongNearEnd,
} from "../services/playerService";
import { getCurrentPlaybackRequestId, isCurrentPlaybackRequest } from "@/services/playbackRequest";
import { logger } from "@/services/logger";
import { invalidateCachedPlaybackUrl } from "@/services/playbackUrlCache";
import { getAudioInterruptionAction } from "@/services/audioInterruptionPolicy";
import { getNextQueueNavigationState } from "@/services/queueNavigationModel";
import {
  decidePlaybackFailureAction, hasReachedAutoSkipLimit, MAX_CONSECUTIVE_AUTO_SKIPS,
  noteAutomaticSkip, resetPlaybackFailures,
} from "@/services/playbackFailurePolicy";
import { usePlaybackSettingsStore } from "@/stores/playbackSettingsStore";
import {
  setupPlayerListeners, shouldAttributePlaybackErrorToCurrentSong, SILENCE_GAP_TRACK_ID, usePlayerStore,
} from "@/stores/playerStore";

declare const module: { exports: any };
const SERVICE_DESTROYED_EVENT = "auralflow-playback-service-destroyed";
interface PlaybackServiceSession {
  id: string;
  completion: Promise<void>;
  close: () => void;
}
interface RecoveryOperation {
  requestId: number;
  nativeError: Error | null;
}
let activeService: PlaybackServiceSession | null = null;

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function currentSongKey(): string | null {
  const song = usePlayerStore.getState().currentSong;
  return song ? `${song.source}:${song.id}` : null;
}

export default async function playbackService(data: { serviceId: string }): Promise<void> {
  if (!data || typeof data.serviceId !== "string" || !data.serviceId.trim()) {
    throw new Error("后台播放服务缺少实例标识，请安装包含最新原生补丁的应用");
  }
  if (activeService?.id === data.serviceId) return activeService.completion;
  activeService?.close();
  const subscriptions: { remove: () => void }[] = [];
  let recovery: RecoveryOperation | null = null;
  let chainRequestId = getCurrentPlaybackRequestId();
  let handledNativeRequest: number | null = null;
  let terminalRequest: number | null = null;
  let finish!: () => void;
  const completion = new Promise<void>((resolve) => { finish = resolve; });
  const session: PlaybackServiceSession = {
    id: data.serviceId,
    completion,
    close: () => {
      if (activeService !== session) return;
      activeService = null;
      recovery = null;
      resetPlaybackFailures();
      subscriptions.forEach((subscription) => subscription.remove());
      cancelPendingPlayback();
      finish();
      logger.info("后台播放服务已结束", session.id);
    },
  };
  activeService = session;
  resetPlaybackFailures();
  subscriptions.push(DeviceEventEmitter.addListener(SERVICE_DESTROYED_EVENT, (event: { serviceId?: string }) => {
    if (event?.serviceId === session.id) session.close();
  }));

  function owns(operation: RecoveryOperation): boolean {
    return activeService === session && recovery === operation && isCurrentPlaybackRequest(operation.requestId);
  }

  async function hasNativePlaybackIntent(requestId: number): Promise<boolean> {
    if (activeService !== session || !isCurrentPlaybackRequest(requestId)) return false;
    // 原生意图是唯一依据：暂停期间迟到的 gap/ended/error 不得创建新的播放。
    const playWhenReady = await TrackPlayer.getPlayWhenReady();
    return activeService === session && isCurrentPlaybackRequest(requestId) && playWhenReady;
  }

  function syncExternalIntent(): void {
    const requestId = getCurrentPlaybackRequestId();
    if (requestId === chainRequestId) return;
    recovery = null;
    handledNativeRequest = null;
    terminalRequest = null;
    resetPlaybackFailures();
    chainRequestId = requestId;
  }

  function report(error: unknown): void {
    const message = failureMessage(error);
    logger.warn("后台播放失败", message);
    usePlayerStore.setState({ error: message, loading: false });
  }

  // 所有媒体回调在此接住拒绝；不能把通知栏命令错误遗留成 unhandled rejection。
  function listen<T extends Event>(event: T, listener: (payload: EventPayloadByEvent[T]) => void | Promise<void>) {
    const callback = async (payload: EventPayloadByEvent[Event]) => {
      if (activeService !== session) return;
      let requestId = getCurrentPlaybackRequestId();
      try {
        const pending = listener(payload as EventPayloadByEvent[T]);
        requestId = getCurrentPlaybackRequestId();
        await pending;
      } catch (error) {
        if (activeService === session && isCurrentPlaybackRequest(requestId)) report(error);
      }
    };
    const subscription = TrackPlayer.addEventListener<Event>(event, callback);
    subscriptions.push(subscription);
    return subscription;
  };

  async function runCommand(
    action: () => Promise<void>,
    { cancelPlayback = true }: { cancelPlayback?: boolean } = {},
  ): Promise<void> {
    recovery = null;
    handledNativeRequest = null;
    terminalRequest = null;
    resetPlaybackFailures();
    if (cancelPlayback) cancelPendingPlayback();
    const pending = action();
    chainRequestId = getCurrentPlaybackRequestId();
    await pending;
  }

  async function invoke(operation: RecoveryOperation, action: () => Promise<void>): Promise<void> {
    if (!owns(operation) || !await hasNativePlaybackIntent(operation.requestId) || !owns(operation)) return;
    operation.nativeError = null;
    let pending: Promise<void>;
    try {
      // 播放入口同步认领意图；其后异步步骤不得用用户的新意图替换本操作所有权。
      pending = action();
    } finally {
      operation.requestId = getCurrentPlaybackRequestId();
      chainRequestId = operation.requestId;
    }
    await pending;
  }

  async function stopAfterFailure(operation: RecoveryOperation, message: string): Promise<void> {
    if (!owns(operation)) return;
    terminalRequest = operation.requestId;
    handledNativeRequest = operation.requestId;
    report(message);
    usePlayerStore.setState({ isPlaying: false });
    try {
      await TrackPlayer.stop();
    } catch (error) {
      if (owns(operation)) report(`${message}（停止播放失败：${failureMessage(error)}）`);
    }
  }

  async function recoverFailure(operation: RecoveryOperation, initialError: unknown, nativeFailure: boolean): Promise<void> {
    let error = initialError;
    let shouldRetry = nativeFailure;
    while (owns(operation)) {
      if (!await hasNativePlaybackIntent(operation.requestId) || !owns(operation)) return;
      const song = usePlayerStore.getState().currentSong;
      if (!song) return;
      if (shouldRetry && decidePlaybackFailureAction(`${song.source}:${song.id}`) === "retry") {
        logger.warn("原生播放失败，重解析一次", failureMessage(error));
        try {
          await invalidateCachedPlaybackUrl(song);
          if (!owns(operation)) return;
          invalidatePrefetchForSong(song);
          const { queue, currentIndex } = usePlayerStore.getState();
          const queuedSong = queue[currentIndex];
          const sameSlot = queuedSong?.source === song.source && String(queuedSong.id) === String(song.id);
          await invoke(operation, () => sameSlot ? playFromQueue(currentIndex) : playSong(song));
          if (!owns(operation)) return;
          if (!operation.nativeError) return;
          error = operation.nativeError;
        } catch (retryError) {
          if (!owns(operation)) return;
          error = retryError;
        }
      }
      if (!owns(operation)) return;
      logger.warn("播放恢复失败", failureMessage(error));
      const blockReason = !usePlaybackSettingsStore.getState().autoSkipOnPlaybackError
        ? "自动跳过已关闭"
        : hasReachedAutoSkipLimit()
          ? `连续 ${MAX_CONSECUTIVE_AUTO_SKIPS} 首播放失败，已停止自动跳过`
          : resolveAutoSkipBlockReason();
      if (blockReason) {
        await stopAfterFailure(operation, `${failureMessage(error)}（${blockReason}）`);
        return;
      }
      const previousKey = currentSongKey();
      try {
        await invoke(operation, () => playNext(true));
        if (!owns(operation)) return;
        if (currentSongKey() !== previousKey) noteAutomaticSkip();
        if (!operation.nativeError) return;
        error = operation.nativeError;
        shouldRetry = true;
      } catch (nextError) {
        if (!owns(operation)) return;
        const changedSong = currentSongKey() !== previousKey;
        if (changedSong) noteAutomaticSkip();
        if (!changedSong) {
          // FM 拉新等失败没有换到新曲，继续同一步不会消耗歌曲额度，必须明确停手。
          await stopAfterFailure(operation, failureMessage(nextError));
          return;
        }
        error = nextError;
        shouldRetry = false;
      }
    }
  }

  async function runRecovery(action: (operation: RecoveryOperation) => Promise<void>): Promise<void> {
    syncExternalIntent();
    if (recovery || terminalRequest === getCurrentPlaybackRequestId()) return;
    const operation: RecoveryOperation = { requestId: getCurrentPlaybackRequestId(), nativeError: null };
    recovery = operation;
    try {
      if (await hasNativePlaybackIntent(operation.requestId) && owns(operation)) await action(operation);
    } finally {
      // 实例内令牌释放；旧 finally 不得解除手动接管或新服务的恢复锁。
      if (recovery === operation) recovery = null;
    }
  }

  async function advanceAfterTrackFinished(): Promise<void> {
    await runRecovery(async (operation) => {
      const { playMode, queue, playbackContext } = usePlayerStore.getState();
      try {
        if (playbackContext.type !== "personalFm" && playbackContext.type !== "heartbeat" && playMode === "single") {
          await TrackPlayer.skip(0);
          if (!owns(operation)) return;
          await TrackPlayer.seekTo(0);
          if (!await hasNativePlaybackIntent(operation.requestId) || !owns(operation)) return;
          await TrackPlayer.play();
          return;
        }
        if (queue.length === 0 && playbackContext.type !== "personalFm" && playbackContext.type !== "heartbeat") return;
        await invoke(operation, () => playNext(true));
        if (owns(operation) && operation.nativeError) await recoverFailure(operation, operation.nativeError, true);
      } catch (error) {
        if (owns(operation)) await recoverFailure(operation, error, false);
      }
    });
  }

  setupPlayerListeners();
  logger.info("后台播放服务已就绪", session.id);
  // RNTP 原生 HeadlessJsTaskService 已持有服务级 WakeLock，不叠加共享的临时锁。
  // transport 由 store 同步认领意图并收口未完成的装载；正常续播不重建原生队列。
  listen(Event.RemotePlay, () => runCommand(() => usePlayerStore.getState().resume(), { cancelPlayback: false }));
  listen(Event.RemotePause, () => runCommand(() => usePlayerStore.getState().pause(), { cancelPlayback: false }));
  listen(Event.RemoteStop, () => runCommand(() => usePlayerStore.getState().stop(), { cancelPlayback: false }));
  // 导航只失效恢复令牌：解析是否可抢占、原生提交如何合并，统一由导航入口决定。
  listen(Event.RemoteNext, () => runCommand(() => playNext(false), { cancelPlayback: false }));
  listen(Event.RemotePrevious, () => runCommand(() => playPrevious(), { cancelPlayback: false }));
  listen(Event.RemoteSeek, ({ position }) => runCommand(() => usePlayerStore.getState().seekTo(position)));
  listen(Event.RemoteDuck, async ({ paused, permanent }) => {
    const action = getAudioInterruptionAction({
      paused, permanent,
      pauseOnExternalPlayback: usePlaybackSettingsStore.getState().pauseOnExternalPlayback,
      currentVolume: usePlayerStore.getState().volume,
    });
    if (action.type === "pause") {
      await runCommand(() => usePlayerStore.getState().pause(), { cancelPlayback: false });
      usePlayerStore.setState({ externalDuckVolume: null });
      return;
    }
    if (action.type === "setVolume") {
      await TrackPlayer.setVolume(action.volume);
      usePlayerStore.setState({ externalDuckVolume: paused ? action.volume : null });
      return;
    }
    if (usePlayerStore.getState().externalDuckVolume != null) usePlayerStore.setState({ externalDuckVolume: null });
  });
  listen(Event.PlaybackActiveTrackChanged, async ({ track, lastTrack }) => {
    if (track?.id !== SILENCE_GAP_TRACK_ID) return;
    const song = usePlayerStore.getState().currentSong;
    if (lastTrack && song && lastTrack.id !== `${song.source}-${song.id}`) return;
    await advanceAfterTrackFinished();
  });
  listen(Event.PlaybackQueueEnded, async () => {
    if (usePlayerStore.getState().onSilenceGap === false) return;
    await advanceAfterTrackFinished();
  });
  listen(Event.PlaybackProgressUpdated, ({ position, duration }) => {
    if (!usePlayerStore.getState().onSilenceGap) prefetchUpcomingSongNearEnd(position, duration);
  });
  listen(Event.PlaybackError, async ({ message }) => {
    if (!shouldAttributePlaybackErrorToCurrentSong() || !usePlayerStore.getState().currentSong) return;
    syncExternalIntent();
    const requestId = getCurrentPlaybackRequestId();
    if (handledNativeRequest === requestId || terminalRequest === requestId) return;
    // PlaybackError 没有轨道或意图 ID；读取当前原生状态，排除新曲已起播后的旧事件。
    const nativeState = await TrackPlayer.getPlaybackState();
    if (activeService !== session || !isCurrentPlaybackRequest(requestId) || nativeState.state !== State.Error) return;
    if (handledNativeRequest === requestId || terminalRequest === requestId) return;
    handledNativeRequest = requestId;
    const error = new Error(typeof message === "string" && message ? message : "播放失败");
    if (recovery && owns(recovery)) {
      recovery.nativeError = error;
      return;
    }
    await runRecovery(operation => recoverFailure(operation, error, true));
  });
  // Promise 与原生 MusicService 同寿命，错误恢复结束不得终结 Headless 任务。
  return completion;
}

function resolveAutoSkipBlockReason(): string | null {
  const { playbackContext, playMode, queue, currentIndex, tempPlayList, shuffleHistory, playedIndices } = usePlayerStore.getState();
  if (playbackContext.type === "personalFm" || playbackContext.type === "heartbeat") return null;
  if (playMode === "single") return "单曲循环";
  if (tempPlayList.length > 0) return null;
  if (queue.length <= 1) return "队列里没有其它歌曲";
  const next = getNextQueueNavigationState({ queueLength: queue.length, currentIndex, playMode, shuffleHistory, playedIndices });
  if (next.nextIndex == null) return "已到队列末尾";
  if (next.nextIndex === currentIndex) return "队列里没有其它歌曲";
  return null;
}

module.exports = playbackService;
