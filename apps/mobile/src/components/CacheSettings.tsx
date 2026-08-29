import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { ChevronDown, ChevronRight, Trash2 } from "lucide-react-native";

import { SectionHeader } from "@/components/SectionHeader";
import { ListItemButton } from "@/components/ui/ListItemButton";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { openDownloadsScreen, openHistoryScreen } from "@/navigation";
import {
  cleanExpiredCache,
  deleteCachedAudio,
  formatCacheSize,
  getCacheStats,
  listCachedAudio,
  type CacheStats,
} from "@/services/cacheService";
import type { CachedAudioEntry } from "@/services/audioCacheListModel";
import { clearMediaCache } from "@/services/dataCleanupService";
import { useDownloadStore } from "@/stores/downloadStore";
import { useHistoryStore } from "@/stores/historyStore";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { radius, spacing, touch, typography } from "@/theme/tokens";

const EMPTY_CACHE_STATS: CacheStats = {
  totalSize: 0,
  coverCacheSize: 0,
  lyricCacheSize: 0,
  audioCacheSize: 0,
  otherCacheSize: 0,
};

type PendingAction = "stats" | "expired" | "cache" | "history" | null;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function CacheSettings() {
  const [cacheStats, setCacheStats] = useState<CacheStats>(EMPTY_CACHE_STATS);
  const [pendingAction, setPendingAction] = useState<PendingAction>("stats");
  const historyEntries = useHistoryStore((state) => state.entries);
  const loadHistory = useHistoryStore((state) => state.loadHistory);
  const clearHistory = useHistoryStore((state) => state.clearHistory);
  const downloads = useDownloadStore((state) => state.downloads);
  const downloading = useDownloadStore((state) => state.downloading);
  const failedDownloads = useDownloadStore((state) => state.failedDownloads);
  const loadDownloads = useDownloadStore((state) => state.loadDownloads);
  const themeMode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(themeMode, systemTheme), accentColor);
  const busy = pendingAction !== null;

  const loadCacheSize = useCallback(async () => {
    const stats = await getCacheStats();
    setCacheStats(stats);
  }, []);

  const loadDataStatus = useCallback(async () => {
    const results = await Promise.allSettled([loadCacheSize(), loadHistory(), loadDownloads()]);
    const errors = results
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => getErrorMessage(result.reason));
    const historyError = useHistoryStore.getState().error;
    const downloadError = useDownloadStore.getState().error;
    if (historyError) errors.push(`播放历史：${historyError}`);
    if (downloadError) errors.push(`下载记录：${downloadError}`);
    if (errors.length > 0) {
      throw new Error([...new Set(errors)].join("；"));
    }
  }, [loadCacheSize, loadDownloads, loadHistory]);

  useEffect(() => {
    void loadDataStatus()
      .catch((error) => {
        Alert.alert("无法读取数据状态", `缓存、下载或播放历史状态读取失败：${getErrorMessage(error)}`);
      })
      .finally(() => setPendingAction(null));
  }, [loadDataStatus]);

  const runCacheAction = async (
    action: Exclude<PendingAction, "stats" | "history" | null>,
    operation: () => Promise<void>,
    successMessage: string,
  ) => {
    if (busy) return;
    setPendingAction(action);
    try {
      await operation();
      await loadCacheSize();
      Alert.alert("操作完成", successMessage);
    } catch (error) {
      Alert.alert("操作失败", `${successMessage.replace("已", "未能")}：${getErrorMessage(error)}`);
    } finally {
      setPendingAction(null);
    }
  };

  const handleCleanExpired = () => {
    Alert.alert(
      "清理过期歌词",
      "封面与音频缓存长期有效（超过容量上限后自动清理），仅歌词按 30 天过期。播放历史与已下载歌曲不会受影响。",
      [
        { text: "取消", style: "cancel" },
        {
          text: "清理过期歌词",
          style: "destructive",
          onPress: () => void runCacheAction("expired", cleanExpiredCache, "已清理过期歌词"),
        },
      ],
    );
  };

  const handleClearAll = () => {
    Alert.alert(
      "清空全部缓存",
      "将永久删除所有封面、歌词、音频和播放地址缓存，下次使用时需要重新下载。播放历史与已下载歌曲不会被删除。",
      [
        { text: "取消", style: "cancel" },
        {
          text: "清空缓存",
          style: "destructive",
          onPress: () => void runCacheAction("cache", async () => { await clearMediaCache(); }, "已清空全部缓存"),
        },
      ],
    );
  };

  const handleClearHistory = () => {
    Alert.alert(
      "清空播放历史",
      "将永久删除全部播放历史记录。缓存与已下载歌曲不会受影响，此操作无法撤销。",
      [
        { text: "取消", style: "cancel" },
        {
          text: "清空播放历史",
          style: "destructive",
          onPress: () => {
            if (busy) return;
            void (async () => {
              setPendingAction("history");
              try {
                await clearHistory();
                Alert.alert("操作完成", "已清空播放历史");
              } catch (error) {
                Alert.alert("操作失败", `未能清空播放历史：${getErrorMessage(error)}`);
              } finally {
                setPendingAction(null);
              }
            })();
          },
        },
      ],
    );
  };

  const downloadStatus = downloading.length > 0
    ? `${downloading.length} 项下载中，已完成 ${downloads.length} 首`
    : failedDownloads.length > 0
      ? `已下载 ${downloads.length} 首，${failedDownloads.length} 项失败`
      : `已下载 ${downloads.length} 首`;

  return (
    <View style={styles.container}>
      <View style={styles.section}>
        <SectionHeader title="缓存" description="查看本地占用，清理不再使用的临时文件" />
        <SettingsCard style={styles.cachePanel}>
          <View
            accessibilityLabel={pendingAction === "stats" ? "正在读取缓存占用" : `缓存占用 ${formatCacheSize(cacheStats.totalSize)}`}
            accessibilityLiveRegion="polite"
            accessibilityRole="text"
            style={styles.totalRow}
          >
            <Text style={[styles.rowTitle, { color: palette.text }]}>缓存占用</Text>
            {pendingAction === "stats" ? (
              <ActivityIndicator accessibilityLabel="正在读取缓存占用" color={palette.primary} size="small" />
            ) : (
              <Text style={[styles.totalValue, { color: palette.primary }]}>
                {formatCacheSize(cacheStats.totalSize)}
              </Text>
            )}
          </View>
          <View style={styles.breakdown}>
            <CacheSizeItem label="封面" size={cacheStats.coverCacheSize} palette={palette} />
            <CacheSizeItem label="歌词" size={cacheStats.lyricCacheSize} palette={palette} />
            <CacheSizeItem label="音频" size={cacheStats.audioCacheSize} palette={palette} />
            <CacheSizeItem label="其他" size={cacheStats.otherCacheSize} palette={palette} />
          </View>
        </SettingsCard>
        <ActionRow
          title="清理过期歌词"
          subtitle="仅歌词 30 天过期，封面/音频自动按容量清理"
          accessibilityLabel="清理过期歌词，仅歌词 30 天过期，封面与音频自动按容量清理"
          disabled={busy}
          loading={pendingAction === "expired"}
          onPress={handleCleanExpired}
          palette={palette}
        />
      </View>

      <View style={styles.section}>
        <SectionHeader title="播放缓存" description="播放过的歌曲自动缓存，可逐条删除" />
        <CachedAudioSection
          palette={palette}
          disabled={busy}
          onCacheChanged={() => {
            void loadCacheSize().catch(() => undefined);
          }}
        />
      </View>

      <View style={styles.section}>
        <SectionHeader title="数据入口" description="查看下载任务和播放记录" />
        <NavigationRow
          title="下载管理"
          subtitle={downloadStatus}
          onPress={openDownloadsScreen}
          palette={palette}
        />
        <NavigationRow
          title="播放历史"
          subtitle={`${historyEntries.length} 条播放记录`}
          onPress={openHistoryScreen}
          palette={palette}
        />
      </View>

      <View style={[styles.section, styles.dangerSection]}>
        <SectionHeader title="危险操作" description="以下操作会永久删除本地数据" />
        <ActionRow
          title="清空全部缓存"
          subtitle="删除所有缓存文件，不影响下载和历史"
          accessibilityLabel="清空全部缓存，删除所有缓存文件"
          destructive
          disabled={busy}
          loading={pendingAction === "cache"}
          onPress={handleClearAll}
          palette={palette}
        />
        <ActionRow
          title="清空播放历史"
          subtitle="永久删除全部播放记录，不影响缓存和下载"
          accessibilityLabel="清空播放历史，永久删除全部播放记录"
          destructive
          disabled={busy}
          loading={pendingAction === "history"}
          onPress={handleClearHistory}
          palette={palette}
        />
      </View>
    </View>
  );
}

