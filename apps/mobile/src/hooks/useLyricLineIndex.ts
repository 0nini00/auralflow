import { useCallback, useEffect, useRef, useState } from "react";
import type { LyricLine } from "@lx/core";
import { getCurrentLyricIndex } from "@/services/playerService";
import { usePlayerStore } from "@/stores/playerStore";

/**
 * lx 式「行变更才触发」的歌词行号钩子。
 *
 * 与直接 `getCurrentLyricIndex(lyrics, position)`（随进度事件每次重算）不同：
 * - 订阅 store 的 isPlaying / position（含 seek）/ playbackRate 变化仅用于「校准」，不触发 React 渲染；
 * - 内部维护位置锚点 + 按播放速率推算实时位置，用 setTimeout 精确调度到下一行边界，
 *   行号真正变化时才 setState 触发一次渲染；
 * - 暂停/恢复/seek/倍速/切歌/手动偏移变化都会立即重新校准（锚点取 store 最新 position）。
 *
 * 收益：沉浸屏等原本随 0.25s 进度事件高频重渲染的组件，现在只在歌词行切换时重渲染。
 */
export function useLyricLineIndex(
  lyrics: LyricLine[],
  manualOffsetMs: number,
): number {
  const [index, setIndex] = useState(-1);
  const indexRef = useRef(-1);

  const lyricsRef = useRef(lyrics);
  const offsetSecRef = useRef(manualOffsetMs / 1000);
  lyricsRef.current = lyrics;
  offsetSecRef.current = manualOffsetMs / 1000;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 位置锚点：最近一次从 store 同步的位置与时刻，用于两次进度事件之间推算实时位置
  const anchorRef = useRef({ pos: 0, at: 0 });
  // 估算前推上限：应用退到后台时 JS 定时器挂起，恢复瞬间的估算若按真实流逝时间
  // 前推会把行号瞬间推到末行；钳制到 2 秒避免闪烁，随后 0.25s 刻度会用真实位置校正
  const MAX_ESTIMATE_AHEAD_SEC = 2;

  const applyIndex = (next: number) => {
    if (next === indexRef.current) return;
    indexRef.current = next;
    setIndex(next);
  };

  const schedule = useCallback((freshPosition?: number) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    const { isPlaying, playbackRate } = usePlayerStore.getState();
    const lines = lyricsRef.current;
    const offsetSec = offsetSecRef.current;

    // 实时位置 = 锚点位置 + 播放经过时间 × 速率；有 freshPosition（store 刚更新/seek）时直接采用
    const anchor = anchorRef.current;
    const elapsedSec = Math.min((Date.now() - anchor.at) / 1000, MAX_ESTIMATE_AHEAD_SEC);
    const estimate =
      freshPosition != null
        ? freshPosition
        : anchor.pos + (isPlaying ? elapsedSec * playbackRate : 0);
    anchorRef.current = { pos: estimate, at: Date.now() };
    const pos = estimate + offsetSec;

    const current = getCurrentLyricIndex(lines, pos);
    applyIndex(current);
    // 暂停时不需要定时器（恢复/seek 会重新校准）；最后一行没有下一行可调度
    if (!isPlaying || current < 0 || current >= lines.length - 1) return;

    const nextTime = lines[current + 1].time;
    const delayMs = Math.max(20, ((nextTime - pos) / playbackRate) * 1000);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      // 到达行边界：按锚点推算重算并继续调度下一行（store 的 0.25s 刻度可能已越过多个行）
      scheduleRef.current();
    }, delayMs);
  }, []);

  const scheduleRef = useRef(schedule);
  scheduleRef.current = schedule;

  // 歌词 / 手动偏移变化：立即按最新 store 位置重新校准（含首次挂载）
  useEffect(() => {
    schedule(usePlayerStore.getState().position);
  }, [lyrics, manualOffsetMs, schedule]);

  // store 播放状态变化：isPlaying / position（播放中每 0.25s 一次，seek 时跳变）/ playbackRate
  // 变化 → 重新校准。listener 不触发渲染，行号变化由 applyIndex 内部去重后再 setState。
  useEffect(() => {
    const unsubscribe = usePlayerStore.subscribe((state, prev) => {
      if (
        state.isPlaying !== prev.isPlaying ||
        state.position !== prev.position ||
        state.playbackRate !== prev.playbackRate
      ) {
        schedule(state.position);
      }
    });
    return unsubscribe;
  }, [schedule]);

  // 卸载清理定时器
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return index;
}
