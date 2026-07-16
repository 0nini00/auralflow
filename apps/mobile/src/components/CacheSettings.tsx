import React, { useState, useEffect } from "react";
import { View, Text, StyleSheet, Pressable, Alert, ActivityIndicator } from "react-native";
import {
  getCacheStats,
  formatCacheSize,
  cleanExpiredCache,
  clearAllCache,
  type CacheStats,
} from "@/services/cacheService";
import {
  clearPlaybackHistoryAndCache,
  getPlaybackHistoryAndCacheCleanupAction,
} from "@/services/dataCleanupService";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";

const EMPTY_CACHE_STATS: CacheStats = {
  totalSize: 0,
  coverCacheSize: 0,
  lyricCacheSize: 0,
  otherCacheSize: 0,
};

export function CacheSettings() {
  const [cacheStats, setCacheStats] = useState<CacheStats>(EMPTY_CACHE_STATS);
  const [loading, setLoading] = useState(false);
  const cleanupAction = getPlaybackHistoryAndCacheCleanupAction();
  const themeMode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(themeMode, systemTheme), accentColor);

  useEffect(() => {
    loadCacheSize();
  }, []);

  const loadCacheSize = async () => {
    setLoading(true);
    const stats = await getCacheStats();
    setCacheStats(stats);
    setLoading(false);
  };

  const handleCleanExpired = async () => {
    Alert.alert(
      "清理过期缓存",
      "将删除超过30天的缓存文件",
      [
        { text: "取消", style: "cancel" },
        {
          text: "确定",
          onPress: async () => {
            setLoading(true);
            await cleanExpiredCache();
            await loadCacheSize();
            Alert.alert("完成", "已清理过期缓存");
          },
        },
      ]
    );
  };

  const handleClearAll = async () => {
    Alert.alert(
      "清空所有缓存",
      "将删除所有封面和歌词缓存，下次播放时会重新下载",
      [
        { text: "取消", style: "cancel" },
        {
          text: "确定",
          style: "destructive",
          onPress: async () => {
            setLoading(true);
            await clearAllCache();
            await loadCacheSize();
            Alert.alert("完成", "已清空所有缓存");
          },
        },
      ]
    );
  };

  const handleClearHistoryAndCache = async () => {
    Alert.alert(
      cleanupAction.confirmTitle,
      cleanupAction.confirmMessage,
      [
        { text: "取消", style: "cancel" },
        {
          text: "确定",
          style: "destructive",
          onPress: async () => {
            setLoading(true);
            const result = await clearPlaybackHistoryAndCache();
            setCacheStats({
              ...EMPTY_CACHE_STATS,
              totalSize: result.cacheSize,
            });
            setLoading(false);
            Alert.alert("完成", result.message);
          },
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: palette.text }]}>缓存管理</Text>
        <Text style={[styles.sectionCaption, { color: palette.textMuted }]}>
          封面和歌词会自动缓存到本地，减少流量消耗
        </Text>
      </View>

      <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <View style={styles.row}>
          <Text style={[styles.label, { color: palette.text }]}>总占用</Text>
          {loading ? (
            <ActivityIndicator color={palette.primary} size="small" />
          ) : (
            <Text style={[styles.value, { color: palette.primary }]}>
              {formatCacheSize(cacheStats.totalSize)}
            </Text>
          )}
        </View>
        <View style={styles.cacheBreakdown}>
          <CacheSizeItem label="封面图片" size={cacheStats.coverCacheSize} loading={loading} palette={palette} />
          <CacheSizeItem label="歌词文件" size={cacheStats.lyricCacheSize} loading={loading} palette={palette} />
          <CacheSizeItem label="其他缓存" size={cacheStats.otherCacheSize} loading={loading} palette={palette} />
        </View>
      </View>

      <Pressable
        style={[styles.button, { backgroundColor: palette.surface, borderColor: palette.border }]}
        onPress={handleCleanExpired}
        disabled={loading}
      >
        <Text style={[styles.buttonText, { color: palette.text }]}>清理过期缓存</Text>
        <Text style={[styles.buttonCaption, { color: palette.textMuted }]}>删除超过30天的缓存文件</Text>
      </Pressable>

      <Pressable
        style={[styles.button, { backgroundColor: palette.dangerSurface, borderColor: palette.dangerSurface }]}
        onPress={handleClearAll}
        disabled={loading}
      >
        <Text style={[styles.buttonText, { color: palette.danger }]}>
          清空所有缓存
        </Text>
        <Text style={[styles.buttonCaption, { color: palette.textMuted }]}>
          将删除所有缓存，下次播放时重新下载
        </Text>
      </Pressable>

      <Pressable
        style={[styles.button, { backgroundColor: palette.dangerSurface, borderColor: palette.dangerSurface }]}
        onPress={handleClearHistoryAndCache}
        disabled={loading}
      >
        <Text style={[styles.buttonText, { color: palette.danger }]}>
          {cleanupAction.title}
        </Text>
        <Text style={[styles.buttonCaption, { color: palette.textMuted }]}>{cleanupAction.caption}</Text>
      </Pressable>
    </View>
  );
}

interface CacheSizeItemProps {
  label: string;
  size: number;
  loading: boolean;
  palette: ReturnType<typeof getThemePalette>;
}

function CacheSizeItem({ label, size, loading, palette }: CacheSizeItemProps) {
  return (
    <View style={[styles.cacheSizeItem, { backgroundColor: palette.surfaceMuted }]}>
      <Text style={[styles.cacheSizeLabel, { color: palette.textMuted }]}>{label}</Text>
      <Text style={[styles.cacheSizeValue, { color: palette.text }]}>
        {loading ? "计算中..." : formatCacheSize(size)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#ffffff",
    marginBottom: 4,
  },
  sectionCaption: {
    fontSize: 13,
    color: "#8fa79f",
  },
  card: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 16,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  label: {
    fontSize: 15,
  },
  value: {
    fontSize: 15,
    fontWeight: "600",
  },
  cacheBreakdown: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 14,
  },
  cacheSizeItem: {
    minWidth: "30%",
    flex: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 3,
  },
  cacheSizeLabel: {
    fontSize: 11,
    fontWeight: "600",
  },
  cacheSizeValue: {
    fontSize: 13,
    fontWeight: "700",
  },
  button: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 4,
  },
  buttonCaption: {
    fontSize: 13,
  },
});
