import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import PagerView from "react-native-pager-view";
import LinearGradient from "react-native-linear-gradient";
import KeepAwake from "react-native-keep-awake";

import { LyricView } from "@/components/LyricView";
import { AddToLocalPlaylistModal } from "@/components/AddToLocalPlaylistModal";
import { MiniLyric } from "@/components/MiniLyric";
import { DownloadQualityModal } from "@/components/DownloadQualityModal";
import { ImmersiveTopBar } from "@/screens/immersive/ImmersiveTopBar";
import { ImmersiveTransport } from "@/screens/immersive/ImmersiveTransport";
import { ImmersiveCommentsSheet } from "@/screens/immersive/ImmersiveCommentsSheet";
import { ImmersiveModals } from "@/screens/immersive/ImmersiveModals";
import { ImmersivePlaySettingSheet } from "@/screens/immersive/ImmersivePlaySettingSheet";
import { ImmersiveCoverPage } from "@/screens/immersive/ImmersiveCoverPage";
import { styles } from "@/screens/immersive/immersiveStyles";
import { useImmersiveController } from "@/screens/immersive/useImmersiveController";
import { fetchCoverColors, type CoverColors } from "@/services/coverColorService";
import { withAlpha } from "@/services/themePaletteModel";
import { getResolvedTheme, useThemeStore } from "@/stores/themeStore";
import { useLyricSettingsStore } from "@/stores/lyricSettingsStore";
import { openMvPlayerScreen } from "@/navigation";

export interface ImmersiveLyricsScreenProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * 播放页（对齐 lx 竖屏播放器）：
 * - 状态/操作 → useImmersiveController
 * - UI → TopBar / PagerView(封面|歌词) / Transport / Modals
 * - 纯主题色背景，控件常驻（不再做桌面端风格的模糊背景与自动隐藏）
 */
