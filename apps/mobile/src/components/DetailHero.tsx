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
  /** 对齐 lx：紧凑头部（小封面/小标题/紧凑间距）。歌单详情等使用 */
  compact?: boolean;
  /** 简介最大显示行数（超出截断），默认 4（lx 歌单详情 numberOfLines=4） */
  descLines?: number;
  /** 封面底部角标（对齐 lx CountText：半透明黑条 + 白色播放量），如 "16.2万次" */
  coverBadge?: string;
  /** 按钮整行铺满：actions 脱离右侧文字列，独立成行且左缘对齐封面（歌单详情三键样式） */
  actionsFullBleed?: boolean;
}

export function DetailHero({
  imageUrl,
  title,
  subtitle,
  metadata = [],
  actions,
  compact = false,
  descLines = 4,
  coverBadge,
  actionsFullBleed = false,
}: DetailHeroProps) {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  return (
    <View style={[styles.root, compact && styles.rootCompact]}>
      {imageUrl ? (
        <View style={[styles.cover, compact && styles.coverCompact]}>
          <CachedImage
            uri={imageUrl}
            resizeMode="cover"
            style={StyleSheet.absoluteFill}
            fallback={
              <View
                style={[StyleSheet.absoluteFill, { backgroundColor: palette.surfaceStrong }]}
              />
            }
          />
          {coverBadge ? (
            <Text style={styles.coverBadge} numberOfLines={1}>
              {coverBadge}
            </Text>
          ) : null}
        </View>
      ) : (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={[styles.cover, compact && styles.coverCompact, { backgroundColor: palette.surfaceStrong }]}
        />
      )}

      <View style={[styles.copy, compact && styles.copyCompact]}>
        <Text
          accessibilityRole="header"
          numberOfLines={compact ? 1 : undefined}
          style={[styles.title, compact && styles.titleCompact, { color: palette.text }]}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text
            numberOfLines={compact ? descLines : undefined}
            style={[styles.subtitle, compact && styles.subtitleCompact, { color: palette.textMuted }]}
          >
            {subtitle}
          </Text>
        ) : null}
        {metadata.length > 0 ? (
          <View style={styles.metadata}>
            {metadata.map((item, index) => (
              <React.Fragment key={`${item}:${index}`}>
                {index > 0 ? (
                  <Text style={[styles.separator, { color: palette.textSubtle }]}>·</Text>
                ) : null}
                <Text
                  style={[
                    styles.metadataText,
                    compact && styles.metadataTextCompact,
                    { color: palette.textMuted },
                  ]}
                >
                  {item}
                </Text>
              </React.Fragment>
            ))}
          </View>
        ) : null}
        {actions && !actionsFullBleed ? (
          <View style={[styles.actions, compact && styles.actionsCompact]}>{actions}</View>
        ) : null}
      </View>

      {actions && actionsFullBleed ? (
        <View style={styles.actionsFullBleed}>{actions}</View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    minWidth: 0,
    flexDirection: "row",
    flexWrap: "wrap",
    // 顶部对齐：右侧文字/按钮行数变化时封面不会上下移动（lx 头部固定顶部对齐）
    alignItems: "flex-start",
    gap: spacing.m,
    marginBottom: spacing.l,
  },
  rootCompact: {
    gap: spacing.s,
    marginBottom: spacing.m,
  },
  cover: {
    width: 120,
    height: 120,
    borderRadius: radius.md,
    overflow: "hidden",
  },
  // 对齐 lx：歌单详情封面 scaleSizeW(70)
  coverCompact: {
    width: 72,
    height: 72,
    borderRadius: radius.md,
  },
  // 对齐 lx CountText：封面底部半透明黑条 + 白色播放量
  coverBadge: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    fontSize: 11,
    fontWeight: "500",
    color: "#ffffff",
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderBottomLeftRadius: 6,
    borderBottomRightRadius: 6,
    textAlign: "center",
  },
  copy: {
    flex: 1,
    minWidth: 180,
    gap: spacing.xs,
  },
  copyCompact: {
    gap: 3,
  },
  title: {
    fontSize: typography.display,
    fontWeight: "700",
  },
  titleCompact: {
    fontSize: 16,
    fontWeight: "700",
  },
  subtitle: {
    fontSize: typography.meta,
    lineHeight: 18,
  },
  subtitleCompact: {
    fontSize: 12,
    lineHeight: 16,
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
  metadataTextCompact: {
    fontSize: 11,
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
  actionsCompact: {
    marginTop: 0,
  },
  actionsFullBleed: {
    // 按钮整行铺满内容宽度（root 为 wrap 布局，此行自动换行到封面下方），
    // 左缘与封面左缘对齐，三键 flexGrow 平分整行。
    width: "100%",
    flexDirection: "row",
    flexWrap: "nowrap",
    gap: spacing.xs,
  },
});
