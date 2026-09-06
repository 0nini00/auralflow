import TrackPlayer, { Event } from "react-native-track-player";
import { getAudioInterruptionAction } from "@/services/audioInterruptionPolicy";
import { getNextQueueNavigationState } from "@/services/queueNavigationModel";
import { shouldAutoSkipAfterFailure } from "@/services/playbackFailurePolicy";
import { usePlaybackSettingsStore } from "@/stores/playbackSettingsStore";
import { shouldAttributePlaybackErrorToCurrentSong, usePlayerStore } from "@/stores/playerStore";
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
    // 走 store.seekTo：曲末 2s 静音占位轨期间的 seek 需要映射回真实曲目，
    // 直接 seekTo 原生会被按占位轨时长理解（"点了没反应"）
    const { seekTo } = usePlayerStore.getState();
    await seekTo(position);
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

  // 播放失败的有限自动跳过。
  //
  // 分工：处置由 playbackFailurePolicy 判定，playerStore 侧同步落库结论——
  // 尚有重试额度则由 store 清坏链缓存后原地重播一次（多数 403 靠重解析即可救回），
  // 额度已用掉即判终局，由本服务跳下一首。跳歌必须由本后台服务发起：app 退到后台
  // 后 playerStore 所在的 React 上下文会被挂起，那边跳不动。
  //
  // autoSkipOnPlaybackError 开关（默认 false）：用户可选「失败即停」或「有限自动跳过」。
  // 关闭时终局失败直接报错停手，不跳歌；开启时最多连跳 3 首，超限后报错停手。
  TrackPlayer.addEventListener(Event.PlaybackError, async ({ message }) => {
    // 开关关闭：不自动跳过，playerStore 已报错并维持停播态，由用户决定下一步
    if (!usePlaybackSettingsStore.getState().autoSkipOnPlaybackError) return;
    await autoSkipAfterPlaybackError(typeof message === "string" && message ? message : "播放失败");
  });
}

/**
 * 防重入：曲末推进与失败自动跳过共用一把锁。曲末两个事件都可能在 JS 从挂起中恢复
 * 后排队触发，PlaybackError 更是「一次加载失败连发多条」，不去重会一次跳好几首。
 * 标志在首次 await 之前同步置位，可关死交错窗口。
 */
let advancingInBackground = false;

async function advanceAfterTrackFinished(): Promise<void> {
  if (advancingInBackground) return;
  advancingInBackground = true;
  try {
    // 有歌自然播完即说明播放链是通的：失败连跳计数归零，下次故障重新从 0 起算
    consecutiveAutoSkips = 0;
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
        await playNext(true);  // 曲末自动推进:同失败跳过,防被当补跳多跳一首
      } catch (error) {
        // FM 拉新失败不静默：写入 error 让 UI 可见，对齐桌面端「切歌失败不静默」
        const message = error instanceof Error ? error.message : String(error);
        usePlayerStore.setState({ error: `切歌失败：${message}` });
      }
    }
  } finally {
    advancingInBackground = false;
  }
}

// ── 播放失败的有限自动跳过 ──

/** 连续自动跳过上限：整条队列都失效时不无限往下翻，跳满即报错停手交给用户。 */
const MAX_CONSECUTIVE_AUTO_SKIPS = 3;

/**
 * 距上次自动跳过超过该时长即视为新的一条失败链（中间已正常听了一段），连跳计数归零。
 * 坏歌是秒级连跳，不会跨过这个窗口，所以上限对同一次故障始终有效。
 */
const AUTO_SKIP_CHAIN_RESET_MS = 60_000;

let consecutiveAutoSkips = 0;
let lastAutoSkipAt = 0;

/**
 * 自动跳过是否有意义：单曲循环会原地重播同一条坏链、队列没有其它歌曲/顺序播放到尾
 * 则无处可跳。这些情况必须显式报错停手，不能静默打转。
 */
