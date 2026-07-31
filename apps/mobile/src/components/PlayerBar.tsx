import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  Heart,
  ListPlus,
  Maximize2,
  Music2,
  MoreHorizontal,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  StepBack,
  StepForward,
  Timer,
  Volume2,
  VolumeX,
  X,
} from "lucide-react-native";

import { AddToLocalPlaylistModal } from "@/components/AddToLocalPlaylistModal";
import { CachedImage } from "@/components/CachedImage";
import { ProgressBar } from "@/components/ProgressBar";
import { Touchable } from "@/components/Touchable";
import {
  canDrawOverlays,
  hideLyricOverlay,
  isLyricOverlaySupported,
  requestOverlayPermission,
  setLyricOverlayLocked,
  showLyricOverlay,
  updateLyricOverlay,
} from "@/services/lyricOverlayService";
import type { MobilePlayMode } from "@/services/mobilePlayModeModel";
import {
  formatTime,
  getCurrentLyricIndex,
  playFromQueue,
  playNext,
  playPrevious,
} from "@/services/playerService";
import { buildMobileSleepTimerControl } from "@/services/songSleepTimerModel";
import { useLyricOverlayStore } from "@/stores/lyricOverlayStore";
import { usePlayerStore } from "@/stores/playerStore";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { radius, spacing, touch, typography } from "@/theme/tokens";

export interface PlayerBarProps {
  onOpen: () => void;
  bottomInset?: number;
}

const PLAY_MODE_ICONS: Record<MobilePlayMode, React.ComponentType<{ size: number; color: string }>> = {
  list: Repeat,
  single: Repeat1,
  shuffle: Shuffle,
  sequence: Repeat,
};

function showActionError(title: string, error: unknown) {
  Alert.alert(title, error instanceof Error ? error.message : String(error));
}