interface PaletteProps {
  palette: ReturnType<typeof getThemePalette>;
}

function CacheSizeItem({ label, size, palette }: { label: string; size: number } & PaletteProps) {
  return (
    <View style={styles.cacheSizeItem}>
      <Text style={[styles.cacheSizeLabel, { color: palette.textMuted }]}>{label}</Text>
      <Text style={[styles.cacheSizeValue, { color: palette.text }]}>{formatCacheSize(size)}</Text>
    </View>
  );
}

interface ActionRowProps extends PaletteProps {
  title: string;
  subtitle: string;
  accessibilityLabel: string;
  destructive?: boolean;
  disabled: boolean;
  loading: boolean;
  onPress: () => void;
}

function ActionRow({
  title,
  subtitle,
  accessibilityLabel,
  destructive = false,
  disabled,
  loading,
  onPress,
  palette,
}: ActionRowProps) {
  return (
    <ListItemButton
      title={title}
      subtitle={subtitle}
      destructive={destructive}
      disabled={disabled}
      loading={loading}
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      trailing={loading ? <ActivityIndicator accessibilityLabel={`${title}进行中`} size="small" /> : undefined}
      style={[styles.actionRow, { backgroundColor: destructive ? palette.dangerSurface : palette.surface, borderColor: destructive ? palette.danger : palette.border }]}
    />
  );
}

