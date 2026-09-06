import React from "react";
import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  Easing,
  FadeInDown,
  FadeInUp,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import PagerView from "react-native-pager-view";
import LinearGradient from "react-native-linear-gradient";
import KeepAwake from "react-native-keep-awake";
import { COVER_SIZE_LARGE } from "@lx/core";

import { LyricView } from "@/components/LyricView";
import { AddToLocalPlaylistModal } from "@/components/AddToLocalPlaylistModal";
import { CachedImage } from "@/components/CachedImage";
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
import {
  getImmersiveFlySource,
  type ImmersiveFlyRect,
} from "@/screens/immersive/immersiveFlySource";
import { fetchCoverColors, type CoverColors } from "@/services/coverColorService";
import { withAlpha } from "@/services/themePaletteModel";
import { getResolvedTheme, useThemeStore } from "@/stores/themeStore";
import { useLyricSettingsStore } from "@/stores/lyricSettingsStore";
import { openMvPlayerScreen } from "@/navigation";

export interface ImmersiveLyricsScreenProps {
  visible: boolean;
  onClose: () => void;
}

interface FlyOverlayProps {
  artwork: string;
  source: ImmersiveFlyRect;
  target: (ImmersiveFlyRect & { radius: number }) | null;
  progress: SharedValue<number>;
  opacity: SharedValue<number>;
}

/**
 * 封面飞入/飞回的浮层：对齐 lx 播放页 shared element 观感——
 * 迷你栏封面（source）与沉浸页封面框（target）之间插值位置/尺寸/圆角。
 * target 未测到前静止停在 source（入场等待期）；progress 0↔1 驱动双向飞行。
 *
 * 实现：布局静态锚定 target 满尺寸，飞行用 transform（translate+scale）插值。
 * 不再逐帧插值 left/top/width/height——那会每帧触发原生 relayout（含内部大图
 * 重排）加 elevation 阴影重算，中低端机 360ms 飞行内明显掉帧；transform 走
 * 合成层，bounds 不变、阴影只算一次。内层 CachedImage 按 target 尺寸解码，
 * 飞行起点是缩小显示（降采样），起点与终点都清晰。
 */
const FlyOverlay = React.memo(function FlyOverlay({
  artwork,
  source,
  target,
  progress,
  opacity,
}: FlyOverlayProps) {
  const fromCx = source.x + source.width / 2;
  const fromCy = source.y + source.height / 2;
  const toCx = target ? target.x + target.width / 2 : fromCx;
  const toCy = target ? target.y + target.height / 2 : fromCy;
  // 缩放比按宽度换算（双端封面均为正方形）；target 未测到或异常为 0 时退化为不缩放
  const targetScale = target && target.width > 0 ? target.width / source.width : 1;
  const animatedStyle = useAnimatedStyle(() => {
    return {
      position: "absolute" as const,
      left: target ? target.x : source.x,
      top: target ? target.y : source.y,
      width: target ? target.width : source.width,
      height: target ? target.height : source.height,
      borderRadius: interpolate(progress.value, [0, 1], [8, target ? target.radius : 8]),
      transform: [
        { translateX: interpolate(progress.value, [0, 1], [fromCx - toCx, 0]) },
        { translateY: interpolate(progress.value, [0, 1], [fromCy - toCy, 0]) },
        { scale: interpolate(progress.value, [0, 1], [1 / targetScale, 1]) },
      ],
      opacity: opacity.value,
      zIndex: 100,
      elevation: 24,
      overflow: "hidden" as const,
    };
  });

  return (
    <Animated.View style={animatedStyle} pointerEvents="none">
      <CachedImage
        uri={artwork}
        size={COVER_SIZE_LARGE}
        style={{ width: "100%", height: "100%" }}
        fallback={
          <View
            style={{
              width: "100%",
              height: "100%",
              backgroundColor: "#00000022",
            }}
          />
        }
      />
    </Animated.View>
  );
});

/**
 * 播放页（对齐 lx 竖屏播放器）：
 * - 状态/操作 → useImmersiveController
 * - UI → TopBar / PagerView(封面|歌词) / Transport / Modals
 * - 转场：Modal 不再整体滑动（animationType="none"），封面从迷你栏位置飞入；
 *   顶栏/控制区错落淡入；关闭时封面飞回 + 整页淡出后再 goBack
 * - 下拉关闭（仅封面页）跟手位移，松手按位移/速度判定关闭或回弹
 */