export function PlayerBar({ onOpen, bottomInset = 0 }: PlayerBarProps) {
  const currentSong = usePlayerStore((state) => state.currentSong);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const loading = usePlayerStore((state) => state.loading);
  const position = usePlayerStore((state) => state.position);
  const duration = usePlayerStore((state) => state.duration);
  const playMode = usePlayerStore((state) => state.playMode);
  const volume = usePlayerStore((state) => state.volume);
  const isMuted = usePlayerStore((state) => state.isMuted);
  const lyrics = usePlayerStore((state) => state.lyrics);
  const sleepTimerMinutes = usePlayerStore((state) => state.sleepTimerMinutes);
  const sleepTimerActive = usePlayerStore((state) => state.sleepTimerActive);
  const sleepTimerSongCount = usePlayerStore((state) => state.sleepTimerSongCount);
  const sleepTimerSongActive = usePlayerStore((state) => state.sleepTimerSongActive);
  const pause = usePlayerStore((state) => state.pause);
  const resume = usePlayerStore((state) => state.resume);
  const seekTo = usePlayerStore((state) => state.seekTo);
  const togglePlayMode = usePlayerStore((state) => state.togglePlayMode);
  const toggleMute = usePlayerStore((state) => state.toggleMute);
  const setVolume = usePlayerStore((state) => state.setVolume);
  const startSleepTimer = usePlayerStore((state) => state.startSleepTimer);
  const startSongSleepTimer = usePlayerStore((state) => state.startSongSleepTimer);
  const cancelSleepTimer = usePlayerStore((state) => state.cancelSleepTimer);

  const overlayVisible = useLyricOverlayStore((state) => state.visible);
  const overlayLocked = useLyricOverlayStore((state) => state.locked);
  const overlayLoaded = useLyricOverlayStore((state) => state.loaded);
  const loadOverlayState = useLyricOverlayStore((state) => state.loadFromStorage);
  const setOverlayVisible = useLyricOverlayStore((state) => state.setVisible);

  const themeMode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = useMemo(
    () => getThemePalette(getResolvedTheme(themeMode, systemTheme), accentColor),
    [themeMode, systemTheme, accentColor],
  );

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [sleepModalOpen, setSleepModalOpen] = useState(false);

  const sleepTimerControl = buildMobileSleepTimerControl({
    minuteActive: sleepTimerActive,
    minuteRemaining: sleepTimerMinutes,
    songActive: sleepTimerSongActive,
    songRemaining: sleepTimerSongCount,
  });

  useEffect(() => {
    if (overlayLoaded) return;
    void loadOverlayState();
  }, [loadOverlayState, overlayLoaded]);

  useEffect(() => {
    if (currentSong || !overlayVisible) return;
    void (async () => {
      try {
        await hideLyricOverlay();
        await setOverlayVisible(false);
      } catch (error) {
        console.error("[lyric overlay] no-song hide failed", error);
        showActionError("关闭悬浮歌词失败", error);
      }
    })();
  }, [currentSong, overlayVisible, setOverlayVisible]);

  useEffect(() => {
    if (!overlayVisible || !currentSong) return;

    const currentIndex = getCurrentLyricIndex(lyrics, position);
    const currentLine = lyrics[currentIndex];
    const nextLine = lyrics[currentIndex + 1];
    const lineDuration = (nextLine?.time ?? position) - (currentLine?.time ?? position);
    const lineProgress = lineDuration > 0
      ? Math.max(0, Math.min(1, (position - (currentLine?.time ?? position)) / lineDuration))
      : 0;

    void updateLyricOverlay(currentLine?.text ?? "", nextLine?.text ?? "", lineProgress).catch(
      (error: unknown) => {
        console.error("[lyric overlay] lyric update failed", error);
      },
    );
  }, [currentSong, lyrics, overlayVisible, position]);

  useEffect(() => {
    if (!overlayVisible || !currentSong) return;
    void setLyricOverlayLocked(overlayLocked).catch((error: unknown) => {
      console.error("[lyric overlay] lock sync failed", error);
    });
  }, [currentSong, overlayLocked, overlayVisible]);

  if (!currentSong) return null;

  const coverUrl = currentSong.picUrl || currentSong.img;
  const PlayModeIcon = PLAY_MODE_ICONS[playMode];

  const handleTogglePlayback = async () => {
    try {
      if (isPlaying) {
        await pause();
        return;
      }

      await resume();
      const state = usePlayerStore.getState();
      if (!state.isPlaying && state.currentIndex >= 0) {
        await playFromQueue(state.currentIndex);
      }
    } catch (error) {
      showActionError("播放操作失败", error);
    }
  };

  const handleToggleOverlay = async () => {
    try {
      if (overlayVisible) {
        await hideLyricOverlay();
        await setOverlayVisible(false);
        return;
      }

      if (!isLyricOverlaySupported()) {
        Alert.alert("无法显示悬浮歌词", "当前设备不支持原生悬浮歌词。");
        return;
      }

      let granted = await canDrawOverlays();
      if (!granted) {
        granted = await requestOverlayPermission();
      }
      if (!granted) {
        Alert.alert("悬浮歌词权限未开启", "请在系统设置中允许应用显示在其他应用上层。");
        return;
      }

      const shown = await showLyricOverlay();
      if (!shown) {
        Alert.alert("悬浮歌词显示失败", "原生悬浮歌词窗口未能打开，请重试。");
        return;
      }
      await setOverlayVisible(true);
    } catch (error) {
      showActionError("悬浮歌词操作失败", error);
    }
  };

  const handlePlayerAction = async (action: () => Promise<void>) => {
    try {
      await action();
    } catch (error) {
      showActionError("播放操作失败", error);
    }
  };

  const closeAddModal = () => setAddModalOpen(false);

  return (
    <View
      style={[
        styles.root,
        {
          paddingBottom: bottomInset,
          backgroundColor: palette.surface,
          borderTopColor: palette.border,
        },
      ]}
    >
      <View
        style={styles.progressRow}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="播放进度"
        accessibilityValue={{ min: 0, max: Math.max(duration, 0), now: Math.max(position, 0) }}
      >
        <ProgressBar position={position} duration={duration} onSeek={seekTo} />
      </View>

      <View style={styles.content}>
        <Touchable
          onPress={onOpen}
          style={styles.trackSummary}
          accessibilityRole="button"
          accessibilityLabel="打开沉浸式播放器"
        >
          {coverUrl ? (
            <CachedImage
              uri={coverUrl}
              style={styles.cover}
              fallback={
                <View style={[styles.cover, styles.coverFallback, { backgroundColor: palette.surfaceStrong }]}>
                  <Music2 size={22} color={palette.primary} />
                </View>
              }
            />
          ) : (
            <View style={[styles.cover, styles.coverFallback, { backgroundColor: palette.surfaceStrong }]}>
              <Music2 size={22} color={palette.primary} />
            </View>
          )}
          <View style={styles.trackText}>
            <Text style={[styles.trackName, { color: palette.text }]} numberOfLines={1}>
              {currentSong.name}
            </Text>
            <Text style={[styles.trackArtist, { color: palette.textMuted }]} numberOfLines={1}>
              {currentSong.singer || "未知艺术家"}
            </Text>
          </View>
        </Touchable>

        <View style={styles.transportControls}>
          <Touchable
            onPress={() => void handlePlayerAction(togglePlayMode)}
            style={styles.iconButton}
            accessibilityRole="button"
            accessibilityLabel="播放模式"
          >
            <PlayModeIcon size={20} color={palette.text} />
          </Touchable>
          <Touchable
            onPress={() => void handlePlayerAction(playPrevious)}
            style={styles.iconButton}
            accessibilityRole="button"
            accessibilityLabel="上一首"
          >
            <StepBack size={21} color={palette.text} />
          </Touchable>
          {isPlaying ? (
            <Touchable
              disabled={loading}
              onPress={() => void handleTogglePlayback()}
              style={[styles.playButton, { backgroundColor: palette.primary }]}
              accessibilityRole="button"
              accessibilityLabel="暂停"
            >
              {loading ? (
                <ActivityIndicator color={palette.primaryText} size="small" />
              ) : (
                <Pause size={22} color={palette.primaryText} fill={palette.primaryText} />
              )}
            </Touchable>
          ) : (
            <Touchable
              disabled={loading}
              onPress={() => void handleTogglePlayback()}
              style={[styles.playButton, { backgroundColor: palette.primary }]}
              accessibilityRole="button"
              accessibilityLabel="播放"
            >
              {loading ? (
                <ActivityIndicator color={palette.primaryText} size="small" />
              ) : (
                <Play size={22} color={palette.primaryText} fill={palette.primaryText} />
              )}
            </Touchable>
          )}
          <Touchable
            onPress={() => void handlePlayerAction(playNext)}
            style={styles.iconButton}
            accessibilityRole="button"
            accessibilityLabel="下一首"
          >
            <StepForward size={21} color={palette.text} />
          </Touchable>
        </View>

        <View style={styles.utilityControls}>
          <Touchable
            onPress={() => setAddModalOpen(true)}
            style={styles.iconButton}
            accessibilityRole="button"
            accessibilityLabel="添加到歌单"
          >
            <ListPlus size={20} color={palette.text} />
          </Touchable>
          <Touchable
            onPress={() => void handleToggleOverlay()}
            style={[
              styles.iconButton,
              overlayVisible && { backgroundColor: palette.surfaceStrong },
            ]}
            accessibilityRole="button"
            accessibilityLabel="歌词"
            accessibilityState={{ selected: overlayVisible }}
          >
            <Music2 size={20} color={overlayVisible ? palette.primary : palette.text} />
          </Touchable>
          <Touchable
            onPress={() => setMoreMenuOpen(true)}
            style={styles.iconButton}
            accessibilityRole="button"
            accessibilityLabel="更多"
          >
            <MoreHorizontal size={20} color={palette.text} />
          </Touchable>
        </View>
      </View>

      <Modal
        visible={moreMenuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setMoreMenuOpen(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setMoreMenuOpen(false)}>
          <View
            style={[
              styles.moreMenu,
              { backgroundColor: palette.surface, borderColor: palette.border },
            ]}
          >
            <Touchable
              onPress={() => {
                setMoreMenuOpen(false);
                setSleepModalOpen(true);
              }}
              style={styles.moreMenuItem}
              accessibilityRole="button"
            >
              <Timer size={20} color={palette.text} />
              <Text style={[styles.moreMenuText, { color: palette.text }]}>睡眠定时</Text>
              {sleepTimerControl.active && (
                <Text style={[styles.moreMenuMeta, { color: palette.primary }]}>{sleepTimerControl.label}</Text>
              )}
            </Touchable>
            <Touchable
              onPress={() => {
                setMoreMenuOpen(false);
                void handlePlayerAction(toggleMute);
              }}
              style={styles.moreMenuItem}
              accessibilityRole="button"
            >
              {isMuted ? (
                <VolumeX size={20} color={palette.primary} />
              ) : (
                <Volume2 size={20} color={palette.text} />
              )}
              <Text style={[styles.moreMenuText, { color: palette.text }]}>
                {isMuted ? "取消静音" : "静音"}
              </Text>
            </Touchable>
            <Touchable
              onPress={() => {
                setMoreMenuOpen(false);
                onOpen();
              }}
              style={styles.moreMenuItem}
              accessibilityRole="button"
            >
              <Maximize2 size={20} color={palette.text} />
              <Text style={[styles.moreMenuText, { color: palette.text }]}>全屏播放</Text>
            </Touchable>
          </View>
        </Pressable>
      </Modal>

      <Modal
        visible={sleepModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setSleepModalOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.sleepPanel,
              { backgroundColor: palette.surface, borderColor: palette.border },
            ]}
          >
            <View style={styles.modalHeader}>
              <View style={styles.modalTitleGroup}>
                <Text style={[styles.modalTitle, { color: palette.text }]}>睡眠定时器</Text>
                <Text style={[styles.modalStatus, { color: palette.textMuted }]}>
                  {sleepTimerControl.label}
                </Text>
              </View>
              <Touchable
                onPress={() => setSleepModalOpen(false)}
                style={styles.iconButton}
                accessibilityRole="button"
                accessibilityLabel="关闭睡眠定时器设置"
              >
                <X size={20} color={palette.text} />
              </Touchable>
            </View>

            <Text style={[styles.optionTitle, { color: palette.textMuted }]}>按时间停止</Text>
            <View style={styles.optionRow}>
              {sleepTimerControl.minutePresets.map((minutes) => (
                <Pressable
                  key={minutes}
                  onPress={() => {
                    startSleepTimer(minutes);
                    setSleepModalOpen(false);
                  }}
                  style={[
                    styles.optionButton,
                    {
                      backgroundColor:
                        sleepTimerActive && sleepTimerMinutes === minutes
                          ? palette.primary
                          : palette.surfaceMuted,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`${minutes} 分钟后停止`}
                >
                  <Text
                    style={[
                      styles.optionText,
                      {
                        color:
                          sleepTimerActive && sleepTimerMinutes === minutes
                            ? palette.primaryText
                            : palette.text,
                      },
                    ]}
                  >
                    {minutes} 分钟
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={[styles.optionTitle, { color: palette.textMuted }]}>按歌曲数停止</Text>
            <View style={styles.optionRow}>
              {sleepTimerControl.songCountPresets.map((songCount) => (
                <Pressable
                  key={songCount}
                  onPress={() => {
                    startSongSleepTimer(songCount);
                    setSleepModalOpen(false);
                  }}
                  style={[
                    styles.optionButton,
                    {
                      backgroundColor:
                        sleepTimerSongActive && sleepTimerSongCount === songCount
                          ? palette.primary
                          : palette.surfaceMuted,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`听完 ${songCount} 首后停止`}
                >
                  <Text
                    style={[
                      styles.optionText,
                      {
                        color:
                          sleepTimerSongActive && sleepTimerSongCount === songCount
                            ? palette.primaryText
                            : palette.text,
                      },
                    ]}
                  >
                    {songCount} 首
                  </Text>
                </Pressable>
              ))}
            </View>

            {sleepTimerControl.active ? (
              <Pressable
                onPress={() => {
                  cancelSleepTimer();
                  setSleepModalOpen(false);
                }}
                style={[styles.cancelButton, { borderColor: palette.danger }]}
                accessibilityRole="button"
                accessibilityLabel="取消定时关闭"
              >
                <Text style={[styles.cancelText, { color: palette.danger }]}>取消定时</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </Modal>

      <AddToLocalPlaylistModal
        visible={addModalOpen}
        song={currentSong}
        onClose={closeAddModal}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.xs,
  },
  progressRow: {
    paddingHorizontal: spacing.s,
  },
  content: {
    paddingHorizontal: spacing.s,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.xs,
  },
  trackSummary: {
    minHeight: touch.minTarget,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  cover: {
    width: touch.minTarget,
    height: touch.minTarget,
    borderRadius: radius.sm,
  },
  coverFallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  trackText: {
    flex: 1,
    minWidth: 0,
  },
  trackName: {
    fontSize: typography.body,
    fontWeight: "700",
  },
  trackArtist: {
    marginTop: 2,
    fontSize: typography.caption,
  },
  transportControls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  utilityControls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 2,
  },
  iconButton: {
    minWidth: touch.minTarget,
    minHeight: touch.minTarget,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  playButton: {
    minWidth: touch.minTarget,
    minHeight: touch.minTarget,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  moreMenu: {
    margin: spacing.m,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    overflow: "hidden",
  },
  moreMenuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.s,
    minHeight: touch.minTarget,
  },
  moreMenuText: {
    flex: 1,
    fontSize: typography.body,
    fontWeight: "500",
  },
  moreMenuMeta: {
    fontSize: typography.caption,
  },
  sleepPanel: {
    margin: spacing.m,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: spacing.m,
    gap: spacing.s,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.s,
  },
  modalTitleGroup: {
    flex: 1,
  },
  modalTitle: {
    fontSize: typography.heading,
    fontWeight: "700",
  },
  modalStatus: {
    marginTop: 2,
    fontSize: typography.caption,
  },
  optionTitle: {
    fontSize: typography.meta,
    fontWeight: "600",
  },
  optionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  optionButton: {
    minHeight: touch.minTarget,
    minWidth: 88,
    paddingHorizontal: spacing.s,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  optionText: {
    fontSize: typography.body,
    fontWeight: "600",
  },
  cancelButton: {
    minHeight: touch.minTarget,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelText: {
    fontSize: typography.body,
    fontWeight: "600",
  },
});
