import React, { useCallback, useEffect } from "react";
import {
  Animated,
  Modal,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import PagerView from "react-native-pager-view";

import { CachedImage } from "@/components/CachedImage";
import { LyricView } from "@/components/LyricView";
import { AddToLocalPlaylistModal } from "@/components/AddToLocalPlaylistModal";
import { LyricSettingsScreen } from "@/screens/LyricSettingsScreen";
import { ImmersiveStage } from "@/screens/immersive/ImmersiveStage";
import { ImmersiveTopBar } from "@/screens/immersive/ImmersiveTopBar";
import { ImmersiveTransport } from "@/screens/immersive/ImmersiveTransport";
import { ImmersiveModals } from "@/screens/immersive/ImmersiveModals";
import { PosterMode } from "@/screens/immersive/PosterMode";
import { styles } from "@/screens/immersive/immersiveStyles";
import { useImmersiveController } from "@/screens/immersive/useImmersiveController";
import { darkenHex } from "@/services/artworkColorService";

export interface ImmersiveLyricsScreenProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * 沉浸式播放页（Phase 2）：
 * - 状态/操作 → useImmersiveController
 * - UI → Stage / TopBar / Transport / Modals
 */
export function ImmersiveLyricsScreen({ visible, onClose }: ImmersiveLyricsScreenProps) {
  const {
    insets,
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
  } = useImmersiveController({ visible, onClose });

  // 歌词页保持屏幕常亮，离开时恢复
  useEffect(() => {
    if (!visible) return;
    if (isLyricsPage) {
      KeepAwake.activateKeepAwake();
    } else {
      KeepAwake.deactivateKeepAwake();
    }
    return () => {
      KeepAwake.deactivateKeepAwake();
    };
  }, [visible, isLyricsPage]);

  if (!currentSong) {
    return null;
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View
        style={[styles.root, { backgroundColor: palette.background }]}
        onLayout={onLayout}
      >
        {artwork ? (
          <CachedImage
            uri={artwork}
            style={StyleSheet.absoluteFill}
            blurRadius={40}
            fallback={<View style={[StyleSheet.absoluteFill, { backgroundColor: palette.background }]} />}
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: palette.background }]} />
        )}
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: ambientColors
                ? darkenHex(ambientColors.dominant ?? "#000000", 0.72)
                : palette.background,
              opacity: ambientColors ? 0.88 : 0.92,
            },
          ]}
        />

        {isTablet ? (
          <ImmersiveStage
            isTablet={isTablet}
            posterMode={posterMode}
            showCoverSection={showCoverSection}
            coverSize={coverSize}
            artwork={artwork}
            currentSong={currentSong}
            palette={palette}
            lyrics={lyrics}
            currentLyricIndex={currentLyricIndex}
            position={position}
            duration={duration}
            isPlaying={isPlaying}
            showTranslation={showTranslation}
            controlsVisible={controlsVisible}
            insetsTop={insets.top}
            onSeek={handleSeek}
          />
        ) : (
          <PagerView
            style={styles.pagerView}
            initialPage={0}
            overscrollMode="never"
            onPageSelected={(e) => setCurrentPage(e.nativeEvent.position)}
          >
            <View key="cover" style={styles.pagerPage}>
              <PosterMode
                artwork={artwork}
                songName={currentSong.name}
                artist={currentSong.singer || "未知艺术家"}
                lyrics={lyrics}
                currentLineIndex={currentLyricIndex}
                currentTime={position}
                duration={duration}
                isPlaying={isPlaying}
                showTranslation={showTranslation}
                controlsHidden={!controlsVisible}
                palette={palette}
                onSeek={handleSeek}
                posterWidth={coverSize}
                showLyrics={false}
              />
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
        )}

        <ImmersiveTopBar
          insetsTop={insets.top}
          songName={currentSong.name}
          artist={currentSong.singer || "未知艺术家"}
          isTablet={isTablet}
          posterMode={posterMode}
          palette={palette}
          onClose={onClose}
          onOpenLyricSettings={() => setLyricSettingsVisible(true)}
          onTogglePosterMode={() => setPosterMode((v) => !v)}
        />

        <LyricSettingsScreen
          visible={lyricSettingsVisible}
          onBack={() => setLyricSettingsVisible(false)}
        />

        {isTablet && !posterMode && (
          <Pressable style={styles.centerToggle} onPress={toggleControls} />
        )}

        {controlsVisibility.hidden && (
          <Pressable
            onPress={handleToggleControlsVisibility}
            style={[
              styles.restoreControlsButton,
              {
                bottom: insets.bottom + 24,
                backgroundColor: palette.surface,
              },
            ]}
          >
            <Text style={[styles.restoreControlsText, { color: palette.text }]}>
              {controlsVisibility.restoreLabel}
            </Text>
          </Pressable>
        )}

        <ImmersiveTransport
          insetsBottom={insets.bottom}
          fadeAnim={fadeAnim}
          controlsVisible={controlsVisible}
          position={position}
          duration={duration}
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
          isTablet={isTablet}
          posterMode={posterMode}
          canLike={currentSongActions.show}
          isLiked={isLiked}
          liking={liking}
          likeLabel={currentSongActions.likeLabel}
          onLike={() => {
            void handleLike();
          }}
          canAddToPlaylist={currentSongActions.show}
          addToPlaylistLabel={currentSongActions.addToPlaylistLabel}
          onAddToPlaylist={() => setAddToPlaylistVisible(true)}
          canShare={currentSongActions.show}
          shareLabel={currentSongActions.shareLabel}
          onShare={() => {
            void handleShare();
          }}
          volumeLabel={volumeModel.triggerLabel}
          volumeMuted={volumeModel.muted}
          rateLabel={rateModel.triggerLabel}
          onOpenVolume={() => setVolumeModalVisible(true)}
          onOpenRate={() => setRateModalVisible(true)}
          onOpenSoundEffect={() => setSoundEffectModalVisible(true)}
          onOpenSleep={() => setSleepModalVisible(true)}
          sleepLabel={sleepTimerControl.label}
          sleepActive={!!sleepTimerControl.active}
          onOpenQueue={() => setQueueModalVisible(true)}
          queueLabel={queueModel.triggerLabel}
          translationControl={translationControl}
          onToggleTranslation={() => setShowTranslation(translationControl.nextShowTranslation)}
          onTogglePosterMode={() => setPosterMode((v) => !v)}
          controlsActionLabel={controlsVisibility.actionLabel}
          onToggleControlsVisibility={handleToggleControlsVisibility}
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
          queueModalVisible={queueModalVisible}
          queueModel={queueModel}
          rateModalVisible={rateModalVisible}
          rateModel={rateModel}
          setCustomMinutes={setCustomMinutes}
          setCustomSongCount={setCustomSongCount}
          setQueueModalVisible={setQueueModalVisible}
          setRateModalVisible={setRateModalVisible}
          setSleepModalVisible={setSleepModalVisible}
          setSoundEffectModalVisible={setSoundEffectModalVisible}
          setVolumeModalVisible={setVolumeModalVisible}
          sleepModalVisible={sleepModalVisible}
          sleepTimerActive={sleepTimerActive}
          sleepTimerControl={sleepTimerControl}
          sleepTimerMinutes={sleepTimerMinutes ?? 0}
          sleepTimerSongActive={sleepTimerSongActive}
          sleepTimerSongCount={sleepTimerSongCount ?? 0}
          soundEffectModalVisible={soundEffectModalVisible}
          volumeModalVisible={volumeModalVisible}
          volumeModel={volumeModel}
        />

        <AddToLocalPlaylistModal
          visible={addToPlaylistVisible}
          song={currentSong}
          onClose={() => setAddToPlaylistVisible(false)}
        />
      </View>
    </Modal>
  );
}
