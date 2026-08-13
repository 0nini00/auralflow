import React, { type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { CachedImage } from "@/components/CachedImage";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { radius, spacing, touch, typography } from "@/theme/tokens";

type Palette = ReturnType<typeof getThemePalette>;

export interface HomeQuickActionsProps {
  actions: { id: string; label: string; icon: ReactNode }[];
  onPress: (id: string) => void;
}

export interface PlaylistRailProps {
  items: {
    id: string;
    name: string;
    coverImgUrl?: string;
  }[];
  onPress: (id: string) => void;
}

export interface AlbumRailProps {
  items: {
    id: string;
    name: string;
    artistName?: string;
    coverImgUrl?: string;
  }[];
  onPress: (id: string) => void;
}

export interface LeaderboardRailProps {
  items: {
    id: string;
    name: string;
    coverImgUrl?: string;
  }[];
  onPress: (id: string) => void;
}

export interface HomeSectionErrorProps {
  message: string;
  onRetry: () => void;
  loading: boolean;
}

function usePalette(): Palette {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  return getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);
}

export function HomeQuickActions({ actions, onPress }: HomeQuickActionsProps) {
  const palette = usePalette();
  return (
    <View style={styles.actions}>
      {actions.map((action) => (
        <Pressable
          key={action.id}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          onPress={() => onPress(action.id)}
          style={({ pressed }) => [
            styles.actionButton,
            { backgroundColor: palette.text, opacity: pressed ? 0.75 : 1 },
          ]}
        >
          <View style={styles.actionIcon}>{action.icon}</View>
          <Text numberOfLines={1} style={[styles.actionLabel, { color: palette.background }]}>
            {action.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export function PlaylistRail({ items, onPress }: PlaylistRailProps) {
  const palette = usePalette();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
      {items.map((item) => (
        <Pressable
          key={item.id}
          accessibilityRole="button"
          accessibilityLabel={item.name}
          onPress={() => onPress(item.id)}
          style={({ pressed }) => [styles.card, { opacity: pressed ? 0.75 : 1 }]}
        >
          <RailImage uri={item.coverImgUrl} palette={palette} />
          <Text numberOfLines={2} style={[styles.name, { color: palette.text }]}>{item.name}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

export function AlbumRail({ items, onPress }: AlbumRailProps) {
  const palette = usePalette();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
      {items.map((item) => (
        <Pressable
          key={item.id}
          accessibilityRole="button"
          accessibilityLabel={item.name}
          onPress={() => onPress(item.id)}
          style={({ pressed }) => [styles.card, { opacity: pressed ? 0.75 : 1 }]}
        >
          <RailImage uri={item.coverImgUrl} palette={palette} />
          <Text numberOfLines={2} style={[styles.name, { color: palette.text }]}>{item.name}</Text>
          {item.artistName ? (
            <Text numberOfLines={1} style={[styles.meta, { color: palette.textMuted }]}>
              {item.artistName}
            </Text>
          ) : null}
        </Pressable>
      ))}
    </ScrollView>
  );
}

export function LeaderboardRail({ items, onPress }: LeaderboardRailProps) {
  const palette = usePalette();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
      {items.map((item) => (
        <Pressable
          key={item.id}
          accessibilityRole="button"
          accessibilityLabel={item.name}
          onPress={() => onPress(item.id)}
          style={({ pressed }) => [styles.card, { opacity: pressed ? 0.75 : 1 }]}
        >
          <RailImage uri={item.coverImgUrl} palette={palette} />
          <Text numberOfLines={1} style={[styles.name, { color: palette.text }]}>{item.name}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function RailImage({ uri, palette }: { uri?: string; palette: Palette }) {
  const imageStyle = [styles.cover, { backgroundColor: palette.textMuted }];
  return uri ? <CachedImage uri={uri} style={imageStyle} /> : <View style={imageStyle} />;
}

export function HomeSectionError({ message, onRetry, loading }: HomeSectionErrorProps) {
  const palette = usePalette();
  return (
    <View style={styles.errorRow}>
      <Text numberOfLines={2} style={[styles.errorMessage, { color: palette.textMuted }]}>
        {message}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={loading ? "正在重试" : "重试"}
        disabled={loading}
        onPress={onRetry}
        style={({ pressed }) => [
          styles.retryButton,
          { borderColor: palette.text, opacity: loading || pressed ? 0.55 : 1 },
        ]}
      >
        <Text style={[styles.retryLabel, { color: palette.text }]}>
          {loading ? "…" : "重试"}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  actionButton: {
    minHeight: touch.minTarget,
    minWidth: 132,
    flexGrow: 1,
    flexBasis: 132,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.s,
    borderRadius: radius.sm,
  },
  actionIcon: { alignItems: "center", justifyContent: "center" },
  actionLabel: { flexShrink: 1, fontSize: typography.meta, fontWeight: "600" },
  rail: { gap: spacing.s, paddingHorizontal: spacing.xxs },
  card: { width: 142, height: 202 },
  cover: { width: 142, height: 142, borderRadius: radius.sm },
  name: {
    marginTop: spacing.xs,
    fontSize: typography.body,
    fontWeight: "600",
    lineHeight: 19,
  },
  meta: { marginTop: spacing.xxs, fontSize: typography.caption, lineHeight: 16 },
  errorRow: {
    minHeight: touch.minTarget,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s,
  },
  errorMessage: { flex: 1, fontSize: typography.meta, lineHeight: 18 },
  retryButton: {
    minHeight: touch.minTarget,
    minWidth: touch.minTarget,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.s,
    borderWidth: 1,
    borderRadius: radius.sm,
  },
  retryLabel: { fontSize: typography.meta, fontWeight: "600" },
});
