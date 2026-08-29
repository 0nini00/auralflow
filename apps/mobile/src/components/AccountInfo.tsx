import React from "react";
import { Pressable, View, Text, StyleSheet } from "react-native";
import { ChevronRight, UserRound } from "lucide-react-native";
import { CachedImage } from "./CachedImage";
import { ListItemButton } from "@/components/ui/ListItemButton";

import { useAccountStore } from "@/stores/accountStore";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { withAlpha } from "@/services/themePaletteModel";
import { radius, spacing, touch, typography } from "@/theme/tokens";

interface AccountInfoProps {
  onLoginPress?: () => void;
  onAccountPress?: () => void;
}

/**
 * 账号状态展示。
 *
 * 与登录入口一致地收敛：账号的登录/退出操作只保留在「设置 → 账号与服务」
 * （NeteaseAccountCard），本组件只负责展示，不提供退出入口，避免同一操作有两个来源。
 */
export function AccountInfo({
  onLoginPress,
  onAccountPress,
}: AccountInfoProps) {
  const isLoggedIn = useAccountStore((state) => state.isLoggedIn);
  const user = useAccountStore((state) => state.user);
  const loading = useAccountStore((state) => state.loading);
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  if (!isLoggedIn || !user) {
    // 收敛方案：登录入口只保留在「设置 → 账号与服务」。
    // 传入 onLoginPress/onAccountPress（设置页）时保持可交互登录卡片；
    // 未传入（我的页顶部）时弱化为纯状态文字，无点击、无跳转。
    const interactive = Boolean(onAccountPress ?? onLoginPress);
    if (!interactive) {
      return (
        <View style={[styles.loginCard, styles.loginCardStatic, { backgroundColor: palette.surface }]}>
          <View style={styles.loginContent}>
            <View
              style={[styles.loginIcon, { backgroundColor: palette.surfaceStrong }]}
              accessible
              accessibilityRole="image"
              accessibilityLabel="网易云账号"
            >
              <UserRound size={24} color={palette.primary} />
            </View>
            <View style={styles.loginTextContainer}>
              <Text style={[styles.loginTitle, { color: palette.text }]}>未登录网易云账号</Text>
              <Text style={[styles.loginSubtitle, { color: palette.textMuted }]}>
                请在「设置 → 账号与服务」中登录
              </Text>
            </View>
          </View>
        </View>
      );
    }
    return (
      <ListItemButton
        title="登录网易云账号"
        subtitle="登录后可同步歌单、收藏等数据"
        leading={<View style={[styles.loginIcon, { backgroundColor: palette.surfaceStrong }]}><UserRound size={24} color={palette.primary} /></View>}
        trailing={<ChevronRight size={24} color={palette.primary} />}
        onPress={onAccountPress ?? onLoginPress}
        accessibilityLabel="登录网易云账号"
        disabled={loading}
        style={[styles.loginCard, { backgroundColor: palette.surface, borderColor: palette.primary }]}
      />
    );
  }

  const showVipBadge = (user.vipType ?? 0) > 0;
  const avatar = user.avatarUrl ? (
    <CachedImage uri={user.avatarUrl} style={styles.avatarImage} />
  ) : (
    <View style={[styles.avatarImage, styles.avatarFallback, { backgroundColor: palette.surfaceStrong }]}>
      <Text style={[styles.avatarFallbackText, { color: palette.primary }]}>{user.nickname.charAt(0)}</Text>
    </View>
  );

  const cardBody = (
    <>
      <View style={[styles.avatarRing, { borderColor: withAlpha(palette.primary, 0.45) }]}>{avatar}</View>
      <View style={styles.accountTextContainer}>
        <View style={styles.accountNameRow}>
          <Text numberOfLines={1} style={[styles.nickname, { color: palette.text }]}>
            {user.nickname}
          </Text>
          {showVipBadge ? (
            <View style={[styles.vipBadge, { backgroundColor: withAlpha("#ff9800", 0.16) }]}>
              <Text style={[styles.vipText, { color: "#f57c00" }]}>VIP</Text>
            </View>
          ) : null}
        </View>
        <Text numberOfLines={1} style={[styles.accountMeta, { color: palette.textMuted }]}>
          {`网易云 · ID ${user.userId}`}
        </Text>
      </View>
      {onAccountPress ? <ChevronRight size={20} color={palette.textSubtle} /> : null}
    </>
  );

  if (onAccountPress) {
    return (
      <Pressable
        onPress={onAccountPress}
        disabled={loading}
        accessibilityRole="button"
        accessibilityLabel={`网易云账号，${user.nickname}，已登录`}
        style={({ pressed }) => [
          styles.accountCard,
          { backgroundColor: palette.surface, opacity: pressed ? 0.82 : 1 },
        ]}
      >
        {cardBody}
      </Pressable>
    );
  }

  return (
    <View
      style={[styles.accountCard, { backgroundColor: palette.surface }]}
      accessibilityLabel={`网易云账号，${user.nickname}，已登录`}
    >
      {cardBody}
    </View>
  );
}

const styles = StyleSheet.create({
  loginCard: {
    minHeight: touch.minTarget,
    borderRadius: radius.md,
    padding: spacing.m,
    borderWidth: 2,
    borderStyle: "dashed",
  },
  // 纯状态文字卡片：去除可点击暗示（虚线边框）
  loginCardStatic: {
    borderWidth: 0,
  },
  loginContent: {
    flexDirection: "row",
    alignItems: "center",
  },
  loginIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
    marginRight: spacing.s,
  },
  loginTextContainer: {
    flex: 1,
  },
  loginTitle: {
    fontSize: typography.title,
    fontWeight: "600",
    marginBottom: spacing.xxs,
  },
  loginSubtitle: {
    fontSize: typography.meta,
  },
  accountCard: {
    borderRadius: radius.md,
    padding: spacing.m,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.m,
  },
  // 头像外圈：强调色描边 + 内衬留白，替代"光秃秃一张圆图"
  avatarRing: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2,
    padding: 2,
  },
  avatarImage: {
    width: 52,
    height: 52,
    borderRadius: 24,
  },
  avatarFallback: {
    justifyContent: "center",
    alignItems: "center",
  },
  avatarFallbackText: {
    fontSize: 20,
    fontWeight: "600",
  },
  accountTextContainer: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xxs,
  },
  accountNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  nickname: {
    fontSize: typography.title,
    fontWeight: "700",
    flexShrink: 1,
  },
  accountMeta: {
    fontSize: typography.meta,
  },
  vipBadge: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  vipText: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  userButton: {
    marginHorizontal: -spacing.s,
  },
});
