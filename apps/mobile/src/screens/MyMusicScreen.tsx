import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { AccountInfo } from "@/components/AccountInfo";
import { useThemeStore, getResolvedTheme, getThemePalette } from "@/stores/themeStore";
import { radius, spacing, typography } from "@/theme/tokens";

interface MyMusicScreenProps {
  tab: "local" | "history" | "downloads";
  onNavigateToPlayer: () => void;
}

function AccountCard() {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = useMemo(
    () => getThemePalette(getResolvedTheme(mode, systemTheme), accentColor),
    [mode, systemTheme, accentColor],
  );

  return (
    <View
      style={[
        styles.accountCard,
        {
          backgroundColor: palette.surface,
          borderBottomColor: palette.border,
        },
      ]}
    >
      <AccountInfo onLoginPress={() => {}} />
    </View>
  );
}

function LocalMusicContent() {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = useMemo(
    () => getThemePalette(getResolvedTheme(mode, systemTheme), accentColor),
    [mode, systemTheme, accentColor],
  );

  return (
    <View style={styles.placeholder}>
      <Text style={[styles.placeholderText, { color: palette.textMuted }]}>
        本地音乐内容
      </Text>
    </View>
  );
}

function HistoryContent() {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = useMemo(
    () => getThemePalette(getResolvedTheme(mode, systemTheme), accentColor),
    [mode, systemTheme, accentColor],
  );

  return (
    <View style={styles.placeholder}>
      <Text style={[styles.placeholderText, { color: palette.textMuted }]}>
        播放历史内容
      </Text>
    </View>
  );
}

function DownloadsContent() {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = useMemo(
    () => getThemePalette(getResolvedTheme(mode, systemTheme), accentColor),
    [mode, systemTheme, accentColor],
  );

  return (
    <View style={styles.placeholder}>
      <Text style={[styles.placeholderText, { color: palette.textMuted }]}>
        下载管理内容
      </Text>
    </View>
  );
}

export function MyMusicScreen({ tab, onNavigateToPlayer }: MyMusicScreenProps) {
  return (
    <View style={styles.container}>
      <AccountCard />
      <View style={styles.content}>
        {tab === "local" && <LocalMusicContent />}
        {tab === "history" && <HistoryContent />}
        {tab === "downloads" && <DownloadsContent />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  accountCard: {
    paddingHorizontal: spacing.s,
    paddingVertical: spacing.m,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  content: {
    flex: 1,
  },
  placeholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  placeholderText: {
    fontSize: typography.body,
  },
});
