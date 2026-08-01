import React from "react";
import { View, StyleSheet } from "react-native";
import { usePlayerStore } from "@/stores/playerStore";
import { useThemeStore, getResolvedTheme, getThemePalette } from "@/stores/themeStore";

export function MiniProgressBar() {
  const position = usePlayerStore((state) => state.position);
  const duration = usePlayerStore((state) => state.duration);
  const themeMode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(themeMode, systemTheme), accentColor);

  const progress = duration > 0 ? position / duration : 0;

  return (
    <View
      style={[styles.container, { backgroundColor: palette.surfaceMuted }]}
      accessibilityRole="progressbar"
      accessibilityValue={{
        min: 0,
        max: 100,
        now: Math.round(progress * 100),
      }}
    >
      <View
        style={[
          styles.progress,
          {
            width: `${progress * 100}%`,
            backgroundColor: palette.primary,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 2,
  },
  progress: {
    height: "100%",
  },
});
