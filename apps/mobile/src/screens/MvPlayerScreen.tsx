import React, { useCallback, useEffect, useRef, useState, type ElementRef, type MutableRefObject } from "react";
import { ActivityIndicator, StatusBar, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Video, { type OnBufferData, type OnProgressData } from "react-native-video";
import KeepAwake from "react-native-keep-awake";
import { ArrowLeft, Maximize2, Minimize2, Pause, Play, RotateCcw } from "lucide-react-native";

import { IconButton } from "@/components/IconButton";
import { ChoiceChip } from "@/components/ChoiceChip";
import { fetchWyMvPlaybackSource, type MvPlaybackSource, type MvResolution } from "@/services/wyMvService";
import { startMvAudioSession, type MvAudioSession } from "@/services/mvAudioSession";
import { setLandscapePreferred } from "@/services/orientationService";
import { formatTime } from "@/services/playerService";

const QUALITY_OPTIONS: MvResolution[] = [1080, 720, 480];

// 会话级清晰度记忆：上次手动选择的档位作为下一条 MV 的首选（取链失败会自动降档）
let lastPreferredResolution: MvResolution = 1080;

export interface MvPlayerScreenProps {
  mvId: string;
  title: string;
  artist: string;
  posterUrl?: string;
  onBack: () => void;
}

interface ResolvedMvSource extends MvPlaybackSource {
  requestId: number;
}

/** 播放页向进度条叶子组件单向转发的高频事件通道（见 MvProgressBar）。 */
interface MvProgressListenerBag {
  onProgress?: (data: OnProgressData) => void;
  onDuration?: (duration: number) => void;
}

/**
 * 进度控制（叶子组件，独占高频状态）。
 *
 * position/duration/buffered 以最高 4Hz 到达：若挂在页面 state 上会带动
 * Video、头部、清晰度 chips 整树重渲染。这里通过 listenersRef 反向注册
 * 事件处理，高频数据只重渲染本组件；父组件仅持 positionRef 供切清晰度/
 * 重试时读取当前进度。
 *
 * 交互：点按定位 + 按住拖动擦洗（松手才真正 seek），4px 轨道外扩出 20px+
 * 的触控区，缓冲进度单独一层展示。
 */
function MvProgressBar({
  videoRef,
  listenersRef,
  positionRef,
}: {
  videoRef: MutableRefObject<ElementRef<typeof Video> | null>;
  listenersRef: MutableRefObject<MvProgressListenerBag | null>;
  positionRef: MutableRefObject<number>;
}) {
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  // 拖动中的目标比例（0..1）；非 null 时显示以拖动位置为准，不跟随播放进度
  const [scrubFraction, setScrubFraction] = useState<number | null>(null);
  const trackWidthRef = useRef(0);

  useEffect(() => {
    listenersRef.current = {
      onProgress: (data) => {
        setPosition(data.currentTime);
        if (data.seekableDuration > 0) setDuration((current) => Math.max(current, data.seekableDuration));
        if (data.playableDuration > 0) setBuffered(data.playableDuration);
      },
      onDuration: (value) => {
        if (value > 0) setDuration(value);
      },
    };
    return () => {
      listenersRef.current = null;
    };
  }, [listenersRef]);

  const fractionFromX = (locationX: number) => {
    const width = trackWidthRef.current;
    if (width <= 0) return 0;
    return Math.max(0, Math.min(1, locationX / width));
  };

  const commitSeek = (fraction: number) => {
    if (duration <= 0) return;
    const target = fraction * duration;
    positionRef.current = target;
    setPosition(target);
    videoRef.current?.seek(target);
  };

  const displayFraction = duration > 0 ? Math.min(1, (scrubFraction ?? position) / duration) : 0;
  const bufferedFraction = duration > 0 ? Math.min(1, buffered / duration) : 0;
  const displayTime = scrubFraction != null && duration > 0 ? scrubFraction * duration : position;

  return (
    <View style={styles.progressRow}>
      <Text style={styles.time}>{formatTime(displayTime)}</Text>
      <View
        style={styles.trackTouch}
        hitSlop={{ top: 10, bottom: 10, left: 4, right: 4 }}
        onLayout={(event) => {
          trackWidthRef.current = event.nativeEvent.layout.width;
        }}
        onStartShouldSetResponder={() => duration > 0}
        onMoveShouldSetResponder={() => duration > 0}
        onResponderGrant={(event) => setScrubFraction(fractionFromX(event.nativeEvent.locationX))}
        onResponderMove={(event) => setScrubFraction(fractionFromX(event.nativeEvent.locationX))}
        onResponderRelease={(event) => {
          const fraction = fractionFromX(event.nativeEvent.locationX);
          setScrubFraction(null);
          commitSeek(fraction);
        }}
        onResponderTerminate={() => setScrubFraction(null)}
        accessibilityRole="adjustable"
        accessibilityLabel="视频进度"
      >
        <View style={styles.track}>
          <View style={[styles.bufferedFill, { width: `${bufferedFraction * 100}%` }]} />
          <View style={[styles.fill, { width: `${displayFraction * 100}%` }]} />
          <View style={[styles.thumb, { left: `${displayFraction * 100}%` }]} />
        </View>
      </View>
      <Text style={styles.time}>{formatTime(duration)}</Text>
    </View>
  );
}

export function MvPlayerScreen({ mvId, title, artist, posterUrl, onBack }: MvPlayerScreenProps) {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const isLandscape = windowWidth > windowHeight;
  const videoRef = useRef<ElementRef<typeof Video> | null>(null);
  const sessionRef = useRef<MvAudioSession | null>(null);
  const requestIdRef = useRef(0);
  const pendingSeekRef = useRef<{ requestId: number; position: number } | null>(null);
  const progressListenersRef = useRef<MvProgressListenerBag | null>(null);
  // 高频进度只写 ref：切清晰度/失败重试需要当前进度，不为此订阅 4Hz state
  const positionRef = useRef(0);
  const [source, setSource] = useState<ResolvedMvSource | null>(null);
  const [quality, setQuality] = useState<MvResolution>(1080);
  const [paused, setPaused] = useState(false);
  const [ended, setEnded] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const resolve = useCallback(async (preferred: MvResolution, seekPosition?: number) => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const next = await fetchWyMvPlaybackSource(mvId, preferred);
      if (requestId !== requestIdRef.current) return;
      pendingSeekRef.current = seekPosition == null ? null : { requestId, position: seekPosition };
      setSource({ ...next, requestId });
      setQuality(next.resolution);
      setLoading(false);
    } catch (value) {
      if (requestId !== requestIdRef.current) return;
      setLoading(false);
      setError(value instanceof Error ? value.message : "MV 播放地址获取失败");
    }
  }, [mvId]);

  useEffect(() => {
    let mounted = true;
    setSource(null);
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const session = await startMvAudioSession();
        if (!mounted) {
          await session.close();
          return;
        }
        sessionRef.current = session;
        await resolve(lastPreferredResolution);
      } catch (value) {
        if (!mounted) return;
        setLoading(false);
        setError(value instanceof Error ? value.message : "无法暂停音频");
      }
    })();

    return () => {
      mounted = false;
      requestIdRef.current += 1;
      const session = sessionRef.current;
      sessionRef.current = null;
      if (session) void session.close();
    };
  }, [resolve]);

  // 卸载归还方向控制：全屏开启过的话回到系统默认行为（清单未锁方向）
  useEffect(() => {
    return () => {
      void setLandscapePreferred(false);
    };
  }, []);

  const handleQuality = useCallback((nextQuality: MvResolution) => {
    if (nextQuality === quality) return;
    lastPreferredResolution = nextQuality;
    void resolve(nextQuality, positionRef.current);
  }, [quality, resolve]);

  const toggleFullscreen = useCallback(() => {
    void setLandscapePreferred(!isLandscape);
  }, [isLandscape]);

  // 播完进入 ended 态：按钮变重播，按下回到 0 重新播放
  const handlePlayPause = useCallback(() => {
    if (ended) {
      positionRef.current = 0;
      videoRef.current?.seek(0);
      setEnded(false);
      setPaused(false);
      return;
    }
    setPaused((value) => !value);
  }, [ended]);

  const close = useCallback(() => onBack(), [onBack]);

  return (
    <View style={styles.root}>
      <KeepAwake />
      <StatusBar hidden={isLandscape} />
      <View style={[styles.header, isLandscape && styles.headerFloating]}>
        <IconButton
          onPress={close}
          tone="onImage"
          accessibilityLabel="返回"
          render={({ size, color }) => <ArrowLeft color={color} size={size} />}
        />
        <View style={styles.heading}>
          <Text numberOfLines={1} style={styles.title}>{title}</Text>
          <Text numberOfLines={1} style={styles.artist}>{artist}</Text>
        </View>
      </View>
      {/* 竖屏 16:9 固定框；横屏全屏铺满（按钮全屏 / 系统旋转均走此布局） */}
      <View style={isLandscape ? styles.videoFrameLandscape : styles.videoFrame}>
        {source ? <Video
          key={source.requestId}
          ref={videoRef}
          source={{ uri: source.url }}
          poster={posterUrl}
          posterResizeMode="contain"
          resizeMode="contain"
          paused={paused}
          style={StyleSheet.absoluteFill}
          onLoad={(data) => {
            progressListenersRef.current?.onDuration?.(data.duration);
            const pendingSeek = pendingSeekRef.current;
            if (pendingSeek?.requestId === source.requestId) {
              pendingSeekRef.current = null;
              videoRef.current?.seek(pendingSeek.position);
            }
          }}
          onProgress={(data) => {
            positionRef.current = data.currentTime;
            progressListenersRef.current?.onProgress?.(data);
          }}
          onBuffer={(event: OnBufferData) => setBuffering(event.isBuffering)}
          onEnd={() => {
            setPaused(true);
            setEnded(true);
          }}
          progressUpdateInterval={250}
          onError={() => {
            setBuffering(false);
            setLoading(false);
            setError("视频播放失败，请重试或切换清晰度");
          }}
        /> : null}
        {loading ? <View style={styles.overlay}><ActivityIndicator color="#fff" /><Text style={styles.message}>正在解析视频</Text></View> : null}
        {error ? <View style={styles.overlay}><Text style={styles.message}>{error}</Text><IconButton onPress={() => void resolve(quality, positionRef.current)} tone="onImage" accessibilityLabel="重试" render={({ size, color }) => <RotateCcw color={color} size={size} />} /></View> : null}
        {!loading && !error && buffering && !paused ? (
          <View style={styles.bufferingBadge} pointerEvents="none">
            <ActivityIndicator color="#fff" size="small" />
          </View>
        ) : null}
      </View>
      <View style={[styles.controls, isLandscape && styles.controlsFloating]}>
        <MvProgressBar videoRef={videoRef} listenersRef={progressListenersRef} positionRef={positionRef} />
        <View style={[styles.actionRow, isLandscape && styles.actionRowLandscape]}>
          {/* 常驻深色场景：白底黑图标，尺寸走统一 md 档 */}
          <IconButton
            onPress={handlePlayPause}
            accessibilityLabel={ended ? "重播" : paused ? "播放" : "暂停"}
            style={styles.playButton}
            render={({ size }) =>
              ended ? <RotateCcw color="#000" size={size} /> : paused ? <Play color="#000" size={size} /> : <Pause color="#000" size={size} />
            }
          />
          <View style={styles.qualities}>{QUALITY_OPTIONS.map((item) => <ChoiceChip key={item} label={`${item}p`} selected={item === quality} onPress={() => void handleQuality(item)} onImage accessibilityLabel={`${item}P 清晰度`} />)}</View>
          <IconButton
            onPress={toggleFullscreen}
            tone="onImage"
            accessibilityLabel={isLandscape ? "退出全屏" : "全屏"}
            render={({ size, color }) =>
              isLandscape ? <Minimize2 color={color} size={size} /> : <Maximize2 color={color} size={size} />
            }
          />
        </View>
      </View>
    </View>
  );
}

