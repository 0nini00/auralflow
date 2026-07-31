import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, type LayoutChangeEvent, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { buildImmersiveControlsVisibilityModel } from "@/services/immersiveControlsModel";
import { extractArtworkColors, darkenHex, type ArtworkColors } from "@/services/artworkColorService";
import { buildImmersiveCurrentSongActions } from "@/services/currentSongActions";
import { buildImmersivePlayModeControl } from "@/services/mobilePlayModeModel";
import { buildImmersivePlaybackRateModel } from "@/services/playerRateModel";
import { buildImmersiveQueuePanelModel } from "@/services/playerQueueModel";
import { buildImmersiveVolumeControlModel } from "@/services/playerVolumeModel";
import { buildMobileSleepTimerControl } from "@/services/songSleepTimerModel";
import {
  getCurrentLyricIndex,
  playFromQueue,
  playNext,
  playPrevious,
} from "@/services/playerService";
import { shareMusic } from "@/services/shareMusicService";
import { buildImmersiveTranslationControl } from "@/services/lyricSettingsModel";
import { useLyricSettingsStore } from "@/stores/lyricSettingsStore";
import { usePlayerStore } from "@/stores/playerStore";
import { usePlaylistStore } from "@/stores/playlistStore";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { useDeviceForm } from "@/utils/responsive";

export interface UseImmersiveControllerArgs {
  visible: boolean;
  onClose: () => void;
}

