import { AppState } from "react-native";
import { buildSongKey, shouldCalibrateClock } from "@lx/core";
import { useLyricOverlayStore } from "@/stores/lyricOverlayStore";
import { useLyricSettingsStore } from "@/stores/lyricSettingsStore";
import { usePlayerStore } from "@/stores/playerStore";
import { convertChineseText } from "@/services/chineseConversionService";
import { logger } from "@/services/logger";
import { syncLyricOverlayPlaybackClock } from "@/services/lyricOverlayPlayback";
import {
  addLyricOverlayVisibilityListener,
  hideLyricOverlay,
  isLyricOverlaySupported,
  setLyricOverlayClockRate,
  setLyricOverlayLocked,
  setLyricOverlayLyrics,
} from "@/services/lyricOverlayService";

let stopSynchronization: (() => void) | null = null;

/** 与 JS 播放运行时同寿命，通知开关与歌词同步不依赖任何播放页面。 */
export function startLyricOverlaySync(): () => void {
  if (stopSynchronization) return stopSynchronization;
  if (!isLyricOverlaySupported()) return () => {};

  let disposed = false;
  let revision = 0;
  let lastClockSync = 0;
  const initialPlayer = usePlayerStore.getState();
  let lyricsOwnerKey = initialPlayer.currentSong ? buildSongKey(initialPlayer.currentSong) : "";

  function report(error: unknown, operation = revision): void {
    const message = error instanceof Error ? error.message : String(error);
    if (!disposed && operation === revision) useLyricOverlayStore.setState({ error: message });
    logger.error("悬浮歌词同步失败", error);
  }

  function owns(operation: number): boolean {
    return !disposed && revision === operation && useLyricOverlayStore.getState().visible;
  }

  function synchronizeContent(): void {
    const operation = ++revision;
    const overlay = useLyricOverlayStore.getState();
    const { currentSong, lyrics } = usePlayerStore.getState();
    if (!overlay.visible || !currentSong || disposed) return;

    const { chineseConversion: conversion, manualOffsetMs } = useLyricSettingsStore.getState();
    const convert = (text: string) => convertChineseText(text, conversion);
    const title = convert(currentSong.singer ? `${currentSong.name} - ${currentSong.singer}` : currentSong.name);
    const lyricsOwned = lyricsOwnerKey === buildSongKey(currentSong);

    void (async () => {
      // 原生开启偏好可能跨进程保留；注入（含空歌词）先恢复窗口，再应用锁定。
      await setLyricOverlayLyrics((lyricsOwned ? lyrics : []).map(line => ({
        time: line.time - manualOffsetMs / 1000,
        text: convert(line.text ?? ""),
        tr: line.tr ? convert(line.tr) : undefined,
      })), title);
      if (!owns(operation)) return;
      await setLyricOverlayLocked(overlay.locked);
      if (!owns(operation)) return;
      await setLyricOverlayClockRate(usePlayerStore.getState().playbackRate);
      if (!owns(operation)) return;
      await syncLyricOverlayPlaybackClock();
      lastClockSync = Date.now();
    })().catch(error => report(error, operation));
  }

  async function restoreNativeVisibility(): Promise<void> {
    const previousRevision = revision;
    await useLyricOverlayStore.getState().syncVisibleFromNative();
    if (revision === previousRevision) synchronizeContent();
  }

  const nativeSubscription = addLyricOverlayVisibilityListener(visible => {
    const previousVisible = useLyricOverlayStore.getState().visible;
    useLyricOverlayStore.getState().applyNativeVisibility(visible);
    // 原生关开可能在广播送达前完成；同值快照也要为新窗口恢复歌词。
    if (visible && previousVisible === visible) synchronizeContent();
  });
  const removeOverlaySubscription = useLyricOverlayStore.subscribe((state, previous) => {
    if (state.visible !== previous.visible || state.locked !== previous.locked) synchronizeContent();
  });
  const removePlayerSubscription = usePlayerStore.subscribe((state, previous) => {
    if (state.lyrics !== previous.lyrics) {
      // 歌词数组的交付时刻决定归属，切歌在途不能给新歌灌入上一首歌词。
      lyricsOwnerKey = state.currentSong ? buildSongKey(state.currentSong) : "";
    }
    if (state.currentSong !== previous.currentSong || state.lyrics !== previous.lyrics) {
      if (!state.currentSong && previous.currentSong && useLyricOverlayStore.getState().visible) {
        const operation = ++revision;
        void hideLyricOverlay().then(restoreNativeVisibility).catch(error => report(error, operation));
      } else {
        synchronizeContent();
      }
      return;
    }
    if (state.position === previous.position || !state.isPlaying || !useLyricOverlayStore.getState().visible) return;
    const now = Date.now();
    if (!shouldCalibrateClock(now - lastClockSync, AppState.currentState === "active")) return;
    lastClockSync = now;
    const operation = revision;
    void syncLyricOverlayPlaybackClock().catch(error => report(error, operation));
  });
  const removeSettingsSubscription = useLyricSettingsStore.subscribe((state, previous) => {
    if (state.chineseConversion !== previous.chineseConversion || state.manualOffsetMs !== previous.manualOffsetMs) {
      synchronizeContent();
    }
  });
  const appStateSubscription = AppState.addEventListener("change", state => {
    if (state !== "active") return;
    const operation = revision;
    void restoreNativeVisibility().catch(error => report(error, operation));
  });

  const initialRevision = revision;
  void useLyricOverlayStore.getState().loadFromStorage().then(() => {
    if (revision === initialRevision) synchronizeContent();
  }).catch(error => report(error, initialRevision));

  stopSynchronization = () => {
    disposed = true;
    ++revision;
    nativeSubscription.remove();
    appStateSubscription.remove();
    removeOverlaySubscription();
    removePlayerSubscription();
    removeSettingsSubscription();
    stopSynchronization = null;
  };
  return stopSynchronization;
}
