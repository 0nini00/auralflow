import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { CachedImage } from "@/components/CachedImage";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { radius, spacing, typography } from "@/theme/tokens";

export interface DetailHeroProps {
  imageUrl?: string | null;
  title: string;
  subtitle?: string | null;
  metadata?: string[];
  actions?: React.ReactNode;
}

export function DetailHero({
  imageUrl,
  title,
  subtitle,
  metadata = [],
  actions,
}: DetailHeroProps) {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  return (
    <View style={styles.root}>
      {imageUrl ? (
        <CachedImage
          uri={imageUrl}
          resizeMode="cover"
          style={styles.cover}
          fallback={
            <View
              style={[StyleSheet.absoluteFill, { backgroundColor: palette.surfaceStrong }]}
            />
          }
        />
      ) : (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={[styles.cover, { backgroundColor: palette.surfaceStrong }]}
        />
      )}

      <View style={styles.copy}>
        <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[styles.subtitle, { color: palette.textMuted }]}>{subtitle}</Text>
        ) : null}
        {metadata.length > 0 ? (
          <View style={styles.metadata}>
            {metadata.map((item, index) => (
              <React.Fragment key={`${item}:${index}`}>
                {index > 0 ? (
                  <Text style={[styles.separator, { color: palette.textSubtle }]}>·</Text>
                ) : null}
                <Text style={[styles.metadataText, { color: palette.textMuted }]}>{item}</Text>
              </React.Fragment>
            ))}
          </View>
        ) : null}
        {actions ? <View style={styles.actions}>{actions}</View> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    minWidth: 0,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing.m,
    marginBottom: spacing.l,
  },
  cover: {
    width: 120,
    height: 120,
    borderRadius: radius.md,
    overflow: "hidden",
  },
  copy: {
    flex: 1,
    minWidth: 180,
    gap: spacing.xs,
  },
  title: {
    fontSize: typography.display,
    fontWeight: "700",
  },
  subtitle: {
    fontSize: typography.meta,
    lineHeight: 18,
  },
  metadata: {
    minWidth: 0,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing.xs,
  },
  metadataText: {
    fontSize: typography.caption,
  },
  separator: {
    fontSize: typography.caption,
  },
  actions: {
    minWidth: 0,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: spacing.xxs,
  },
});
