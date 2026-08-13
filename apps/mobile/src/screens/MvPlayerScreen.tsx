import React, { useCallback, useEffect, useRef, useState, type ElementRef } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import Video, { type OnProgressData } from "react-native-video";
import KeepAwake from "react-native-keep-awake";
import { ArrowLeft, Pause, Play, RotateCcw } from "lucide-react-native";

import { fetchWyMvPlaybackSource, type MvPlaybackSource, type MvResolution } from "@/services/wyMvService";
import { startMvAudioSession, type MvAudioSession } from "@/services/mvAudioSession";
import { radius } from "@/theme/tokens";

const QUALITY_OPTIONS: MvResolution[] = [1080, 720, 480];

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

function formatTime(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

export function MvPlayerScreen({ mvId, title, artist, posterUrl, onBack }: MvPlayerScreenProps) {
  const videoRef = useRef<ElementRef<typeof Video>>(null);
  const sessionRef = useRef<MvAudioSession | null>(null);
  const requestIdRef = useRef(0);
  const pendingSeekRef = useRef<{ requestId: number; position: number } | null>(null);
  const [progressWidth, setProgressWidth] = useState(0);
  const [source, setSource] = useState<ResolvedMvSource | null>(null);
  const [quality, setQuality] = useState<MvResolution>(1080);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [paused, setPaused] = useState(false);
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
      setError(value instanceof Error ? value.message : "MV 播放地址解析失败");
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
        await resolve(1080);
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

  const handleProgress = useCallback((event: OnProgressData) => {
    setPosition(event.currentTime);
    setDuration((current) => event.seekableDuration || current);
  }, []);

  const handleQuality = useCallback((nextQuality: MvResolution) => {
    if (nextQuality === quality) return;
    void resolve(nextQuality, position);
  }, [position, quality, resolve]);

  const handleSeek = useCallback((locationX: number) => {
    if (!duration || !progressWidth) return;
    const nextPosition = Math.max(0, Math.min(duration, locationX / progressWidth * duration));
    setPosition(nextPosition);
    videoRef.current?.seek(nextPosition);
  }, [duration, progressWidth]);

  const close = useCallback(() => onBack(), [onBack]);

  return (
    <View style={styles.root}>
      <KeepAwake />
      <View style={styles.header}>
        <Pressable onPress={close} style={styles.iconButton} accessibilityLabel="返回">
          <ArrowLeft color="#fff" size={24} />
        </Pressable>
        <View style={styles.heading}>
          <Text numberOfLines={1} style={styles.title}>{title}</Text>
          <Text numberOfLines={1} style={styles.artist}>{artist}</Text>
        </View>
      </View>
      <View style={styles.videoFrame}>
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
            setDuration(data.duration);
            const pendingSeek = pendingSeekRef.current;
            if (pendingSeek?.requestId === source.requestId) {
              pendingSeekRef.current = null;
              videoRef.current?.seek(pendingSeek.position);
            }
          }}
          onProgress={handleProgress}
          progressUpdateInterval={250}
          onError={() => { setLoading(false); setError("视频播放失败，请重试或切换清晰度"); }}
        /> : null}
        {loading ? <View style={styles.overlay}><ActivityIndicator color="#fff" /><Text style={styles.message}>正在解析视频</Text></View> : null}
        {error ? <View style={styles.overlay}><Text style={styles.message}>{error}</Text><Pressable onPress={() => void resolve(quality, position)} style={styles.retry}><RotateCcw color="#fff" size={16} /><Text style={styles.message}>重试</Text></Pressable></View> : null}
      </View>
      <View style={styles.controls}>
        <View style={styles.progressRow}>
          <Text style={styles.time}>{formatTime(position)}</Text>
          <Pressable
            style={styles.track}
            onLayout={(event) => setProgressWidth(event.nativeEvent.layout.width)}
            onPress={(event) => handleSeek(event.nativeEvent.locationX)}
            accessibilityRole="adjustable"
            accessibilityLabel="视频进度"
          >
            <View style={[styles.fill, { width: `${duration ? Math.min(100, position / duration * 100) : 0}%` }]} />
          </Pressable>
          <Text style={styles.time}>{formatTime(duration)}</Text>
        </View>
        <View style={styles.actionRow}>
          <Pressable onPress={() => setPaused((value) => !value)} style={styles.playButton} accessibilityLabel={paused ? "播放" : "暂停"}>
            {paused ? <Play color="#000" size={20} /> : <Pause color="#000" size={20} />}
          </Pressable>
          <View style={styles.qualities}>{QUALITY_OPTIONS.map((item) => <Pressable key={item} onPress={() => void handleQuality(item)} style={[styles.quality, item === quality && styles.selected]}><Text style={styles.qualityText}>{item}p</Text></Pressable>)}</View>
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
  iconButton: { padding: 8 },
  heading: { flex: 1, marginLeft: 8 },
  title: { color: "#fff", fontSize: 17, fontWeight: "700" },
  artist: { color: "#a6a6a6", fontSize: 13, marginTop: 3 },
  videoFrame: { width: "100%", aspectRatio: 16 / 9, backgroundColor: "#090909" },
  overlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  message: { color: "#fff", textAlign: "center" },
  retry: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10 },
  controls: { padding: 20 },
  progressRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  time: { color: "#aaa", fontSize: 12, width: 36 },
  track: { flex: 1, height: 4, backgroundColor: "#333", borderRadius: 2, overflow: "hidden" },
  fill: { height: "100%", backgroundColor: "#fff" },
  actionRow: { flexDirection: "row", alignItems: "center", marginTop: 24 },
  playButton: { width: 44, height: 44, borderRadius: radius.pill, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  qualities: { flexDirection: "row", marginLeft: "auto", gap: 8 },
  quality: { paddingHorizontal: 10, paddingVertical: 7, borderWidth: 1, borderColor: "#444", borderRadius: radius.sm },
  selected: { backgroundColor: "#333", borderColor: "#fff" },
  qualityText: { color: "#fff", fontSize: 12 },
});
