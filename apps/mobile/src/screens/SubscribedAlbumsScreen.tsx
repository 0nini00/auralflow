import React, { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { ChevronLeft, Disc3 } from "lucide-react-native";

import { IconButton } from "@/components/IconButton";
import { ScreenScaffold } from "@/components/ScreenScaffold";
import { EmptyState, ErrorState, LoadingState } from "@/components/ScreenState";
import { AlbumResultList } from "@/components/SearchResultSections";
import { getSubscribedAlbums } from "@/services/wyAssetService";
import type { SearchAlbumResult } from "@/services/musicApi";
import { openAlbumDetailScreen } from "@/navigation/navigationRef";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { spacing, typography } from "@/theme/tokens";

export function SubscribedAlbumsScreen({ onBack }: { onBack?: () => void }) {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = useMemo(
    () => getThemePalette(getResolvedTheme(mode, systemTheme), accentColor),
    [mode, systemTheme, accentColor],
  );

  const [albums, setAlbums] = useState<SearchAlbumResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getSubscribedAlbums(100, 0);
      setAlbums(res.albums);
    } catch (err) {
      setError(err instanceof Error ? err.message : "获取收藏专辑失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  return (
    <ScreenScaffold>
      <View style={[styles.header, { borderBottomColor: palette.border }]}>
        {onBack ? (
          <IconButton
            render={({ size, color }) => <ChevronLeft size={size} color={color} />}
            onPress={onBack}
            accessibilityLabel="返回"
          />
        ) : null}
        <Text style={[styles.title, { color: palette.text }]}>收藏的专辑</Text>
      </View>
      <View style={styles.container}>
        {loading ? (
          <LoadingState label="正在加载收藏的专辑…" />
        ) : error ? (
          <ErrorState message={error} onRetry={loadData} />
        ) : albums.length === 0 ? (
          <EmptyState
            icon={Disc3}
            title="暂无收藏的专辑"
            description="在网易云音乐中收藏专辑后，会同步显示在这里"
          />
        ) : (
          <AlbumResultList
            albums={albums}
            onPress={(album) => openAlbumDetailScreen(album)}
          />
        )}
      </View>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.s,
    paddingVertical: spacing.s,
    gap: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: {
    fontSize: typography.heading,
    fontWeight: "700",
  },
  container: {
    flex: 1,
    paddingHorizontal: spacing.m,
  },
});
