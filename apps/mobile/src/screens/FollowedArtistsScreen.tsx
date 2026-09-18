import React, { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { ChevronLeft, UserCheck } from "lucide-react-native";

import { IconButton } from "@/components/IconButton";
import { ScreenScaffold } from "@/components/ScreenScaffold";
import { EmptyState, ErrorState, LoadingState } from "@/components/ScreenState";
import { ArtistResultList } from "@/components/SearchResultSections";
import { getFollowedArtists } from "@/services/wyAssetService";
import type { SearchArtistResult } from "@/services/musicApi";
import { openArtistDetailScreen } from "@/navigation/navigationRef";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { spacing, typography } from "@/theme/tokens";

export function FollowedArtistsScreen({ onBack }: { onBack?: () => void }) {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = useMemo(
    () => getThemePalette(getResolvedTheme(mode, systemTheme), accentColor),
    [mode, systemTheme, accentColor],
  );

  const [artists, setArtists] = useState<SearchArtistResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getFollowedArtists(100, 0);
      setArtists(res.artists);
    } catch (err) {
      setError(err instanceof Error ? err.message : "获取关注歌手失败");
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
        <Text style={[styles.title, { color: palette.text }]}>关注的歌手</Text>
      </View>
      <View style={styles.container}>
        {loading ? (
          <LoadingState label="正在加载关注的歌手…" />
        ) : error ? (
          <ErrorState message={error} onRetry={loadData} />
        ) : artists.length === 0 ? (
          <EmptyState
            icon={UserCheck}
            title="暂无关注的歌手"
            description="在网易云音乐中关注歌手后，会同步显示在这里"
          />
        ) : (
          <ArtistResultList
            artists={artists}
            onPress={(artist) => openArtistDetailScreen(artist)}
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