function NavigationRow({ title, subtitle, onPress, palette }: { title: string; subtitle: string; onPress: () => void } & PaletteProps) {
  return (
    <ListItemButton
      title={title}
      subtitle={subtitle}
      accessibilityLabel={`${title}，${subtitle}`}
      onPress={onPress}
      trailing={<ChevronRight size={20} color={palette.primary} />}
      style={[styles.actionRow, { backgroundColor: palette.surface, borderColor: palette.border }]}
    />
  );
}

/** 已缓存歌曲：默认折叠显示统计，展开后逐条列出并支持单条删除。 */
function CachedAudioSection({
  palette,
  disabled,
  onCacheChanged,
}: PaletteProps & { disabled: boolean; onCacheChanged: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [entries, setEntries] = useState<CachedAudioEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    try {
      setEntries(await listCachedAudio());
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleToggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && entries === null) {
      void loadEntries();
    }
  };

  const handleDelete = (entry: CachedAudioEntry) => {
    if (deletingKey) return;
    setDeletingKey(entry.key);
    void (async () => {
      try {
        await deleteCachedAudio(entry);
        setEntries((prev) => prev?.filter((item) => item.key !== entry.key) ?? null);
        onCacheChanged();
      } catch (error) {
        Alert.alert("删除失败", getErrorMessage(error));
      } finally {
        setDeletingKey(null);
      }
    })();
  };

  const totalSize = (entries ?? []).reduce((sum, entry) => sum + entry.size, 0);
  const summary = entries === null
    ? "播放过的歌曲自动缓存"
    : entries.length === 0
      ? "暂无缓存歌曲"
      : `${entries.length} 首 · ${formatCacheSize(totalSize)}`;

  return (
    <View style={styles.section}>
      <ListItemButton
        title="已缓存歌曲"
        subtitle={summary}
        accessibilityLabel={`已缓存歌曲，${summary}，点击${expanded ? "收起" : "展开"}`}
        disabled={disabled}
        onPress={handleToggle}
        trailing={
          loading ? (
            <ActivityIndicator accessibilityLabel="正在读取缓存列表" size="small" color={palette.primary} />
          ) : expanded ? (
            <ChevronDown size={20} color={palette.primary} />
          ) : (
            <ChevronRight size={20} color={palette.primary} />
          )
        }
        style={[styles.actionRow, { backgroundColor: palette.surface, borderColor: palette.border }]}
      />
      {expanded && entries !== null ? (
        entries.length === 0 ? (
          <Text style={[styles.audioEmpty, { color: palette.textMuted }]}>
            暂无缓存歌曲，播放过的歌曲（网易云/QQ 音源）会自动缓存到这里
          </Text>
        ) : (
          <View style={[styles.audioList, { borderColor: palette.border }]}>
            {entries.map((entry) => (
              <CachedSongRow
                key={entry.key}
                entry={entry}
                palette={palette}
                deleting={deletingKey === entry.key}
                disabled={deletingKey !== null}
                onDelete={() => handleDelete(entry)}
              />
            ))}
          </View>
        )
      ) : null}
    </View>
  );
}

