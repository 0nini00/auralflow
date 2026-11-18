import { create } from "zustand";
import type { PlaybackSnapshot } from "@/services/playback/playbackSnapshotModel";

/**
 * 副窗口（桌面歌词 / 迷你播放器）里的播放状态镜像。
 *
 * 音频、队列、取链都只在主窗口：副窗口只显示主窗口广播过来的快照（见 playerSync.ts），
 * 控件动作再发回主窗口执行。所以副窗口不加载 playerStore——那会连带拉起播放引擎、
 * 预取与各个落盘的 library store，而它们在副窗口里没有任何用处。
 *
 * 这里只放副窗口界面实际读取的字段；要显示新的字段时从 PlaybackSnapshot 里加进来。
 */
export type PlaybackMirrorState = Pick<
  PlaybackSnapshot,
  "current" | "status" | "progress" | "progressSampledAt" | "duration" | "playbackRate"
>;

export const usePlaybackMirrorStore = create<PlaybackMirrorState>(() => ({
  current: null,
  status: "idle",
  progress: 0,
  progressSampledAt: Date.now(),
  duration: 0,
  playbackRate: 1,
}));

/** 把主窗口的一份快照写进镜像。 */
export function applyPlaybackSnapshotToMirror(snapshot: PlaybackSnapshot): void {
  usePlaybackMirrorStore.setState({
    current: snapshot.current,
    status: snapshot.status,
    progress: snapshot.progress,
    progressSampledAt: snapshot.progressSampledAt,
    duration: snapshot.duration,
    playbackRate: snapshot.playbackRate,
  });
}
