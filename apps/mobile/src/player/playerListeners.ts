import TrackPlayer, { Event } from "react-native-track-player";
import { buildSongKey, isPreviewDuration } from "@lx/core";
import { notePlaybackHealthy } from "@/services/playbackFailurePolicy";
import { claimPreviewRejection, setupPlayerStateListeners, usePlayerStore } from "@/stores/playerStore";
import { logger } from "@/services/logger";
import { notePlaybackCandidateHealthy, prefetchUpcomingSongNearEnd, recoverCurrentSongPlayback } from "../services/playerService";
import { getCurrentPlaybackRequestId, isCurrentPlaybackRequest } from "@/services/playbackRequest";

/**
 * 判定「该曲确实可播」的播放位置阈值（秒）：越过它才归还自动跳过额度。
 * 取 5s 是为了越过坏链的报错窗口——实测坏链要到约 3s 后原生才发 PlaybackError，
 * 恢复候选还需要相对恢复起点推进，才能获得下一次网络故障的恢复窗口。
 */
const PLAYBACK_HEALTHY_POSITION_SECONDS = 5;

let playerListenersSetup = false;

/**
 * 注册前台（UI 上下文）的播放器事件监听。应用启动与后台播放服务就绪时各调用一次，幂等。
 *
 * 分两层，顺序固定：
 * 1. playerStore 自己的状态同步监听（进度、播放态、静音占位标记、错误文案）；
 * 2. 本模块的进度处置——曲末预读、健康记账、试听兜底。它们要用到取链缓存与预读，
 *    属于 store 之上的编排，所以注册在这里而不是 store 里（store 不依赖 playerService）。
 * 同一事件的监听按注册顺序触发，第 2 层读到的一定是第 1 层刚写完的进度。
 *
 * 曲末自动切歌不在此注册：该逻辑必须运行在 TrackPlayer 的后台服务上下文
 * （src/player/playbackService.ts），否则 app 退到后台后 JS 挂起，切歌要等
 * 用户回到前台才发生。
 */
export function setupPlayerListeners(): void {
  if (playerListenersSetup) return;
  playerListenersSetup = true;
  setupPlayerStateListeners();

  TrackPlayer.addEventListener(Event.PlaybackProgressUpdated, ({ position, duration }) => {
    // 静音占位轨期间（曲末窗口）：position/duration 是占位轨的，「明显短于期望时长」
    // 恰好命中试听兜底判定，会造成曲末误报"检测到试听片段"。整段忽略。
    if (usePlayerStore.getState().onSilenceGap) return;
    // 曲末提前预解析下一首：剩余 10s 内触发一次（内部按「当前曲→下一首」组合与
    // 预读 key 双重去重，0.25s 的进度事件不会重复解析）。无下一首/单曲循环无副作用。
    prefetchUpcomingSongNearEnd(position, duration);
    // 试听兜底：解析期拿不到 Content-Length / Content-Range 的流式响应靠播放器实际时长判定。
    // 明显短于期望时长时主动拒绝当前候选，继续同歌曲的剩余来源。
    const song = usePlayerStore.getState().currentSong;
    if (!song) return;
    const key = buildSongKey(song);
    if (!isPreviewDuration({ actualDurationSeconds: duration, expectedDurationSeconds: song.interval })) {
      // 先排除试听，再把已持续解码的候选记为健康。
      notePlaybackCandidateHealthy(key, position);
      if (position >= PLAYBACK_HEALTHY_POSITION_SECONDS) {
        notePlaybackHealthy(key);
      }
      return;
    }
    if (!claimPreviewRejection(key)) return;
    const pending = recoverCurrentSongPlayback(getCurrentPlaybackRequestId(), { rejectPreview: true });
    const owner = getCurrentPlaybackRequestId();
    void pending.catch(async (error) => {
      if (!isCurrentPlaybackRequest(owner)) return;
      logger.warn("[试听兜底] 同歌曲换源失败", error);
      let message = error instanceof Error ? error.message : String(error);
      const paused = usePlayerStore.getState().pause();
      const pauseOwner = getCurrentPlaybackRequestId();
      try { await paused; }
      catch (pauseError) { message += `；停止试听失败：${pauseError instanceof Error ? pauseError.message : String(pauseError)}`; }
      if (!isCurrentPlaybackRequest(pauseOwner)) return;
      usePlayerStore.setState({ loading: false, isPlaying: false, error: `检测到试听片段，同歌曲换源失败：${message}` });
    });
  });
}