// 视频播放器为「始终深色」的沉浸场景（对齐 lx：无论主题如何都保持深色底，避免字幕/进度条被浅色背景破坏），
// 故颜色不走 themePalette，但圆角/尺寸统一走设计 token。
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10 },
  // 横屏：视频铺满全屏，头部/控制区悬浮在视频上层（半透明底保证可读）
  headerFloating: { position: "absolute", top: 0, right: 0, left: 0, zIndex: 30, backgroundColor: "rgba(0,0,0,0.35)" },
  heading: { flex: 1, marginLeft: 8 },
  title: { color: "#fff", fontSize: 17, fontWeight: "700" },
  artist: { color: "#a6a6a6", fontSize: 13, marginTop: 3 },
  videoFrame: { width: "100%", aspectRatio: 16 / 9, backgroundColor: "#090909" },
  videoFrameLandscape: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 10, backgroundColor: "#090909" },
  overlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  bufferingBadge: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center" },
  message: { color: "#fff", textAlign: "center" },
  controls: { padding: 20 },
  controlsFloating: { position: "absolute", right: 0, bottom: 0, left: 0, zIndex: 30, backgroundColor: "rgba(0,0,0,0.35)", paddingBottom: 12 },
  progressRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  time: { color: "#aaa", fontSize: 12, width: 36 },
  trackTouch: { flex: 1, paddingVertical: 8 },
  track: { height: 4, backgroundColor: "#333", borderRadius: 2 },
  bufferedFill: { position: "absolute", top: 0, bottom: 0, left: 0, backgroundColor: "#555", borderRadius: 2 },
  fill: { position: "absolute", top: 0, bottom: 0, left: 0, backgroundColor: "#fff", borderRadius: 2 },
  thumb: { position: "absolute", top: -4, width: 12, height: 12, marginLeft: -6, borderRadius: 6, backgroundColor: "#fff" },
  actionRow: { flexDirection: "row", alignItems: "center", marginTop: 24, gap: 8 },
  actionRowLandscape: { marginTop: 12 },
  playButton: { backgroundColor: "#fff" },
  qualities: { flexDirection: "row", marginLeft: "auto", gap: 8 },
});
