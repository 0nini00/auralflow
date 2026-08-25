import TrackPlayer, { Event } from "react-native-track-player";
import { getAudioInterruptionAction } from "@/services/audioInterruptionPolicy";
import { usePlaybackSettingsStore } from "@/stores/playbackSettingsStore";
import { usePlayerStore } from "@/stores/playerStore";
import { SILENCE_GAP_TRACK_ID } from "@/stores/playerStore";

/**
 * 后台播放服务
 * 必须在 index.js 中注册：TrackPlayer.registerPlaybackService(() => require('./src/player/playbackService'))
 */

// 声明 module 以支持 CommonJS 导出
declare const module: { exports: any };

export default async function playbackService() {
  // 监听远程播放控制事件
  TrackPlayer.addEventListener(Event.RemotePlay, async () => {
    await TrackPlayer.play();
  });

  TrackPlayer.addEventListener(Event.RemotePause, async () => {
    await TrackPlayer.pause();
  });

  TrackPlayer.addEventListener(Event.RemoteStop, async () => {
    await TrackPlayer.stop();
  });

  TrackPlayer.addEventListener(Event.RemoteNext, async () => {
    // 动态导入避免循环依赖
    const { playNext } = await import('../services/playerService');
    await playNext();
  });

  TrackPlayer.addEventListener(Event.RemotePrevious, async () => {
    const { playPrevious } = await import('../services/playerService');
    await playPrevious();
  });

  TrackPlayer.addEventListener(Event.RemoteSeek, async ({ position }) => {
    await TrackPlayer.seekTo(position);
  });

  TrackPlayer.addEventListener(Event.RemoteDuck, async ({ paused, permanent }) => {

    const action = getAudioInterruptionAction({
      paused,
      permanent,
      pauseOnExternalPlayback: usePlaybackSettingsStore.getState().pauseOnExternalPlayback,
      currentVolume: usePlayerStore.getState().volume,
    });

    if (action.type === "pause") {
      await TrackPlayer.pause();
      return;
    }

    if (action.type === "setVolume") {
      await TrackPlayer.setVolume(action.volume);
      // duck 态落库：切歌淡入以该音量为上限；中断结束（paused=false）恢复音量时清除标记
      usePlayerStore.setState({ externalDuckVolume: paused ? action.volume : null });
    }
  });

  // 曲末自动切歌。
  //
  // 必须注册在这里而非 setupPlayerListeners：那边跑在 React 上下文，app 退到
  // 后台后 JS 被挂起，切歌要等用户回到前台才发生。本服务是 TrackPlayer 的
  // 后台服务，播放期间保持存活。
  //
  // 主路径是 PlaybackActiveTrackChanged：每首歌尾部挂了 2 秒静音占位轨，
  // 原生队列自动推进到它时播放并未中断，这 2 秒就是解析下一首的窗口。
  // PlaybackQueueEnded 作为兜底：静音也播完仍没切走时再试一次。
  TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, async ({ track }) => {
    if (!track || track.id !== SILENCE_GAP_TRACK_ID) return;
    await advanceAfterTrackFinished();
  });

  TrackPlayer.addEventListener(Event.PlaybackQueueEnded, async () => {
    await advanceAfterTrackFinished();
  });
}

/**
 * 防重入：两个事件都可能在 JS 从挂起中恢复后排队触发，不去重会一次跳两首。
 * 标志在首次 await 之前同步置位，可关死交错窗口。
 */
let advancingAfterFinish = false;

async function advanceAfterTrackFinished(): Promise<void> {
  if (advancingAfterFinish) return;
  advancingAfterFinish = true;
  try {
    const { playMode, queue, playbackContext } = usePlayerStore.getState();

    if (playbackContext.type !== "personalFm" && playMode === "single") {
      // 单曲循环：回到队列首位的真实曲目重播（index 1 是静音占位）
      try {
        await TrackPlayer.skip(0);
      } catch {}
      await TrackPlayer.seekTo(0);
      await TrackPlayer.play();
      return;
    }

    if (queue.length > 0 || playbackContext.type === "personalFm") {
      const { playNext } = await import("../services/playerService");
      try {
        await playNext();
      } catch (error) {
        // FM 拉新失败不静默：写入 error 让 UI 可见，对齐桌面端「切歌失败不静默」
        const message = error instanceof Error ? error.message : String(error);
        usePlayerStore.setState({ error: `切歌失败：${message}` });
      }
    }
  } finally {
    advancingAfterFinish = false;
  }
}

// CommonJS 导出以兼容 react-native-track-player
module.exports = playbackService;
