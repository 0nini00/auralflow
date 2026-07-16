import TrackPlayer, { Event } from "react-native-track-player";
import { getAudioInterruptionAction } from "@/services/audioInterruptionPolicy";
import { usePlaybackSettingsStore } from "@/stores/playbackSettingsStore";
import { usePlayerStore } from "@/stores/playerStore";

/**
 * 后台播放服务
 * 必须在 index.js 中注册：TrackPlayer.registerPlaybackService(() => require('./src/player/playbackService'))
 */

// 声明 module 以支持 CommonJS 导出
declare const module: { exports: any };

export default async function playbackService() {
  // 监听远程播放控制事件
  TrackPlayer.addEventListener(Event.RemotePlay, async () => {
    console.log('Remote play');
    await TrackPlayer.play();
  });

  TrackPlayer.addEventListener(Event.RemotePause, async () => {
    console.log('Remote pause');
    await TrackPlayer.pause();
  });

  TrackPlayer.addEventListener(Event.RemoteStop, async () => {
    console.log('Remote stop');
    await TrackPlayer.stop();
  });

  TrackPlayer.addEventListener(Event.RemoteNext, async () => {
    console.log('Remote next');
    // 动态导入避免循环依赖
    const { playNext } = await import('../services/playerService');
    await playNext();
  });

  TrackPlayer.addEventListener(Event.RemotePrevious, async () => {
    console.log('Remote previous');
    const { playPrevious } = await import('../services/playerService');
    await playPrevious();
  });

  TrackPlayer.addEventListener(Event.RemoteSeek, async ({ position }) => {
    console.log('Remote seek:', position);
    await TrackPlayer.seekTo(position);
  });

  TrackPlayer.addEventListener(Event.RemoteDuck, async ({ paused, permanent }) => {
    console.log('Remote duck:', { paused, permanent });

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
    }
  });
}

// CommonJS 导出以兼容 react-native-track-player
module.exports = playbackService;
