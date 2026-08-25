import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { ActionButton } from "@/components/ActionButton";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { radius, spacing, touch, typography } from "@/theme/tokens";

interface PlaybackErrorStateProps {
  message: string | null;
  onDismiss: () => void;
}

export function PlaybackErrorState({
  message,
  onDismiss,
}: PlaybackErrorStateProps) {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  if (!message) return null;

  return (
    <View
      accessibilityRole="alert"
      style={[
        styles.container,
        { backgroundColor: palette.dangerSurface, borderColor: palette.danger },
      ]}
    >
      <Text style={[styles.message, { color: palette.danger }]}>{message}</Text>
      <ActionButton label="关闭" variant="danger" small onPress={onDismiss} accessibilityLabel="关闭播放错误" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: touch.minTarget,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    paddingLeft: spacing.s,
    gap: spacing.xs,
  },
  message: {
    flex: 1,
    fontSize: typography.meta,
  },
});
