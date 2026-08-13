import React from "react";
import { View, Text, StyleSheet, Pressable, Alert } from "react-native";
import { ChevronRight, UserRound } from "lucide-react-native";
import { CachedImage } from "./CachedImage";
import { useAccountStore } from "@/stores/accountStore";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { radius, spacing, touch, typography } from "@/theme/tokens";

interface AccountInfoProps {
  onLoginPress?: () => void;
  onAccountPress?: () => void;
  showLogoutAction?: boolean;
}

export function AccountInfo({
  onLoginPress,
  onAccountPress,
  showLogoutAction = true,
}: AccountInfoProps) {
  const isLoggedIn = useAccountStore((state) => state.isLoggedIn);
  const user = useAccountStore((state) => state.user);
  const logout = useAccountStore((state) => state.logout);
  const loading = useAccountStore((state) => state.loading);
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  const handleLogout = () => {
    Alert.alert(
      "退出登录",
      "确定要退出当前账号吗？",
      [
        { text: "取消", style: "cancel" },
        {
          text: "退出账号",
          style: "destructive",
          onPress: async () => {
            try {
              await logout();
              Alert.alert("已退出", "已退出当前账号");
            } catch (logoutError) {
              Alert.alert(
                "退出账号失败",
                logoutError instanceof Error ? logoutError.message : "无法清除本地账号信息",
              );
            }
          },
        },
      ]
    );
  };

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
      <Pressable
        style={[styles.loginCard, { backgroundColor: palette.surface, borderColor: palette.primary }]}
        onPress={onAccountPress ?? onLoginPress}
        accessibilityRole="button"
        accessibilityLabel="登录网易云账号"
        accessibilityHint={onAccountPress ? "打开账号设置" : "打开登录页面"}
        accessibilityState={{ disabled: loading, busy: loading }}
        disabled={loading}
      >
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
            <Text style={[styles.loginTitle, { color: palette.text }]}>登录网易云账号</Text>
            <Text style={[styles.loginSubtitle, { color: palette.textMuted }]}>
              登录后可同步歌单、收藏等数据
            </Text>
          </View>
          <ChevronRight size={24} color={palette.primary} />
        </View>
      </Pressable>
    );
  }

  return (
    <View style={[styles.accountCard, { backgroundColor: palette.surface }]}>
      <Pressable
        onPress={onAccountPress}
        accessibilityRole={onAccountPress ? "button" : "summary"}
        accessibilityLabel={`网易云账号，${user.nickname}，已登录`}
        accessibilityHint={onAccountPress ? "打开账号设置" : undefined}
        accessibilityState={{ disabled: loading, busy: loading }}
        disabled={loading}
      >
        <View style={styles.userInfo}>
          {user.avatarUrl ? (
            <CachedImage
            uri={user.avatarUrl}
            style={styles.avatar}
            fallback={
              <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: palette.surfaceStrong }]}>
                <Text style={[styles.avatarFallbackText, { color: palette.primary }]}>
                  {user.nickname.charAt(0)}
                </Text>
              </View>
            }
            />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: palette.surfaceStrong }]}>
            <Text style={[styles.avatarFallbackText, { color: palette.primary }]}>
              {user.nickname.charAt(0)}
            </Text>
            </View>
          )}

          <View style={styles.userDetails}>
          <Text style={[styles.nickname, { color: palette.text }]}>{user.nickname}</Text>
          <Text style={[styles.userId, { color: palette.textMuted }]}>ID: {user.userId}</Text>
          {user.vipType && user.vipType > 0 && (
            <View style={styles.vipBadge}>
              <Text style={styles.vipText}>VIP</Text>
            </View>
          )}
          </View>
        </View>
      </Pressable>

      {showLogoutAction && (
        <Pressable
          style={[styles.logoutButton, { backgroundColor: palette.dangerSurface }]}
          onPress={handleLogout}
          accessibilityRole="button"
          accessibilityLabel="退出网易云账号"
          accessibilityState={{ disabled: loading, busy: loading }}
          disabled={loading}
        >
          <Text style={[styles.logoutButtonText, { color: palette.danger }]}>退出账号</Text>
        </Pressable>
      )}
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
  logoutButton: {
    minHeight: touch.minTarget,
    paddingHorizontal: spacing.s,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  logoutButtonText: {
    fontSize: typography.body,
    fontWeight: "600",
  },
});