function resolveAutoSkipBlockReason(): string | null {
  const { playbackContext, playMode, queue, currentIndex, tempPlayList, shuffleHistory, playedIndices } =
    usePlayerStore.getState();
  // FM 上下文永远有下一首（可继续拉新批次），且 FM 不受单曲循环影响
  if (playbackContext.type === "personalFm") return null;
  // 单曲循环优先于稍后播放：单曲模式下不得自动跳走，保留错误交给用户
  if (playMode === "single") return "单曲循环";
  // 稍后播放暂存区里必有下一首（playNext 会优先消费它）
  if (tempPlayList.length > 0) return null;
  if (queue.length <= 1) return "队列里没有其它歌曲";
  // 只做可行性判定：这里不写回 shuffleHistory/playedIndices，随机抽取仍由 playNext 负责
  const next = getNextQueueNavigationState({
    queueLength: queue.length,
    currentIndex,
    playMode,
    shuffleHistory,
    playedIndices,
  });
  if (next.nextIndex == null) return "已到队列末尾";
  if (next.nextIndex === currentIndex) return "队列里没有其它歌曲";
  return null;
}

/**
 * PlaybackError 兜底：判定为终局失败时自动跳下一首。
 *
 * 处置由 playbackFailurePolicy 持有：尚有重试额度归 store 原地重播，本服务不动作；
 * 额度已用掉即终局，跳下一首。歌曲一旦真正播出声即归还额度，因此「上次失败过的歌」
 * 重播时仍能重新获得完整的「重试一次 → 再失败才跳」链路。
 */
async function autoSkipAfterPlaybackError(message: string): Promise<void> {
  const currentSong = usePlayerStore.getState().currentSong;
  if (!currentSong) return;

  // 归属守卫（与 playerStore 的 PlaybackError 监听同一套判定，同步执行）：
  // 切歌在途时这条错误已不在 currentSong 的责任窗口，跳歌会跳过用户刚点的新歌。
  if (!shouldAttributePlaybackErrorToCurrentSong()) return;

  const songKey = `${currentSong.source}:${currentSong.id}`;

  // 让出一个微任务，确保 playerStore 的监听器已就同一条原生事件落库处置结论，
  // 使判定不依赖两个监听器的注册顺序。
  await Promise.resolve();

  // 重试接手（含重试加载在途）：本服务不跳，由那次重播收口
  if (!shouldAutoSkipAfterFailure(songKey)) return;

  // 已有后台切歌在途（曲末推进 / 上一次自动跳过未收口）：本次事件丢弃，
  // 由在途那次切换收口，避免错误事件一次跳过好几首
  if (advancingInBackground) return;

  if (Date.now() - lastAutoSkipAt > AUTO_SKIP_CHAIN_RESET_MS) {
    consecutiveAutoSkips = 0;
  }
  if (consecutiveAutoSkips >= MAX_CONSECUTIVE_AUTO_SKIPS) {
    usePlayerStore.setState({
      error: `${message}（连续 ${MAX_CONSECUTIVE_AUTO_SKIPS} 首播放失败，已停止自动跳过）`,
    });
    return;
  }

  const blockReason = resolveAutoSkipBlockReason();
  if (blockReason) {
    usePlayerStore.setState({ error: `${message}（${blockReason}，未自动跳过）` });
    return;
  }

  advancingInBackground = true;
  try {
    const { playNext } = await import("../services/playerService");
    // 动态导入是异步的：期间用户可能已手动切歌或 store 重试已换曲。
    // 重新读取 store，当前曲 key 已变则放弃本次自动跳过（也不消耗连跳预算）。
    const latestSong = usePlayerStore.getState().currentSong;
    if (!latestSong || `${latestSong.source}:${latestSong.id}` !== songKey) return;
    // auto=true：自动跳过不参与切歌连点补跳，避免在用户手动切歌在途时多排一步
    await playNext(true);
    // 连跳预算按「确实换了曲」记账：playNext 遇到切换在途会直接放弃本次，
    // 此时一首都没跳，照记会让预算被空转耗尽、误报「连续 N 首播放失败」。
    const afterSong = usePlayerStore.getState().currentSong;
    if (afterSong != null && `${afterSong.source}:${afterSong.id}` !== songKey) {
      consecutiveAutoSkips += 1;
      lastAutoSkipAt = Date.now();
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    usePlayerStore.setState({ error: `${message}（自动跳过下一首也失败：${detail}）` });
  } finally {
    advancingInBackground = false;
  }
}

// CommonJS 导出以兼容 react-native-track-player
module.exports = playbackService;
