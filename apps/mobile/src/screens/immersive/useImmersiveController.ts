import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, type LayoutChangeEvent, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { buildImmersiveCurrentSongActions } from "@/services/currentSongActions";
import { buildImmersivePlayModeControl } from "@/services/mobilePlayModeModel";
import { buildImmersivePlaybackRateModel } from "@/services/playerRateModel";
import { buildImmersiveQueuePanelModel } from "@/services/playerQueueModel";
import { buildImmersiveVolumeControlModel } from "@/services/playerVolumeModel";
import { buildMobileSleepTimerControl } from "@/services/songSleepTimerModel";
import { playFromQueue, playNext, playPrevious } from "@/services/playerService";
import { useLyricLineIndex } from "@/hooks/useLyricLineIndex";
import { shareMusic } from "@/services/shareMusicService";
import { saveCoverToDownloads } from "@/services/downloadService";
import { buildImmersiveTranslationControl, buildImmersiveChineseConversionControl } from "@/services/lyricSettingsModel";
import { useLyricSettingsStore } from "@/stores/lyricSettingsStore";
import { usePlayerStore } from "@/stores/playerStore";
import { useLyricOverlayStore } from "@/stores/lyricOverlayStore";
import {
  canDrawOverlays,
  hideLyricOverlay,
  isLyricOverlaySupported,
  requestOverlayPermission,
  showLyricOverlay,
} from "@/services/lyricOverlayService";
import { useFavoritesStore } from "@/stores/favoritesStore";
import { useDownloadStore, type DownloadQuality } from "@/stores/downloadStore";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { openArtistDetailScreen } from "@/navigation/navigationRef";
import type { SearchArtistResult } from "@/services/musicApi";

export interface UseImmersiveControllerArgs {
  visible: boolean;
  onClose: () => void;
}