/** 沉浸式播放页状态与操作（Phase 2） */
export function useImmersiveController({ visible, onClose }: UseImmersiveControllerArgs) {
  const insets = useSafeAreaInsets();

  const { width: windowWidth } = useWindowDimensions();

  const { isTablet } = useDeviceForm();

  const currentSong = usePlayerStore((s) => s.currentSong);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const loading = usePlayerStore((s) => s.loading);
  const position = usePlayerStore((s) => s.position);
  const manualOffsetMs = useLyricSettingsStore((s) => s.manualOffsetMs);
  const lyricOffsetSec = manualOffsetMs / 1000;
  const duration = usePlayerStore((s) => s.duration);
  const lyrics = usePlayerStore((s) => s.lyrics);
  const playbackRate = usePlayerStore((s) => s.playbackRate);
  const playMode = usePlayerStore((s) => s.playMode);
  const volume = usePlayerStore((s) => s.volume);
  const isMuted = usePlayerStore((s) => s.isMuted);
  const queue = usePlayerStore((s) => s.queue);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const pause = usePlayerStore((s) => s.pause);
  const resume = usePlayerStore((s) => s.resume);
  const seekTo = usePlayerStore((s) => s.seekTo);
  const togglePlayMode = usePlayerStore((s) => s.togglePlayMode);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const toggleMute = usePlayerStore((s) => s.toggleMute);
  const setPlaybackRate = usePlayerStore((s) => s.setPlaybackRate);

  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue);

  const clearQueue = usePlayerStore((s) => s.clearQueue);

  const sleepTimerMinutes = usePlayerStore((s) => s.sleepTimerMinutes);

  const sleepTimerActive = usePlayerStore((s) => s.sleepTimerActive);

  const sleepTimerSongCount = usePlayerStore((s) => s.sleepTimerSongCount);

  const sleepTimerSongActive = usePlayerStore((s) => s.sleepTimerSongActive);

  const startSleepTimer = usePlayerStore((s) => s.startSleepTimer);

  const startSongSleepTimer = usePlayerStore((s) => s.startSongSleepTimer);

  const cancelSleepTimer = usePlayerStore((s) => s.cancelSleepTimer);

  const mode = useThemeStore((s) => s.mode);
  const systemTheme = useThemeStore((s) => s.systemTheme);
  const accentColor = useThemeStore((s) => s.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  const showTranslation = useLyricSettingsStore((s) => s.showTranslation);
  const setShowTranslation = useLyricSettingsStore((s) => s.setShowTranslation);

  const isLiked = usePlaylistStore((s) => s.isLiked(currentSong));
  const likeSong = usePlaylistStore((s) => s.likeSong);
  const unlikeSong = usePlaylistStore((s) => s.unlikeSong);

  const [posterMode, setPosterMode] = useState(false);

  // PagerView 页面索引：0=封面, 1=歌词（手机端使用）
  const [currentPage, setCurrentPage] = useState(0);
  const isLyricsPage = currentPage === 1;

  const [controlsVisible, setControlsVisible] = useState(true);
  const [layoutWidth, setLayoutWidth] = useState(0);
  const [lyricSettingsVisible, setLyricSettingsVisible] = useState(false);
  const [rateModalVisible, setRateModalVisible] = useState(false);
  const [queueModalVisible, setQueueModalVisible] = useState(false);
  const [volumeModalVisible, setVolumeModalVisible] = useState(false);
  const [soundEffectModalVisible, setSoundEffectModalVisible] = useState(false);

  const [sleepModalVisible, setSleepModalVisible] = useState(false);

  const [customMinutes, setCustomMinutes] = useState("");

  const [customSongCount, setCustomSongCount] = useState("");

  const [addToPlaylistVisible, setAddToPlaylistVisible] = useState(false);

  const [liking, setLiking] = useState(false);

  const fadeAnim = useRef(new Animated.Value(1)).current;

  const currentLyricIndex = useMemo(
    () => getCurrentLyricIndex(lyrics, position + lyricOffsetSec),
    [lyrics, position, lyricOffsetSec]
  );

  const artwork = currentSong?.picUrl || currentSong?.img;

  // 按封面生成氛围色（对齐播放页“根据封面生成背景氛围色”）。
  const [ambientColors, setAmbientColors] = useState<ArtworkColors | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!artwork) {
      setAmbientColors(null);
      return;
    }
    extractArtworkColors(artwork)
      .then((colors) => {
        if (!cancelled) setAmbientColors(colors);
      })
      .catch(() => {
        if (!cancelled) setAmbientColors(null);
      });
    return () => {
      cancelled = true;
    };
  }, [artwork]);
  const ambientBackground = ambientColors?.dominant ? darkenHex(ambientColors.dominant, 0.45) : null;
  const currentSongActions = useMemo(
    () => buildImmersiveCurrentSongActions(currentSong, isLiked),
    [currentSong, isLiked]
  );
  const rateModel = useMemo(
    () => buildImmersivePlaybackRateModel(playbackRate),
    [playbackRate]
  );
  const queueModel = useMemo(
    () => buildImmersiveQueuePanelModel(queue, currentIndex),
    [queue, currentIndex]
  );
  const playModeControl = useMemo(
    () => buildImmersivePlayModeControl(playMode),
    [playMode]
  );
  const volumeModel = useMemo(
    () => buildImmersiveVolumeControlModel(volume, isMuted),
    [volume, isMuted]
  );
  const translationControl = useMemo(
    () => buildImmersiveTranslationControl(showTranslation),
    [showTranslation]
  );
  const controlsVisibility = useMemo(

    () => buildImmersiveControlsVisibilityModel(controlsVisible),

    [controlsVisible]

  );

  const sleepTimerControl = useMemo(

    () =>

      buildMobileSleepTimerControl({

        minuteActive: sleepTimerActive,

        minuteRemaining: sleepTimerMinutes,

        songActive: sleepTimerSongActive,

        songRemaining: sleepTimerSongCount,

      }),

    [sleepTimerActive, sleepTimerMinutes, sleepTimerSongActive, sleepTimerSongCount],

  );

  // 控制栏淡入淡出
  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: controlsVisible ? 1 : 0,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [controlsVisible, fadeAnim]);

  // 打开时重置控制栏可见；手机端恢复「封面页」
  useEffect(() => {
    if (visible) {
      setControlsVisible(true);
      setCurrentPage(0);
    }
  }, [visible]);

  // 平板：封面常驻（对齐桌面）；手机：封面由 PosterMode 始终渲染，不单独控制显隐

  const showCoverSection = isTablet;

  const coverSize = isTablet

    ? Math.min(Math.max(windowWidth * 0.32, 260), 420)

    : Math.min(Math.max((layoutWidth || windowWidth) * 0.42, 148), 220);

  const handleTogglePlay = async () => {
    if (isPlaying) {
      await pause();
      return;
    }
    try {
      await resume();
      const after = usePlayerStore.getState();
      if (!after.isPlaying && after.currentIndex >= 0) {
        await playFromQueue(after.currentIndex);
      }
    } catch {
      if (currentIndex >= 0) await playFromQueue(currentIndex);
    }
  };

  const handlePrevious = async () => {
    await playPrevious();
  };

  const handleNext = async () => {
    await playNext();
  };

  const handleTogglePlayMode = async () => {
    await togglePlayMode();
  };

  const handleSeek = async (time: number) => {
    await seekTo(time);
  };

  const handleSetPlaybackRate = async (rate: number) => {
    await setPlaybackRate(rate);
    setRateModalVisible(false);
  };

  const handleSetVolume = async (nextVolume: number) => {
    await setVolume(nextVolume);
    setVolumeModalVisible(false);
  };

  const handleToggleMute = async () => {
    await toggleMute();
  };

  const handlePlayQueueItem = async (index: number) => {
    await playFromQueue(index);
    setQueueModalVisible(false);
  };

  const handleRemoveQueueItem = (index: number) => {
    removeFromQueue(index);
  };

  const handleClearQueue = async () => {

    await clearQueue();

    setQueueModalVisible(false);

  };

  const handleStartSleepTimer = (minutes: number) => {

    startSleepTimer(minutes);

    setSleepModalVisible(false);

    setCustomMinutes("");

  };

  const handleStartSongSleepTimer = (songCount: number) => {

    startSongSleepTimer(songCount);

    setSleepModalVisible(false);

    setCustomSongCount("");

  };

  const handleCancelSleepTimer = () => {

    cancelSleepTimer();

    setSleepModalVisible(false);

  };

  const handleStartCustomSleepTimer = () => {

    const minutes = parseInt(customMinutes, 10);

    if (!Number.isNaN(minutes) && minutes > 0) {

      handleStartSleepTimer(minutes);

    }

  };

  const handleStartCustomSongSleepTimer = () => {

    const songCount = parseInt(customSongCount, 10);

    if (!Number.isNaN(songCount) && songCount > 0) {

      handleStartSongSleepTimer(songCount);

    }

  };

  const handleShare = async () => {
    if (!currentSong) return;
    try {
      await shareMusic(currentSong);
    } catch (error) {
      console.error("Share music error:", error);
    }
  };

  const handleLike = async () => {
    if (!currentSong || liking) return;

    setLiking(true);
    try {
      if (isLiked) {
        await unlikeSong(currentSong);
      } else {
        await likeSong(currentSong);
      }
    } catch (error) {
      console.error("Like/unlike error:", error);
    } finally {
      setLiking(false);
    }
  };

  const toggleControls = () => setControlsVisible((v) => !v);
  const handleToggleControlsVisibility = () => {
    setControlsVisible(controlsVisibility.nextControlsVisible);
  };

  const onLayout = (e: LayoutChangeEvent) => {
    setLayoutWidth(e.nativeEvent.layout.width);
  };

  return {
    visible,
    onClose,
    insets,
    windowWidth,
    isTablet,
    layoutWidth,
    onLayout,
    palette,
    ambientBackground,
    ambientColors,
    setAmbientColors,
    currentSong,
    isPlaying,
    loading,
    position,
    duration,
    playMode,
    volume,
    isMuted,
    playbackRate,
    queue,
    currentIndex,
    lyrics,
    currentLyricIndex,
    artwork,
    controlsVisible,
    posterMode,
    setPosterMode,
    currentPage,
    setCurrentPage,
    isLyricsPage,
    lyricSettingsVisible,
    setLyricSettingsVisible,
    addToPlaylistVisible,
    setAddToPlaylistVisible,
    fadeAnim,
    coverSize,
    showCoverSection,
    playModeControl,
    rateModel,
    volumeModel,
    queueModel,
    sleepTimerControl,
    sleepTimerMinutes,
    sleepTimerActive,
    sleepTimerSongCount,
    sleepTimerSongActive,
    customMinutes,
    customSongCount,
    setCustomMinutes,
    setCustomSongCount,
    rateModalVisible,
    setRateModalVisible,
    queueModalVisible,
    setQueueModalVisible,
    volumeModalVisible,
    setVolumeModalVisible,
    soundEffectModalVisible,
    setSoundEffectModalVisible,
    sleepModalVisible,
    setSleepModalVisible,
    isLiked,
    liking,
    showTranslation,
    setShowTranslation,
    translationControl,
    handleTogglePlay,
    handlePrevious,
    handleNext,
    handleTogglePlayMode,
    handleSeek,
    handleToggleMute,
    handleSetPlaybackRate,
    handleSetVolume,
    handlePlayQueueItem,
    handleRemoveQueueItem,
    handleClearQueue,
    handleStartSleepTimer,
    handleStartSongSleepTimer,
    handleCancelSleepTimer,
    handleStartCustomSleepTimer,
    handleStartCustomSongSleepTimer,
    handleShare,
    handleLike,
    toggleControls,
    handleToggleControlsVisibility,
    currentSongActions,
    controlsVisibility,
  };
}
