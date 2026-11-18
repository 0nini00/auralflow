import TrackPlayer, { Event } from "react-native-track-player";
import { buildSongKey, isPreviewDuration } from "@lx/core";
import { deleteCachedAudioForMusic } from "@/services/cacheService";
import { notePlaybackHealthy } from "@/services/playbackFailurePolicy";
import { invalidateCachedPlaybackUrl } from "@/services/playbackUrlCache";
import { claimPreviewRejection, setupPlayerStateListeners, usePlayerStore } from "@/stores/playerStore";
import { invalidatePrefetchForSong, prefetchUpcomingSongNearEnd } from "../services/playerService";

/**
 * 判定「该曲确实可播」的播放位置阈值（秒）：越过它才归还重试额度。
 * 取 5s 是为了越过坏链的报错窗口——实测坏链要到约 3s 后原生才发 PlaybackError，
 * 阈值若落在窗口内会把即将失败的加载误判为健康，重试额度反复归还即成无限重试。
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
    // 明显短于期望时长（song.interval）即视为试听：停播 + 清缓存，下次重播强制重新解析（对齐失败即停）。
    const song = usePlayerStore.getState().currentSong;
    if (!song) return;
    const key = buildSongKey(song);
    // 位置推进过阈值即证明该曲可播（音频真的在解码）：归还其重试额度，
    // 使下次遇到坏链时仍能重新走「重试一次 → 再失败才跳」，而非一失败就直接跳。
    if (position >= PLAYBACK_HEALTHY_POSITION_SECONDS) notePlaybackHealthy(key);
    if (!isPreviewDuration({ actualDurationSeconds: duration, expectedDurationSeconds: song.interval })) return;
    if (!claimPreviewRejection(key)) return;
    usePlayerStore.getState().setError(`检测到试听片段（约 ${Math.round(duration)}s），已清除缓存，请重新播放或切换音源`);
    void TrackPlayer.pause().catch(() => {});
    void invalidateCachedPlaybackUrl(song).catch(() => undefined);
    invalidatePrefetchForSong(song);
    // 磁盘音频缓存必须一起失效：解析链先查磁盘文件、命中即直接返回，不经任何试听判定。
    // 只清 URL 缓存会留下死循环（命中 → 播放试听 → 判定 → 再命中）。
    void deleteCachedAudioForMusic(song).catch(() => undefined);
  });
}
