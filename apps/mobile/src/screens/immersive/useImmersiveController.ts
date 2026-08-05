import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Animated, PanResponder, type LayoutChangeEvent, useWindowDimensions } from "react-native";
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
import { saveCoverToDownloads } from "@/services/downloadService";
import { buildImmersiveTranslationControl, buildImmersiveChineseConversionControl } from "@/services/lyricSettingsModel";
import { useLyricSettingsStore } from "@/stores/lyricSettingsStore";
import { usePlayerStore } from "@/stores/playerStore";
import { usePlaylistStore } from "@/stores/playlistStore";
import { useDownloadStore, type DownloadQuality } from "@/stores/downloadStore";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { useDeviceForm } from "@/utils/responsive";

export interface UseImmersiveControllerArgs {
  visible: boolean;
  onClose: () => void;
}

/** 控件自动隐藏间隔（毫秒） */
const CONTROLS_AUTO_HIDE_MS = 3000;

/** 沉浸式播放页状态与操作（Phase 2） */
export function useImmersiveController({ visible, onClose }: UseImmersiveControllerArgs) {
  const insets = useSafeAreaInsets();

  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

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
  const downloadSong = useDownloadStore((s) => s.downloadSong);
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

  const chineseConversion = useLyricSettingsStore((s) => s.chineseConversion);

  const setChineseConversion = useLyricSettingsStore((s) => s.setChineseConversion);

  const isLiked = usePlaylistStore((s) => s.isLiked(currentSong));
  const likeSong = usePlaylistStore((s) => s.likeSong);
  const unlikeSong = usePlaylistStore((s) => s.unlikeSong);

  const [posterMode, setPosterMode] = useState(false);

  // PagerView 页面索引：0=封面, 1=歌词（手机端使用）
  const [currentPage, setCurrentPage] = useState(0);

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

  const [coverMenuVisible, setCoverMenuVisible] = useState(false);

  const [coverSongDownloadVisible, setCoverSongDownloadVisible] = useState(false);

  const [liking, setLiking] = useState(false);

  const fadeAnim = useRef(new Animated.Value(1)).current;

  // ── 控件 3s 自动隐藏：任意交互时显示并重置计时，静止 3s 自动隐藏 ──
  const controlsAutoHideRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearControlsAutoHide = useCallback(() => {
    if (controlsAutoHideRef.current) {
      clearTimeout(controlsAutoHideRef.current);
      controlsAutoHideRef.current = null;
    }
  }, []);

  const scheduleControlsAutoHide = useCallback(() => {
    clearControlsAutoHide();
    controlsAutoHideRef.current = setTimeout(() => {
      controlsAutoHideRef.current = null;
      setControlsVisible(false);
    }, CONTROLS_AUTO_HIDE_MS);
  }, [clearControlsAutoHide]);

  /** 显示控制栏并重置自动隐藏计时（供点按/交互恢复） */
  const pokeControls = useCallback(() => {
    setControlsVisible(true);
    scheduleControlsAutoHide();
  }, [scheduleControlsAutoHide]);

  // 手机端 PagerView 的歌词页标记（0=封面,1=歌词）
  const isLyricsPage = !isTablet && currentPage === 1;

  // 供下滑关闭使用的实时引用（避免 PanResponder 闭包过期）
  const isLyricsPageRef = useRef(isLyricsPage);
  useEffect(() => {
    isLyricsPageRef.current = isLyricsPage;
  }, [isLyricsPage]);

  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // 点住封面区域下拉关闭播放页（歌词页禁用以避免与歌词纵向滚动冲突）
  const dismissResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) =>
        !isLyricsPageRef.current && g.dy > 80 && g.dy > Math.abs(g.dx) * 1.5,
      onPanResponderRelease: (_, g) => {
        if (!isLyricsPageRef.current && g.dy > 120) onCloseRef.current();
      },
    })
  ).current;

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

  const chineseConversionControl = useMemo(

    () => buildImmersiveChineseConversionControl(chineseConversion),

    [chineseConversion]

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

  // 打开时重置控制栏可见并启动自动隐藏；手机端恢复「封面页」
  useEffect(() => {
    if (visible) {
      setControlsVisible(true);
      setCurrentPage(0);
      scheduleControlsAutoHide();
    } else {
      clearControlsAutoHide();
    }
    return clearControlsAutoHide;
  }, [visible, scheduleControlsAutoHide, clearControlsAutoHide]);

  // 平板：封面常驻（对齐桌面）；手机：封面由 PosterMode 始终渲染，不单独控制显隐

  const showCoverSection = isTablet;

  // 高度约束：横屏/分屏等矮窗口下避免封面溢出（顶部栏 + 控制条 + 迷你歌词预留）
  const maxCoverByHeight = Math.max(148, (windowHeight || 0) - 260);

  const coverSize = Math.min(
    isTablet
      ? Math.min(Math.max(windowWidth * 0.32, 260), 420)
      : Math.min(Math.max((layoutWidth || windowWidth) * 0.42, 148), 220),
    maxCoverByHeight
  );

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

  const openCoverMenu = () => {
    setCoverMenuVisible(true);
    pokeControls();
  };
  const closeCoverMenu = () => setCoverMenuVisible(false);
  const openCoverSongDownload = () => {
    setCoverMenuVisible(false);
    setCoverSongDownloadVisible(true);
  };
  const closeCoverSongDownload = () => setCoverSongDownloadVisible(false);
  const handleCoverSongDownload = async (quality: DownloadQuality) => {
    setCoverSongDownloadVisible(false);
    if (!currentSong) return;
    try {
      await downloadSong(currentSong, quality);
    } catch (error) {
      Alert.alert("下载失败", error instanceof Error ? error.message : String(error));
    }
  };
  const handleCoverDownload = async () => {
    setCoverMenuVisible(false);
    if (!currentSong) return;
    const path = await saveCoverToDownloads(currentSong);
    if (path) {
      Alert.alert("封面已保存", path);
    } else {
      Alert.alert("保存封面失败", "无法获取该曲目封面");
    }
  };

  const toggleControls = () => {
    if (!controlsVisible) scheduleControlsAutoHide();
    setControlsVisible((v) => !v);
  };
  const handleToggleControlsVisibility = () => {
    const next = controlsVisibility.nextControlsVisible;
    setControlsVisible(next);
    if (next) scheduleControlsAutoHide();
  };

  const onLayout = (e: LayoutChangeEvent) => {
    setLayoutWidth(e.nativeEvent.layout.width);
  };

  return {
    visible,
    onClose,
    dismissResponder: dismissResponder.panHandlers,
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
    isLyricsPage,
    posterMode,
    setPosterMode,
    currentPage,
    setCurrentPage,
    lyricSettingsVisible,
    setLyricSettingsVisible,
    addToPlaylistVisible,
    setAddToPlaylistVisible,
    coverMenuVisible,
    openCoverMenu,
    closeCoverMenu,
    coverSongDownloadVisible,
    openCoverSongDownload,
    closeCoverSongDownload,
    handleCoverSongDownload,
    handleCoverDownload,
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
    chineseConversion,
    setChineseConversion,
    chineseConversionControl,
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
    pokeControls,
    handleToggleControlsVisibility,
    currentSongActions,
    controlsVisibility,
  };
}
