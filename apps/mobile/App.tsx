import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { LyricLine, MusicInfo, SourceTag } from "@lx/core";

import { searchSongs, resolveSongUrl, fetchSongLyrics } from "@/services/musicApi";
import { addHistorySong, loadHistorySongs } from "@/storage/historyStore";
import { playMobileTrack, pauseMobileTrack, resumeMobileTrack } from "@/player/mobilePlayer";
import { formatArtists, getArtworkUrl, getSourceLabel } from "@/utils/music";

type TabId = "home" | "search" | "library" | "player";

interface PlaybackState {
  current: MusicInfo | null;
  lyrics: LyricLine[];
  isPlaying: boolean;
  loading: boolean;
  error: string | null;
}

const FEATURED_SONGS: MusicInfo[] = [
  {
    id: "1995065917",
    name: "圆圆",
    singer: "陈子晴",
    albumName: "圆圆",
    source: "wy",
    picUrl: "https://p2.music.126.net/8Z6cScu9hMx2l37RxyJ55w==/109951168043493952.jpg",
  },
  {
    id: "2004757627",
    name: "我记得",
    singer: "赵雷",
    albumName: "署前街少年",
    source: "wy",
    picUrl: "https://p2.music.126.net/Xr1R5BBIPrsW1NtArszkFg==/109951168151498658.jpg",
  },
  {
    id: "0039MnYb0qxYhV",
    name: "哪里都是你",
    singer: "队长",
    albumName: "哪里都是你",
    source: "tx",
  },
];

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "home", label: "发现" },
  { id: "search", label: "搜索" },
  { id: "library", label: "歌单" },
  { id: "player", label: "播放" },
];

function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="#10241f" />
      <AuralFlowMobile />
    </SafeAreaProvider>
  );
}