export function ImmersiveLyricsScreen({ visible, onClose }: ImmersiveLyricsScreenProps) {
  const showLyricProgress = useLyricSettingsStore((s) => s.showLyricProgress);
  const ambientCoverTint = useLyricSettingsStore((s) => s.ambientCoverTint);
  const themeMode = useThemeStore((s) => s.mode);
  const systemTheme = useThemeStore((s) => s.systemTheme);
  const isDark = getResolvedTheme(themeMode, systemTheme) === "dark";
  const pagerViewRef = React.useRef<PagerView>(null);

  const {
    insets,
    layoutWidth,
    onLayout,
    palette,
    currentSong,
    isPlaying,
    loading,
    playMode,
    lyrics,
    currentLyricIndex,
    artwork,
    currentPage,
    setCurrentPage,
    isLyricsPage,
    addToPlaylistVisible,
    setAddToPlaylistVisible,
    coverSize,
    handleOpenArtist,
    canOpenArtist,
    playModeControl,
    rateModel,
    volumeModel,
    queue,
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
    showTranslation,

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
    floatingLyricActive,
    handleToggleFloatingLyric,
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
    dismissResponder,
    currentSongActions,
    handleLike,
    isLiked,
  } = useImmersiveController({ visible, onClose });

  // 氛围色背景：从封面提取主色，仅在开关打开且取色成功时叠加渐变
  const [ambient, setAmbient] = React.useState<CoverColors>({ base: "", accent: "" });
  React.useEffect(() => {
    if (!visible || !ambientCoverTint || !artwork) {
      setAmbient({ base: "", accent: "" });
      return;
    }
    let cancelled = false;
    void fetchCoverColors(artwork, isDark).then((colors) => {
      if (!cancelled) setAmbient(colors);
    });
    return () => {
      cancelled = true;
    };
  }, [visible, ambientCoverTint, artwork, isDark]);

  if (!currentSong) {
    return null;
  }

  const currentMvId = currentSong.source === "wy" ? currentSong.mvId : undefined;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View
        {...dismissResponder}
        style={[styles.root, { backgroundColor: palette.background }]}
        onLayout={onLayout}
      >
        {/* 氛围色背景（可选开关）：封面主色自上而下淡出的渐变，压在内容层之下 */}
        {ambientCoverTint && ambient.base ? (
          <LinearGradient
            pointerEvents="none"
            style={StyleSheet.absoluteFill}
            colors={[
              withAlpha(ambient.base, isDark ? 0.42 : 0.3),
              withAlpha(ambient.base, isDark ? 0.14 : 0.1),
              withAlpha(ambient.base, 0),
            ]}
            locations={[0, 0.55, 1]}
          />
        ) : null}
        {/* 默认对齐 lx 竖屏：纯主题色背景（氛围色在播放设置里可选开启） */}
        <PagerView
          ref={pagerViewRef}
          style={styles.pagerView}
          initialPage={0}
          overScrollMode="never"
          onPageSelected={(e) => setCurrentPage(e.nativeEvent.position)}
        >
          <View key="cover" style={styles.pagerPage}>
            <ImmersiveCoverPage
              artwork={artwork}
              coverSize={coverSize}
              isPlaying={isPlaying}
              palette={palette}
              onLongPress={openCoverMenu}
            />
            {showLyricProgress ? (
              <MiniLyric
                lyrics={lyrics}
                currentLineIndex={currentLyricIndex}
                palette={palette}
                onPress={() => pagerViewRef.current?.setPage(1)}
              />
            ) : null}
          </View>
          <View key="lyrics" style={styles.pagerPage}>
            <LyricView
              lyrics={lyrics}
              currentLineIndex={currentLyricIndex}
              showTranslation={showTranslation}
              palette={palette}
              onSeek={handleSeek}
              style={styles.pagerLyricList}
            />
          </View>
        </PagerView>

        {isLyricsPage && <KeepAwake />}

        <ImmersiveTopBar
          insetsTop={insets.top}
          songName={currentSong.name}
          artist={currentSong.singer || "未知歌手"}
          palette={palette}
          onClose={onClose}
          onOpenPlaySetting={() => setPlaySettingVisible(true)}
          onPressArtist={canOpenArtist ? handleOpenArtist : undefined}
          sleepLabel={sleepTimerControl.label}
          sleepActive={!!sleepTimerControl.active}
          onOpenSleep={() => setSleepModalVisible(true)}
        />

        <ImmersivePlaySettingSheet
          visible={playSettingVisible}
          onClose={() => setPlaySettingVisible(false)}
          palette={palette}
        />

        <ImmersiveTransport
          insetsBottom={insets.bottom}
          onSeek={handleSeek}
          playMode={playMode}
          playModeControl={playModeControl}
          onTogglePlayMode={handleTogglePlayMode}
          onPrevious={handlePrevious}
          onNext={handleNext}
          onTogglePlay={handleTogglePlay}
          isPlaying={isPlaying}
          loading={loading}
          palette={palette}
          isLiked={isLiked}
          onToggleLike={() => void handleLike()}
          floatingLyricActive={floatingLyricActive}
          onToggleFloatingLyric={handleToggleFloatingLyric}
          canAddToPlaylist={currentSongActions.show}
          onAddToPlaylist={() => setAddToPlaylistVisible(true)}
          canShare={currentSongActions.show}
          shareLabel={currentSongActions.shareLabel}
          onShare={() => {
            void handleShare();
          }}
          onOpenDownload={openCoverSongDownload}
          onPlayMv={
            currentMvId
              ? () => {
                  // 先关闭播放页 Modal 再压 MV 路由，否则新页面被 Modal 盖住不可见
                  onClose();
                  openMvPlayerScreen({
                    mvId: currentMvId,
                    title: currentSong.name,
                    artist: currentSong.singer,
                    posterUrl: currentSong.img || currentSong.picUrl,
                  });
                }
              : undefined
          }
          canShowComments={currentSong.source === "wy"}
          onOpenComments={() => setCommentsVisible(true)}
          onOpenQueue={() => setQueueModalVisible(true)}
          queueLabel={queueModel.triggerLabel}
        />

        <ImmersiveModals
          customMinutes={customMinutes}
          customSongCount={customSongCount}
          handleCancelSleepTimer={handleCancelSleepTimer}
          handleClearQueue={handleClearQueue}
          handlePlayQueueItem={handlePlayQueueItem}
          handleRemoveQueueItem={handleRemoveQueueItem}
          handleSetPlaybackRate={handleSetPlaybackRate}
          handleSetVolume={handleSetVolume}
          handleStartCustomSleepTimer={handleStartCustomSleepTimer}
          handleStartCustomSongSleepTimer={handleStartCustomSongSleepTimer}
          handleStartSleepTimer={handleStartSleepTimer}
          handleStartSongSleepTimer={handleStartSongSleepTimer}
          handleToggleMute={handleToggleMute}
          management={queueModel.management}
          palette={palette}
          queue={queue}
          queueModalVisible={queueModalVisible}
          queueModel={queueModel}
          rateModalVisible={rateModalVisible}
          rateModel={rateModel}
          setCustomMinutes={setCustomMinutes}
          setCustomSongCount={setCustomSongCount}
          setQueueModalVisible={setQueueModalVisible}
          setRateModalVisible={setRateModalVisible}
          setSleepModalVisible={setSleepModalVisible}
          setVolumeModalVisible={setVolumeModalVisible}
          sleepModalVisible={sleepModalVisible}
          sleepTimerActive={sleepTimerActive}
          sleepTimerControl={sleepTimerControl}
          sleepTimerMinutes={sleepTimerMinutes ?? 0}
          sleepTimerSongActive={sleepTimerSongActive}
          sleepTimerSongCount={sleepTimerSongCount ?? 0}
          volumeModalVisible={volumeModalVisible}
          volumeModel={volumeModel}
          onQueueNavigate={onClose}
        />

        <AddToLocalPlaylistModal
          visible={addToPlaylistVisible}
          song={currentSong}
          onClose={() => setAddToPlaylistVisible(false)}
        />

        <Modal
          visible={coverMenuVisible}
          transparent
          animationType="fade"
          onRequestClose={closeCoverMenu}
          statusBarTranslucent
        >
          <Pressable style={menuStyles.overlay} onPress={closeCoverMenu}>
            <Pressable
              style={[menuStyles.sheet, { backgroundColor: palette.surface }]}
              onPress={(e) => e.stopPropagation()}
            >
              <Text style={[menuStyles.title, { color: palette.text }]} numberOfLines={1}>
                {currentSong.name}
              </Text>
              <Pressable style={menuStyles.row} onPress={() => void handleCoverDownload()}>
                <Text style={[menuStyles.rowText, { color: palette.text }]}>下载封面</Text>
              </Pressable>
              <Pressable style={[menuStyles.row, menuStyles.cancel]} onPress={closeCoverMenu}>
                <Text style={[menuStyles.rowText, { color: palette.textMuted }]}>取消</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>

        <DownloadQualityModal
          visible={coverSongDownloadVisible}
          song={currentSong}
          onClose={closeCoverSongDownload}
          onDownload={handleCoverSongDownload}
        />

        <ImmersiveCommentsSheet
          visible={commentsVisible}
          onClose={() => setCommentsVisible(false)}
          song={currentSong}
          palette={palette}
        />
      </View>
    </Modal>
  );
}

const menuStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  sheet: {
    width: "78%",
    maxWidth: 320,
    borderRadius: 16,
    paddingVertical: 8,
    paddingHorizontal: 8,
    overflow: "hidden",
  },
  title: {
    fontSize: 15,
    fontWeight: "700",
    textAlign: "center",
    paddingVertical: 10,
    marginBottom: 4,
  },
  row: {
    paddingVertical: 13,
    borderRadius: 8,
    alignItems: "center",
  },
  rowText: {
    fontSize: 15,
    fontWeight: "600",
  },
  cancel: {
    marginTop: 4,
  },
});

