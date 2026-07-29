import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { radius, spacing, touch, typography } from "@/theme/tokens";

export interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
}

export interface EmptyStateProps {
  title: string;
  description?: string;
}

export interface LoadingStateProps {
  label?: string;
}

function useScreenStatePalette() {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  return getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);
}

export function LoadingState({ label = "加载中" }: LoadingStateProps) {
  const palette = useScreenStatePalette();
  return (
    <View accessibilityLiveRegion="polite" style={styles.state}>
      <ActivityIndicator color={palette.primary} size="large" />
      <Text style={[styles.description, { color: palette.textMuted }]}>{label}</Text>
    </View>
  );
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  const palette = useScreenStatePalette();
  return (
    <View
      accessibilityRole="alert"
      style={[styles.state, styles.card, { backgroundColor: palette.dangerSurface, borderColor: palette.danger }]}
    >
      <Text style={[styles.title, { color: palette.danger }]}>加载失败</Text>
      <Text style={[styles.description, { color: palette.text }]}>{message}</Text>
      {onRetry ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="重试"
          onPress={onRetry}
          style={[styles.retryButton, { backgroundColor: palette.primary }]}
        >
          <Text style={[styles.retryText, { color: palette.primaryText }]}>重试</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function EmptyState({ title, description }: EmptyStateProps) {
  const palette = useScreenStatePalette();
  return (
    <View style={[styles.state, styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <Text style={[styles.title, { color: palette.text }]}>{title}</Text>
      {description ? (
        <Text style={[styles.description, { color: palette.textMuted }]}>{description}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  state: {
    minWidth: 0,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.l,
    paddingHorizontal: spacing.s,
    gap: spacing.xs,
  },
  card: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  title: {
    fontSize: typography.title,
    fontWeight: "600",
    textAlign: "center",
  },
  description: {
    fontSize: typography.body,
    lineHeight: 21,
    textAlign: "center",
  },
  retryButton: {
    minHeight: touch.minTarget,
    minWidth: touch.minTarget,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.l,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  retryText: {
    fontSize: typography.body,
    fontWeight: "600",
  },
});
