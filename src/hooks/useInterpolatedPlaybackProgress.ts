import { useEffect, useRef, useState } from "react";
import { estimatePlaybackProgress, type PlaybackProgressClock } from "@/services/lyrics/playbackSync";

interface UseInterpolatedPlaybackProgressOptions {
  status: string;
  progress: number;
  duration: number;
  playbackRate: number;
}

export function useInterpolatedPlaybackProgress({
  status,
  progress,
  duration,
  playbackRate,
}: UseInterpolatedPlaybackProgressOptions): number {
  const clockRef = useRef<PlaybackProgressClock>({
    status,
    progress,
    duration,
    playbackRate,
    updatedAt: Date.now(),
  });
  const [currentProgress, setCurrentProgress] = useState(progress);

  useEffect(() => {
    const clock = {
      status,
      progress,
      duration,
      playbackRate,
      updatedAt: Date.now(),
    };
    clockRef.current = clock;
    setCurrentProgress(estimatePlaybackProgress(clock));
  }, [duration, playbackRate, progress, status]);

  useEffect(() => {
    if (status !== "playing") return;

    let frameId: number | null = null;
    const tick = () => {
      setCurrentProgress(estimatePlaybackProgress(clockRef.current));
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => {
      if (frameId != null) cancelAnimationFrame(frameId);
    };
  }, [status]);

  return currentProgress;
}