export function ImmersiveLyricsScreen({ visible, onClose }: ImmersiveLyricsScreenProps) {
  const showLyricProgress = useLyricSettingsStore((s) => s.showLyricProgress);
  const ambientCoverTint = useLyricSettingsStore((s) => s.ambientCoverTint);
  const coverSpin = useLyricSettingsStore((s) => s.coverSpin);
  const themeMode = useThemeStore((s) => s.mode);
  const systemTheme = useThemeStore((s) => s.systemTheme);
  const isDark = getResolvedTheme(themeMode, systemTheme) === "dark";
  const pagerViewRef = React.useRef<PagerView>(null);
  const { height: windowHeight } = useWindowDimensions();

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

  // ── 封面飞入/飞回转场 ──
  // 起点在挂载前一次性捕获（渲染期读取，首帧就能停在迷你栏封面位置）。
  const flySource = React.useRef<ImmersiveFlyRect | null>(getImmersiveFlySource()).current;
  const flightEnabled = !!(flySource && artwork);
  const [targetRect, setTargetRect] = React.useState<(ImmersiveFlyRect & { radius: number }) | null>(null);
  const [flightDone, setFlightDone] = React.useState(!flightEnabled);
  const [overlayGone, setOverlayGone] = React.useState(false);
  const [closing, setClosing] = React.useState(false);
  const closingRef = React.useRef(false);
  const flightStartedRef = React.useRef(false);

  const onCloseRef = React.useRef(onClose);
  React.useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  const closeNow = React.useCallback(() => {
    onCloseRef.current();
  }, []);

  const flyProgress = useSharedValue(0);
  const flyOverlayOpacity = useSharedValue(1);
  // 有转场时整页先透明（封面浮层独自可见），无转场时直接静态呈现
  const rootOpacity = useSharedValue(flightEnabled ? 0 : 1);
  // 真实封面在飞行完成前隐藏（避免与浮层双重显示），完成时与浮层交叉淡换
  const realCoverOpacity = useSharedValue(flightEnabled ? 0 : 1);
  const contentTranslateY = useSharedValue(0);

  // 入场：拿到封面框终点坐标后启动飞行
  React.useEffect(() => {
    if (!flightEnabled || !targetRect || flightStartedRef.current) return;
    flightStartedRef.current = true;
    rootOpacity.value = withTiming(1, { duration: 200, easing: Easing.out(Easing.quad) });
    flyProgress.value = withTiming(1, { duration: 360, easing: Easing.out(Easing.cubic) }, (finished) => {
      if (!finished) return;
      runOnJS(setFlightDone)(true);
      realCoverOpacity.value = withTiming(1, { duration: 160 });
      flyOverlayOpacity.value = withTiming(0, { duration: 170 }, (done) => {
        if (done) runOnJS(setOverlayGone)(true);
      });
    });
  }, [flightEnabled, targetRect, rootOpacity, flyProgress, realCoverOpacity, flyOverlayOpacity]);

  // 兜底：终点坐标迟迟未测到（极端布局）时跳过转场，直接呈现静态播放页
  React.useEffect(() => {
    if (!flightEnabled) return;
    const timer = setTimeout(() => {
      if (flightStartedRef.current) return;
      flightStartedRef.current = true;
      rootOpacity.value = 1;
      realCoverOpacity.value = 1;
      setFlightDone(true);
      setOverlayGone(true);
    }, 800);
    return () => clearTimeout(timer);
  }, [flightEnabled, rootOpacity, realCoverOpacity]);

  // 关闭编排：封面飞回迷你栏 + 整页淡出，动画结束后才真正 goBack
  const requestClose = React.useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    contentTranslateY.value = withTiming(0, { duration: 100 });
    if (flightEnabled && targetRect) {
      rootOpacity.value = withTiming(0, { duration: 260, easing: Easing.in(Easing.quad) });
      realCoverOpacity.value = 0;
      setOverlayGone(false);
      flyOverlayOpacity.value = 1;
      flyProgress.value = 1;
      flyProgress.value = withTiming(0, { duration: 300, easing: Easing.in(Easing.cubic) }, (finished) => {
        if (finished) runOnJS(closeNow)();
      });
    } else {
      rootOpacity.value = withTiming(0, { duration: 200, easing: Easing.in(Easing.quad) }, (finished) => {
        if (finished) runOnJS(closeNow)();
      });
    }
  }, [flightEnabled, targetRect, closeNow, contentTranslateY, rootOpacity, realCoverOpacity, flyOverlayOpacity, flyProgress]);

  // ── 下拉关闭（跟手）：仅封面页启用，纵向位移驱动整页下移 ──
  // 播放列表 / 评论等应用内底部弹层打开期间必须禁用：它们盖在封面页上且自带
  // 可滚动列表，根级下拉手势会劫持列表滚动（页面跟着位移），快速滑动还会
  // 触发关闭判定把整个播放页拽走。
  const pullDownGestureEnabled = !isLyricsPage && !closing && flightDone && !queueModalVisible && !commentsVisible;
  const panGesture = React.useMemo(
    () =>
      Gesture.Pan()
        .enabled(pullDownGestureEnabled)
        .activeOffsetY(14)
        .failOffsetX(16)
        .onUpdate((event) => {
          // 只跟手下移；上移给少量阻尼，避免页面被拽出顶部
          contentTranslateY.value =
            event.translationY > 0 ? event.translationY : event.translationY * 0.12;
        })
        .onEnd((event) => {
          const dy = event.translationY;
          const shouldDismiss = dy > 120 || (event.velocityY > 900 && dy > 48);
          if (!shouldDismiss) {
            contentTranslateY.value = withSpring(0, { stiffness: 340, damping: 30 });
            return;
          }
          closingRef.current = true;
          runOnJS(setClosing)(true);
          // 下拉路径不做封面飞回（整页已跟手位移），滑出屏幕后直接关闭
          contentTranslateY.value = withTiming(
            windowHeight + 120,
            { duration: 250, easing: Easing.in(Easing.quad) },
            (finished) => {
              if (finished) runOnJS(closeNow)();
            },
          );
        }),
    [pullDownGestureEnabled, windowHeight, contentTranslateY, closeNow],
  );

  const rootAnimatedStyle = useAnimatedStyle(() => ({
    opacity: rootOpacity.value,
    transform: [{ translateY: contentTranslateY.value }],
  }));
  const coverRevealStyle = useAnimatedStyle(() => ({ opacity: realCoverOpacity.value }));

  if (!currentSong) {
    return null;
  }

  const currentMvId = currentSong.source === "wy" ? currentSong.mvId : undefined;

  return (
    <Modal
      visible={visible}
      animationType="none"
      transparent
      onRequestClose={requestClose}
      statusBarTranslucent
    >
      <GestureHandlerRootView style={styles.flexFill}>
        <GestureDetector gesture={panGesture}>
          <Animated.View
            style={[styles.root, { backgroundColor: palette.background }, rootAnimatedStyle]}
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
                <Animated.View style={[styles.coverRevealHost, coverRevealStyle]}>
                  <ImmersiveCoverPage
                    artwork={artwork}
                    coverSize={coverSize}
                    isPlaying={isPlaying}
                    palette={palette}
                    onLongPress={openCoverMenu}
                    onCoverMeasured={(rect) =>
                      setTargetRect({ ...rect, radius: coverSpin ? rect.height / 2 : 8 })
                    }
                  />
                </Animated.View>
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

            {/* 顶栏/控制区错落入场（封面飞行期间先后淡入） */}
            <Animated.View
              entering={FadeInDown.duration(280).delay(140)}
              style={styles.topBarHost}
              pointerEvents="box-none"
            >
              <ImmersiveTopBar
                insetsTop={insets.top}
                songName={currentSong.name}
                artist={currentSong.singer || "未知歌手"}
                palette={palette}
                onClose={requestClose}
                onOpenPlaySetting={() => setPlaySettingVisible(true)}
                onPressArtist={canOpenArtist ? handleOpenArtist : undefined}
                sleepLabel={sleepTimerControl.label}
                sleepActive={!!sleepTimerControl.active}
                onOpenSleep={() => setSleepModalVisible(true)}
              />
            </Animated.View>

            <ImmersivePlaySettingSheet
              visible={playSettingVisible}
              onClose={() => setPlaySettingVisible(false)}
              palette={palette}
            />

            <Animated.View entering={FadeInUp.duration(300).delay(200)}>
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
                        // 先关闭播放页 Modal 再压 MV 路由，否则新页面被 Modal 盖住不可见。
                        // 跳 MV 无需转场，直接 onClose 立即关闭。
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
            </Animated.View>

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
          </Animated.View>
        </GestureDetector>

        {/* 封面飞行浮层：盖在整页内容之上，入场/出场期间可见 */}
        {flightEnabled && artwork && !overlayGone ? (
          <FlyOverlay
            artwork={artwork}
            source={flySource}
            target={targetRect}
            progress={flyProgress}
            opacity={flyOverlayOpacity}
          />
        ) : null}
      </GestureHandlerRootView>
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
