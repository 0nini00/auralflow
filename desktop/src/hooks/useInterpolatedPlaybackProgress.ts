import { useEffect, useRef, useState } from "react";
import { estimatePlaybackProgress, type PlaybackProgressClock } from "@/services/lyrics/playbackSync";

interface UseInterpolatedPlaybackProgressOptions {
  status: string;
  progress: number;
  /** progress 的 engine 采样时刻（Date.now() 基准）；跨 WebView 仍可使用 */
  progressSampledAt?: number;
  duration: number;
  playbackRate: number;
}

/**
 * 进度插值锚点豁免阈值：锚点与上一次外推值差超过该值视为大跳
 * （seek / 切歌 / 回退），重置单调钳制而不是拉回，避免“顶回去”的回跳感。
 */
const ANCHOR_JUMP_RESET_SECONDS = 0.35;

function getClockNow(): number {
  return Date.now();
}


export function useInterpolatedPlaybackProgress({
  status,
  progress,
  progressSampledAt,
  duration,
  playbackRate,
}: UseInterpolatedPlaybackProgressOptions): number {
  const clockRef = useRef<PlaybackProgressClock>({
    status,
    progress,
    duration,
    playbackRate,
    updatedAt: getClockNow(),
  });
  // 上一次输出的插值进度：用于单调钳制（只许前进，不许回跳）
  const lastEstimatedRef = useRef<number>(progress);
  const [currentProgress, setCurrentProgress] = useState(progress);

  useEffect(() => {
    // 锚点时刻优先用 engine 采样时刻（同帧取的 performance.now()），
    // 而不是本 effect 执行时刻——否则 React 渲染/提交延迟会被重复计入外推，
    // 表现为歌词先超前再被新锚点拉回的锯齿式忽快忽慢。
    const anchorAt = Number.isFinite(progressSampledAt) ? progressSampledAt! : Date.now();
    const clock: PlaybackProgressClock = {
      status,
      progress,
      duration,
      playbackRate,
      updatedAt: anchorAt,
    };
    clockRef.current = clock;

    if (status !== "playing") {
      // 暂停/空闲：直接跟随锚点，不做单调钳制（暂停时进度静止）
      lastEstimatedRef.current = progress;
      setCurrentProgress(progress);
      return;
    }

    // 锚点大跳（seek/切歌/回退）：重置单调基准，不做拉回
    if (Math.abs(progress - lastEstimatedRef.current) > ANCHOR_JUMP_RESET_SECONDS) {
      lastEstimatedRef.current = estimatePlaybackProgress(clock);
      setCurrentProgress(lastEstimatedRef.current);
      return;
    }

    // 单调钳制：新锚点若比上一次外推值还小（正常播放时不应发生，
    // 但 interval 兜底校正/渲染延迟可能造成小幅回退），取两者较大值，
    // 保证歌词/进度条视觉上只前进不回跳。
    const anchored = estimatePlaybackProgress(clock);
    lastEstimatedRef.current = Math.max(lastEstimatedRef.current, anchored);
    setCurrentProgress(lastEstimatedRef.current);
  }, [duration, playbackRate, progress, progressSampledAt, status]);

  useEffect(() => {
    if (status !== "playing") return;

    let frameId: number | null = null;
    const tick = () => {
      const estimated = estimatePlaybackProgress(clockRef.current);
      // 帧间也保持单调：熔断冻结（时钟过久未刷新）时沿用上一次值，不回退
      if (Number.isFinite(estimated)) {
        lastEstimatedRef.current = Math.max(lastEstimatedRef.current, estimated);
        setCurrentProgress(lastEstimatedRef.current);
      }
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => {
      if (frameId != null) cancelAnimationFrame(frameId);
    };
  }, [status]);

  return currentProgress;
}