/** 沉浸式播放页状态与操作（对齐 lx 竖屏播放器：控件常驻，不做自动隐藏） */
export function useImmersiveController({ visible, onClose }: UseImmersiveControllerArgs) {
  const insets = useSafeAreaInsets();

  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  const currentSong = usePlayerStore((s) => s.currentSong);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const loading = usePlayerStore((s) => s.loading);
  // 进度（position/buffered/duration）已下沉到 ImmersiveTransport 内部订阅，
  // 本控制器不再随 0.25s 进度事件高频重渲染。
  const manualOffsetMs = useLyricSettingsStore((s) => s.manualOffsetMs);
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
  // palette 引用稳定化：播放进度 0.25s 触发一次控制器重渲染，但主题不变时 palette 不应是新对象，
  // 否则所有接收 palette 的子组件（含 memo 化的背景层）都会被拖着重渲染。
  const palette = useMemo(
    () => getThemePalette(getResolvedTheme(mode, systemTheme), accentColor),
    [mode, systemTheme, accentColor],
  );

  const showTranslation = useLyricSettingsStore((s) => s.showTranslation);

  const setShowTranslation = useLyricSettingsStore((s) => s.setShowTranslation);

  const chineseConversion = useLyricSettingsStore((s) => s.chineseConversion);

  const setChineseConversion = useLyricSettingsStore((s) => s.setChineseConversion);

  // 心形 = 本地收藏（对齐桌面端 favoritesStore），不再调用网易云红心接口
  const isLiked = useFavoritesStore((s) => s.isFavorite(currentSong));
  const toggleFavorite = useFavoritesStore((s) => s.toggleFavorite);

  // PagerView 页面索引：0=封面, 1=歌词（手机端使用）
  const [currentPage, setCurrentPage] = useState(0);

  const [layoutWidth, setLayoutWidth] = useState(0);
  const [rateModalVisible, setRateModalVisible] = useState(false);
  const [queueModalVisible, setQueueModalVisible] = useState(false);
  const [volumeModalVisible, setVolumeModalVisible] = useState(false);

  const [playSettingVisible, setPlaySettingVisible] = useState(false);

  const [sleepModalVisible, setSleepModalVisible] = useState(false);

  const [customMinutes, setCustomMinutes] = useState("");

  const [customSongCount, setCustomSongCount] = useState("");

  const [addToPlaylistVisible, setAddToPlaylistVisible] = useState(false);

  const [coverMenuVisible, setCoverMenuVisible] = useState(false);

  const [coverSongDownloadVisible, setCoverSongDownloadVisible] = useState(false);

  const [commentsVisible, setCommentsVisible] = useState(false);


  // PagerView 的歌词页标记（0=封面,1=歌词）
  const isLyricsPage = currentPage === 1;

  // 下拉关闭手势已迁移到 ImmersiveLyricsScreen（Gesture.Pan + reanimated 跟手位移）
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // lx 式行变更触发：行号只在歌词行切换时更新（不随 0.25s 进度事件高频重渲染）
  const currentLyricIndex = useLyricLineIndex(lyrics, manualOffsetMs);

  const artwork = currentSong?.picUrl || currentSong?.img;

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

  // 打开时手机端恢复「封面页」
  useEffect(() => {
    if (visible) setCurrentPage(0);
  }, [visible]);

  // 封面尺寸对齐 lx 竖屏播放器：宽度的 85% 与可用高度的一半取较小值
  // （lx 原公式：Math.min(winWidth * 0.85, (winHeight - statusBar - header) * 0.5)）
  const coverSize = Math.min(
    (layoutWidth || windowWidth) * 0.85,
    Math.max(140, ((windowHeight || 0) - 160) * 0.5)
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
        // 快照恢复后原生无曲：重新播放当前曲并续播上次保存的进度
        await playFromQueue(after.currentIndex, after.position);
      }
    } catch {
      if (currentIndex >= 0) {
        await playFromQueue(currentIndex, usePlayerStore.getState().position);
      }
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

    // Number("") 为 0、Number("abc") 为 NaN，统一走严格校验；
    // 小数输入四舍五入到整数分钟（parseInt 会把 "1.5" 静默截成 1）
    const minutes = Math.round(Number(customMinutes));

    if (Number.isFinite(minutes) && minutes > 0) {

      handleStartSleepTimer(minutes);

    }

  };

  const handleStartCustomSongSleepTimer = () => {

    const songCount = Math.round(Number(customSongCount));

    if (Number.isFinite(songCount) && songCount > 0) {

      handleStartSongSleepTimer(songCount);

    }

  };

  const handleShare = async () => {
    if (!currentSong) return;
    try {
      await shareMusic(currentSong);
    } catch {}
  };

  // 顶部歌手点击 → 跳转歌手详情（仅网易云源支持详情，其它源禁用回调）。
  const handleOpenArtist = useCallback(() => {
    if (!currentSong || currentSong.source !== "wy" || !currentSong.artistId || !currentSong.singer) return;
    const artist: SearchArtistResult = {
      id: currentSong.artistId,
      name: currentSong.singer,
      source: "wy",
    };
    // 播放页整体包在 RN Modal 里（浮于导航栈之上）：必须先关闭本页再压路由，
    // 否则新页面被 Modal 盖住不可见，且关闭按钮会误弹栈底下的新路由
    onCloseRef.current();
    openArtistDetailScreen(artist);
  }, [currentSong]);
  const canOpenArtist = currentSong?.source === "wy" && !!currentSong?.artistId && !!currentSong?.singer;

  // 桌面歌词（悬浮歌词 overlay）切换：能力不支持的设备显式报错，不静默失败
  const floatingLyricActive = useLyricOverlayStore((s) => s.visible);
  const setFloatingLyricVisible = useLyricOverlayStore((s) => s.setVisible);

  const handleToggleFloatingLyric = async () => {
    if (!isLyricOverlaySupported()) {
      Alert.alert("悬浮歌词不可用", "当前设备不支持原生悬浮歌词");
      return;
    }
    try {
      if (floatingLyricActive) {
        await hideLyricOverlay();
        await setFloatingLyricVisible(false);
        return;
      }

      // 打开前先确认悬浮窗权限：无权限时引导系统授权，而不是直接报操作失败
      if (!(await canDrawOverlays())) {
        const granted = await requestOverlayPermission();
        if (!granted) {
          Alert.alert(
            "需要悬浮窗权限",
            "悬浮歌词需要「显示在其他应用上层」权限，请在系统设置中授权后重试",
          );
          return;
        }
      }

      if (!(await showLyricOverlay())) {
        throw new Error("原生悬浮歌词窗口未能打开");
      }
      await setFloatingLyricVisible(true);
    } catch (error) {
      Alert.alert("悬浮歌词操作失败", error instanceof Error ? error.message : String(error));
    }
  };

  const handleLike = () => {
    if (!currentSong) return;
    toggleFavorite(currentSong);
  };

  const openCoverMenu = () => {
    setCoverMenuVisible(true);
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
    const result = await downloadSong(currentSong, quality);
    if (result.status === "failed") {
      Alert.alert("下载失败", result.error ?? "下载失败");
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

  const onLayout = (e: LayoutChangeEvent) => {
    setLayoutWidth(e.nativeEvent.layout.width);
  };

  return {
    visible,
    onClose,
    insets,
    layoutWidth,
    onLayout,
    palette,
    currentSong,
    isPlaying,
    loading,
    playMode,
    volume,
    isMuted,
    playbackRate,
    queue,
    currentIndex,
    lyrics,
    currentLyricIndex,
    artwork,
    isLyricsPage,
    currentPage,
    setCurrentPage,
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
    commentsVisible,
    setCommentsVisible,
    coverSize,
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
    playSettingVisible,
    setPlaySettingVisible,
    sleepModalVisible,
    setSleepModalVisible,
    isLiked,
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
    handleOpenArtist,
    canOpenArtist,
    handleLike,
    floatingLyricActive,
    handleToggleFloatingLyric,
    currentSongActions,
  };
}