function AuralFlowMobile() {
  const [activeTab, setActiveTab] = useState<TabId>("home");
  const [history, setHistory] = useState<MusicInfo[]>([]);
  const [playback, setPlayback] = useState<PlaybackState>({
    current: null,
    lyrics: [],
    isPlaying: false,
    loading: false,
    error: null,
  });

  useEffect(() => {
    void loadHistorySongs().then(setHistory).catch((error) => {
      setPlayback((state) => ({ ...state, error: error instanceof Error ? error.message : String(error) }));
    });
  }, []);

  const playSong = useCallback(async (song: MusicInfo) => {
    setActiveTab("player");
    setPlayback((state) => ({ ...state, current: song, loading: true, error: null }));

    try {
      const [{ url }, lyrics] = await Promise.all([
        resolveSongUrl(song),
        fetchSongLyrics(song),
      ]);
      await playMobileTrack(song, url);
      const nextHistory = await addHistorySong(song);
      setHistory(nextHistory);
      setPlayback({
        current: song,
        lyrics,
        isPlaying: true,
        loading: false,
        error: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPlayback((state) => ({ ...state, current: song, loading: false, isPlaying: false, error: message }));
      Alert.alert("播放失败", message);
    }
  }, []);

  const togglePlayback = useCallback(async () => {
    if (!playback.current) return;
    try {
      if (playback.isPlaying) {
        await pauseMobileTrack();
      } else {
        await resumeMobileTrack();
      }
      setPlayback((state) => ({ ...state, isPlaying: !state.isPlaying }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPlayback((state) => ({ ...state, error: message }));
    }
  }, [playback.current, playback.isPlaying]);

  const content = useMemo(() => {
    switch (activeTab) {
      case "search":
        return <SearchScreen onPlay={playSong} />;
      case "library":
        return <LibraryScreen history={history} onPlay={playSong} />;
      case "player":
        return <PlayerScreen playback={playback} onToggle={togglePlayback} />;
      case "home":
      default:
        return <HomeScreen history={history} onPlay={playSong} />;
    }
  }, [activeTab, history, playSong, playback, togglePlayback]);

  return (
    <SafeAreaView style={styles.shell}>
      <View style={styles.header}>
        <View>
          <Text style={styles.brand}>AuralFlow</Text>
          <Text style={styles.subtitle}>Mobile</Text>
        </View>
        <View style={styles.statusPill}>
          <Text style={styles.statusText}>Android MVP</Text>
        </View>
      </View>

      <View style={styles.content}>{content}</View>

      {playback.current && (
        <MiniPlayer playback={playback} onOpen={() => setActiveTab("player")} onToggle={togglePlayback} />
      )}

      <View style={styles.tabBar}>
        {TABS.map((tab) => (
          <Pressable
            key={tab.id}
            style={[styles.tabButton, activeTab === tab.id && styles.tabButtonActive]}
            onPress={() => setActiveTab(tab.id)}
            accessibilityRole="button"
            accessibilityLabel={tab.label}
          >
            <Text style={[styles.tabText, activeTab === tab.id && styles.tabTextActive]}>{tab.label}</Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

function HomeScreen({ history, onPlay }: { history: MusicInfo[]; onPlay: (song: MusicInfo) => void }) {
  const displaySongs = history.length > 0 ? history.slice(0, 6) : FEATURED_SONGS;
  return (
    <ScrollView contentContainerStyle={styles.pageContent}>
      <SectionHeader title="发现音乐" caption="搜索、收藏和最近播放都会汇集到这里。" />
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>把桌面端的听歌体验带到手机上</Text>
        <Text style={styles.heroText}>先跑通搜索、播放、歌词和历史，后续再接登录、缓存和 B 站合集。</Text>
      </View>
      <SectionHeader title={history.length > 0 ? "最近播放" : "推荐试听"} caption="点一首歌验证移动端播放链路。" />
      <SongList songs={displaySongs} onPlay={onPlay} />
    </ScrollView>
  );
}

function SearchScreen({ onPlay }: { onPlay: (song: MusicInfo) => void }) {
  const [keyword, setKeyword] = useState("");
  const [source, setSource] = useState<Extract<SourceTag, "wy" | "tx">>("wy");
  const [songs, setSongs] = useState<MusicInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    const query = keyword.trim();
    if (!query) return;
    setLoading(true);
    setError(null);
    try {
      setSongs(await searchSongs(source, query));
    } catch (err) {
      setSongs([]);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [keyword, source]);

  return (
    <ScrollView contentContainerStyle={styles.pageContent} keyboardShouldPersistTaps="handled">
      <SectionHeader title="搜索音乐" caption="先接入内置音乐 API，验证安卓端播放闭环。" />
      <View style={styles.searchBox}>
        <TextInput
          value={keyword}
          onChangeText={setKeyword}
          onSubmitEditing={submit}
          placeholder="搜索歌曲、歌手"
          placeholderTextColor="#8fa79f"
          style={styles.searchInput}
          returnKeyType="search"
        />
        <Pressable style={styles.primaryButton} onPress={submit}>
          <Text style={styles.primaryButtonText}>搜索</Text>
        </Pressable>
      </View>
      <View style={styles.segmented}>
        {(["wy", "tx"] as const).map((item) => (
          <Pressable key={item} style={[styles.segmentButton, source === item && styles.segmentButtonActive]} onPress={() => setSource(item)}>
            <Text style={[styles.segmentText, source === item && styles.segmentTextActive]}>{getSourceLabel(item)}</Text>
          </Pressable>
        ))}
      </View>
      {loading && <ActivityIndicator color="#45e58d" style={styles.loading} />}
      {error && <Text style={styles.errorText}>{error}</Text>}
      <SongList songs={songs} onPlay={onPlay} emptyText="输入关键词后搜索歌曲" />
    </ScrollView>
  );
}

function LibraryScreen({ history, onPlay }: { history: MusicInfo[]; onPlay: (song: MusicInfo) => void }) {
  return (
    <ScrollView contentContainerStyle={styles.pageContent}>
      <SectionHeader title="我的歌单" caption="移动端先保留桌面端的信息架构。" />
      <View style={styles.quickGrid}>
        <QuickCard title="我喜欢的音乐" caption="等待接入账号收藏" />
        <QuickCard title="播放历史" caption={`${history.length} 首歌曲`} />
        <QuickCard title="B站收藏合集" caption="等待接入 Cookie 和合集列表" />
        <QuickCard title="本地音乐" caption="等待接入 Android 媒体库权限" />
      </View>
      <SectionHeader title="播放历史" caption="已在手机端播放过的歌曲会显示在这里。" />
      <SongList songs={history} onPlay={onPlay} emptyText="暂无播放历史" />
    </ScrollView>
  );
}

function PlayerScreen({ playback, onToggle }: { playback: PlaybackState; onToggle: () => void }) {
  const song = playback.current;
  const activeLines = playback.lyrics.slice(0, 6);

  if (!song) {
    return (
      <View style={[styles.pageContent, styles.emptyPlayer]}>
        <Text style={styles.emptyTitle}>还没有播放歌曲</Text>
        <Text style={styles.emptyText}>从发现或搜索里选择一首歌开始。</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.playerPage}>
      <Artwork song={song} size={260} />
      <Text style={styles.nowTitle}>{song.name}</Text>
      <Text style={styles.nowArtist}>{formatArtists(song)}</Text>
      <Pressable style={styles.playButton} onPress={onToggle} disabled={playback.loading}>
        <Text style={styles.playButtonText}>{playback.loading ? "加载中" : playback.isPlaying ? "暂停" : "播放"}</Text>
      </Pressable>
      {playback.error && <Text style={styles.errorText}>{playback.error}</Text>}
      <View style={styles.lyricPanel}>
        {activeLines.length > 0 ? activeLines.map((line, index) => (
          <View key={`${line.time}-${index}`} style={styles.lyricLine}>
            <Text style={[styles.lyricText, index === 0 && styles.lyricTextActive]}>{line.text}</Text>
            {line.tr && <Text style={styles.translationText}>{line.tr}</Text>}
          </View>
        )) : (
          <Text style={styles.emptyText}>暂无歌词</Text>
        )}
      </View>
    </ScrollView>
  );
}

function MiniPlayer({ playback, onOpen, onToggle }: { playback: PlaybackState; onOpen: () => void; onToggle: () => void }) {
  const song = playback.current;
  if (!song) return null;

  return (
    <View style={styles.miniPlayer}>
      <Pressable style={styles.miniInfo} onPress={onOpen}>
        <Artwork song={song} size={46} />
        <View style={styles.miniTextBlock}>
          <Text style={styles.miniTitle} numberOfLines={1}>{song.name}</Text>
          <Text style={styles.miniArtist} numberOfLines={1}>{formatArtists(song)}</Text>
        </View>
      </Pressable>
      <Pressable style={styles.miniButton} onPress={onToggle}>
        <Text style={styles.miniButtonText}>{playback.isPlaying ? "暂停" : "播放"}</Text>
      </Pressable>
    </View>
  );
}

function SectionHeader({ title, caption }: { title: string; caption: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionCaption}>{caption}</Text>
    </View>
  );
}

function QuickCard({ title, caption }: { title: string; caption: string }) {
  return (
    <View style={styles.quickCard}>
      <Text style={styles.quickTitle}>{title}</Text>
      <Text style={styles.quickCaption}>{caption}</Text>
    </View>
  );
}

function SongList({ songs, onPlay, emptyText = "暂无歌曲" }: { songs: MusicInfo[]; onPlay: (song: MusicInfo) => void; emptyText?: string }) {
  if (songs.length === 0) {
    return <Text style={styles.emptyText}>{emptyText}</Text>;
  }

  return (
    <View style={styles.songList}>
      {songs.map((song) => (
        <Pressable key={`${song.source}-${song.id}`} style={styles.songRow} onPress={() => onPlay(song)}>
          <Artwork song={song} size={54} />
          <View style={styles.songTextBlock}>
            <Text style={styles.songTitle} numberOfLines={1}>{song.name}</Text>
            <Text style={styles.songMeta} numberOfLines={1}>{getSourceLabel(song.source)} · {formatArtists(song)}</Text>
          </View>
          <Text style={styles.rowAction}>播放</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Artwork({ song, size }: { song: MusicInfo; size: number }) {
  const artwork = getArtworkUrl(song);
  if (!artwork) {
    return (
      <View style={[styles.artworkFallback, { width: size, height: size, borderRadius: Math.max(12, size * 0.18) }]}>
        <Text style={styles.artworkFallbackText}>AF</Text>
      </View>
    );
  }
  return <Image source={{ uri: artwork }} style={{ width: size, height: size, borderRadius: Math.max(12, size * 0.18) }} />;
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: "#10241f" },
  header: { paddingHorizontal: 22, paddingTop: 12, paddingBottom: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  brand: { color: "#45e58d", fontSize: 26, fontWeight: "800" },
  subtitle: { color: "#b8c8c1", fontSize: 13, marginTop: 2 },
  statusPill: { paddingHorizontal: 12, paddingVertical: 7, backgroundColor: "rgba(69,229,141,0.14)", borderRadius: 999 },
  statusText: { color: "#8ff0b8", fontSize: 12, fontWeight: "700" },
  content: { flex: 1 },
  pageContent: { paddingHorizontal: 20, paddingBottom: 132 },
  hero: { padding: 18, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: "rgba(255,255,255,0.11)", marginBottom: 20 },
  heroTitle: { color: "#f5fffa", fontSize: 22, fontWeight: "800", lineHeight: 30 },
  heroText: { color: "#c7d8d1", fontSize: 14, lineHeight: 22, marginTop: 8 },
  sectionHeader: { marginTop: 16, marginBottom: 12 },
  sectionTitle: { color: "#f7fffb", fontSize: 22, fontWeight: "800" },
  sectionCaption: { color: "#a8bdb5", fontSize: 13, marginTop: 5 },
  searchBox: { flexDirection: "row", alignItems: "center", gap: 10 },
  searchInput: { flex: 1, minHeight: 48, paddingHorizontal: 16, color: "#f7fffb", backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.11)" },
  primaryButton: { minHeight: 48, paddingHorizontal: 18, justifyContent: "center", backgroundColor: "#35d779", borderRadius: 16 },
  primaryButtonText: { color: "#082117", fontSize: 15, fontWeight: "800" },
  segmented: { flexDirection: "row", gap: 10, marginTop: 14, marginBottom: 6 },
  segmentButton: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.08)" },
  segmentButtonActive: { backgroundColor: "rgba(69,229,141,0.18)" },
  segmentText: { color: "#b8c8c1", fontWeight: "700" },
  segmentTextActive: { color: "#7af0ad" },
  loading: { marginTop: 20 },
  errorText: { color: "#ffb0a6", fontSize: 13, lineHeight: 20, marginVertical: 12 },
  songList: { gap: 10 },
  songRow: { minHeight: 72, padding: 10, flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)" },
  songTextBlock: { flex: 1 },
  songTitle: { color: "#f7fffb", fontSize: 16, fontWeight: "800" },
  songMeta: { color: "#abc0b8", fontSize: 13, marginTop: 5 },
  rowAction: { color: "#76efa9", fontWeight: "800" },
  quickGrid: { gap: 12 },
  quickCard: { padding: 16, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)" },
  quickTitle: { color: "#f7fffb", fontSize: 17, fontWeight: "800" },
  quickCaption: { color: "#abc0b8", fontSize: 13, marginTop: 6 },
  emptyPlayer: { justifyContent: "center", alignItems: "center", flexGrow: 1 },
  emptyTitle: { color: "#f7fffb", fontSize: 22, fontWeight: "800" },
  emptyText: { color: "#9db0a9", fontSize: 14, lineHeight: 22, marginTop: 8 },
  playerPage: { paddingHorizontal: 22, paddingTop: 20, paddingBottom: 150, alignItems: "center" },
  nowTitle: { color: "#f7fffb", fontSize: 28, fontWeight: "900", marginTop: 22, textAlign: "center" },
  nowArtist: { color: "#c5d5ce", fontSize: 16, marginTop: 8, textAlign: "center" },
  playButton: { marginTop: 22, minWidth: 120, minHeight: 52, justifyContent: "center", alignItems: "center", borderRadius: 999, backgroundColor: "#35d779" },
  playButtonText: { color: "#082117", fontSize: 17, fontWeight: "900" },
  lyricPanel: { alignSelf: "stretch", marginTop: 26, padding: 18, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.07)", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)" },
  lyricLine: { marginBottom: 12 },
  lyricText: { color: "rgba(247,255,251,0.58)", fontSize: 18, lineHeight: 27, fontWeight: "700", textAlign: "center" },
  lyricTextActive: { color: "#f7fffb", fontSize: 22 },
  translationText: { color: "#a9bcb5", fontSize: 14, lineHeight: 20, marginTop: 4, textAlign: "center" },
  artworkFallback: { alignItems: "center", justifyContent: "center", backgroundColor: "rgba(69,229,141,0.18)", borderWidth: 1, borderColor: "rgba(69,229,141,0.22)" },
  artworkFallbackText: { color: "#7af0ad", fontWeight: "900" },
  miniPlayer: { position: "absolute", left: 16, right: 16, bottom: 84, minHeight: 66, padding: 10, flexDirection: "row", alignItems: "center", borderRadius: 22, backgroundColor: "rgba(14,32,27,0.95)", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)" },
  miniInfo: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  miniTextBlock: { flex: 1 },
  miniTitle: { color: "#f7fffb", fontSize: 15, fontWeight: "800" },
  miniArtist: { color: "#abc0b8", fontSize: 12, marginTop: 3 },
  miniButton: { minWidth: 58, minHeight: 42, alignItems: "center", justifyContent: "center", borderRadius: 999, backgroundColor: "rgba(69,229,141,0.18)" },
  miniButtonText: { color: "#7af0ad", fontWeight: "900" },
  tabBar: { minHeight: 68, paddingHorizontal: 14, paddingTop: 8, paddingBottom: 10, flexDirection: "row", gap: 8, backgroundColor: "#0b1c18", borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)" },
  tabButton: { flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 16 },
  tabButtonActive: { backgroundColor: "rgba(69,229,141,0.16)" },
  tabText: { color: "#9db0a9", fontSize: 14, fontWeight: "800" },
  tabTextActive: { color: "#7af0ad" },
});

export default App;
