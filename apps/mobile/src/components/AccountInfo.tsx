import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { ChevronRight, UserRound } from "lucide-react-native";
import { CachedImage } from "./CachedImage";
import { ListItemButton } from "@/components/ui/ListItemButton";

import { useAccountStore } from "@/stores/accountStore";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
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
                请在 设置 → 账号与服务 登录
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

  return (
        <View style={[styles.accountCard, { backgroundColor: palette.surface }]}>
      <ListItemButton
        title={user.nickname}
        subtitle={`ID: ${user.userId}`}
        leading={user.avatarUrl ? <CachedImage uri={user.avatarUrl} style={styles.avatar} /> : <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: palette.surfaceStrong }]}><Text style={[styles.avatarFallbackText, { color: palette.primary }]}>{user.nickname.charAt(0)}</Text></View>}
        onPress={onAccountPress}
        accessibilityLabel={`网易云账号，${user.nickname}，已登录`}
        disabled={loading}
        style={styles.userButton}
      />
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
  },
  userInfo: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.m,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    marginRight: spacing.s,
  },
  avatarFallback: {
    justifyContent: "center",
    alignItems: "center",
  },
  avatarFallbackText: {
    fontSize: 20,
    fontWeight: "600",
  },
  userDetails: {
    flex: 1,
  },
  nickname: {
    fontSize: typography.heading,
    fontWeight: "600",
    marginBottom: spacing.xxs,
  },
  userId: {
    fontSize: typography.meta,
  },
  vipBadge: {
    backgroundColor: "#ff9800",
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radius.sm,
    alignSelf: "flex-start",
    marginTop: spacing.xxs,
  },
  vipText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#ffffff",
  },
  userButton: {
    marginHorizontal: -spacing.s,
  },
});