function CachedSongRow({
  entry,
  palette,
  deleting,
  disabled,
  onDelete,
}: {
  entry: CachedAudioEntry;
  palette: ReturnType<typeof getThemePalette>;
  deleting: boolean;
  disabled: boolean;
  onDelete: () => void;
}) {
  const title = entry.name || `未知歌曲（${entry.source}-${entry.key.split("-").slice(1, -1).join("-")}）`;
  const singer = entry.singer || "未知歌手";
  const qualityLabel = entry.quality && entry.quality !== "unknown" ? ` · ${entry.quality}` : "";
  return (
    <View style={[styles.audioRow, { borderBottomColor: palette.border }]}>
      <View style={styles.audioRowCopy}>
        <Text numberOfLines={1} style={[styles.audioRowTitle, { color: palette.text }]}>
          {title}
        </Text>
        <Text numberOfLines={1} style={[styles.audioRowMeta, { color: palette.textMuted }]}>
          {singer}
          {qualityLabel} · {formatCacheSize(entry.size)}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`删除缓存：${title}`}
        disabled={disabled || deleting}
        onPress={onDelete}
        hitSlop={8}
        style={({ pressed }) => [styles.audioRowDelete, { opacity: disabled && !deleting ? 0.4 : pressed ? 0.6 : 1 }]}
      >
        {deleting ? (
          <ActivityIndicator size="small" color={palette.danger} />
        ) : (
          <Trash2 size={18} color={palette.danger} />
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.xl },
  section: { gap: spacing.xs },
  dangerSection: { marginTop: spacing.m },
  cachePanel: {
    gap: spacing.s,
  },
  totalRow: {
    minHeight: touch.minTarget,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.s,
  },
  totalValue: { fontSize: typography.title, fontWeight: "700" },
  breakdown: { flexDirection: "row" },
  cacheSizeItem: { flex: 1, minWidth: 0, gap: spacing.xxs },
  cacheSizeLabel: { fontSize: typography.caption },
  cacheSizeValue: { fontSize: typography.meta, fontWeight: "700" },
  actionRow: {
    minHeight: touch.minTarget,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: spacing.s,
    paddingVertical: spacing.s,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s,
  },
  copy: { flex: 1, minWidth: 0, gap: spacing.xxs },
  rowTitle: { fontSize: typography.body, fontWeight: "600" },
  rowSubtitle: { fontSize: typography.caption, lineHeight: 18 },
  audioList: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    overflow: "hidden",
  },
  audioEmpty: {
    fontSize: typography.caption,
    lineHeight: 18,
    paddingHorizontal: spacing.s,
    paddingVertical: spacing.xs,
  },
  audioRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s,
    paddingHorizontal: spacing.s,
    paddingVertical: spacing.s,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  audioRowCopy: { flex: 1, minWidth: 0, gap: spacing.xxs },
  audioRowTitle: { fontSize: typography.body, fontWeight: "600" },
  audioRowMeta: { fontSize: typography.caption, lineHeight: 16 },
  audioRowDelete: {
    minHeight: touch.minTarget,
    minWidth: touch.minTarget,
    alignItems: "center",
    justifyContent: "center",
  },
});
