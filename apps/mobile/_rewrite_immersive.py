from pathlib import Path
import re

raw = Path("src/screens/ImmersiveLyricsScreen.tsx").read_text(encoding="utf-8")
compact = re.sub(r"\n{3,}", "\n\n", raw)
lines = compact.splitlines()

props_start = next(i for i, l in enumerate(lines) if "export interface ImmersiveLyricsScreenProps" in l)
cut = next(i for i, l in enumerate(lines) if "if (!currentSong)" in l)

head = []
for l in lines[:props_start]:
    if "PosterMode" in l and "from" in l:
        continue
    if "immersiveStyles" in l:
        continue
    if "ImmersiveModals" in l and "from" in l:
        continue
    head.append(l)

if "StyleSheet" not in "\n".join(head):
    for idx, l in enumerate(head):
        if l.strip() in ('} from "react-native";', "} from 'react-native';"):
            head.insert(idx, "  StyleSheet,")
            break

extra_imports = [
    'import { ImmersiveStage } from "@/screens/immersive/ImmersiveStage";',
    'import { ImmersiveTopBar } from "@/screens/immersive/ImmersiveTopBar";',
    'import { ImmersiveTransport } from "@/screens/immersive/ImmersiveTransport";',
    'import { ImmersiveModals } from "@/screens/immersive/ImmersiveModals";',
    'import { styles } from "@/screens/immersive/immersiveStyles";',
    "",
]

i = cut
while i < len(lines) and "return null" not in lines[i]:
    i += 1
j = i
while j < len(lines) and lines[j].strip() != "}":
    j += 1
logic = lines[props_start : j + 1]

jsx = r'''
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
            style={StyleSheet.absoluteFillObject}
            blurRadius={40}
            fallback={<View style={[StyleSheet.absoluteFillObject, { backgroundColor: palette.background }]} />}
          />
        ) : (
          <View style={[StyleSheet.absoluteFillObject, { backgroundColor: palette.background }]} />
        )}
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFillObject,
            {
              backgroundColor: artworkColors
                ? darkenHex(artworkColors.primary, 0.72)
                : palette.background,
              opacity: artworkColors ? 0.88 : 0.92,
            },
          ]}
        />

        <ImmersiveStage
          isTablet={isTablet}
          posterMode={posterMode}
          coverSize={coverSize}
          posterWidth={posterWidth}
          artwork={artwork}
          currentSong={currentSong}
          palette={palette}
          lyrics={lyrics}
          currentLineIndex={currentLineIndex}
          position={position}
          duration={duration}
          isPlaying={isPlaying}
          showTranslation={showTranslation}
          phoneLyricsVisible={phoneLyricsVisible}
          controlsHidden={controlsVisibility.hidden}
          onSeek={seekTo}
          onTogglePhoneLyrics={() => setPhoneLyricsVisible((v) => !v)}
        />

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
          onSeek={seekTo}
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
          canLike={currentSongActions.canLike}
          isLiked={isLiked}
          liking={liking}
          onLike={() => {
            void handleLike();
          }}
          canAddToPlaylist={currentSongActions.canAddToPlaylist}
          onAddToPlaylist={() => setAddToPlaylistVisible(true)}
          canShare={currentSongActions.canShare}
          shareLabel={currentSongActions.shareLabel}
          onShare={() => {
            void handleShare();
          }}
          volumeLabel={volumeModel.buttonLabel}
          rateLabel={rateModel.buttonLabel}
          onOpenVolume={() => setVolumeModalVisible(true)}
          onOpenRate={() => setRateModalVisible(true)}
          onOpenSoundEffect={() => setSoundEffectModalVisible(true)}
          onOpenSleep={() => setSleepModalVisible(true)}
          sleepLabel={sleepTimerControl.label}
          sleepActive={!!sleepTimerControl.active}
          onOpenQueue={() => setQueueModalVisible(true)}
          queueLabel={queueModel.buttonLabel}
          translationControl={translationControl}
          onToggleTranslation={translationControl.onToggle}
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
          management={management}
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
          sleepTimerMinutes={sleepTimerMinutes}
          sleepTimerSongActive={sleepTimerSongActive}
          sleepTimerSongCount={sleepTimerSongCount}
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
'''

out = "\n".join(head + extra_imports + logic) + "\n" + jsx + "\n"
out = re.sub(r"\n{3,}", "\n\n", out)
Path("src/screens/ImmersiveLyricsScreen.tsx").write_text(out, encoding="utf-8", newline="\n")
print("wrote lines", len(out.splitlines()))
