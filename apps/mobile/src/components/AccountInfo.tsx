import React from "react";
import { View, Text, StyleSheet, Pressable, Alert } from "react-native";
import { ChevronRight, UserRound } from "lucide-react-native";
import { CachedImage } from "./CachedImage";
import { useAccountStore } from "@/stores/accountStore";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";

interface AccountInfoProps {
  onLoginPress?: () => void;
}

export function AccountInfo({ onLoginPress }: AccountInfoProps) {
  const isLoggedIn = useAccountStore((state) => state.isLoggedIn);
  const user = useAccountStore((state) => state.user);
  const logout = useAccountStore((state) => state.logout);
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
          text: "确定",
          style: "destructive",
          onPress: async () => {
            await logout();
            Alert.alert("已退出", "已退出当前账号");
          },
        },
      ]
    );
  };

  if (!isLoggedIn || !user) {
    return (
      <Pressable
        style={[styles.loginCard, { backgroundColor: palette.surface, borderColor: palette.primary }]}
        onPress={onLoginPress}
        accessibilityRole="button"
        accessibilityLabel="登录网易云账号"
      >
        <View style={styles.loginContent}>
          <View style={[styles.loginIcon, { backgroundColor: palette.surfaceStrong }]}>
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

      <Pressable style={[styles.logoutButton, { backgroundColor: palette.dangerSurface }]} onPress={handleLogout}>
        <Text style={[styles.logoutButtonText, { color: palette.danger }]}>退出登录</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  loginCard: {
    backgroundColor: "#1a3a31",
    borderRadius: 12,
    padding: 16,
    borderWidth: 2,
    borderColor: "#45e58d",
    borderStyle: "dashed",
  },
  loginContent: {
    flexDirection: "row",
    alignItems: "center",
  },
  loginIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#2a4a41",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  loginTextContainer: {
    flex: 1,
  },
  loginTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#ffffff",
    marginBottom: 4,
  },
  loginSubtitle: {
    fontSize: 13,
    color: "#8fa79f",
  },
  accountCard: {
    backgroundColor: "#1a3a31",
    borderRadius: 12,
    padding: 16,
  },
  userInfo: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    marginRight: 12,
  },
  avatarFallback: {
    backgroundColor: "#2a4a41",
    justifyContent: "center",
    alignItems: "center",
  },
  avatarFallbackText: {
    fontSize: 20,
    fontWeight: "600",
    color: "#45e58d",
  },
  userDetails: {
    flex: 1,
  },
  nickname: {
    fontSize: 18,
    fontWeight: "600",
    color: "#ffffff",
    marginBottom: 4,
  },
  userId: {
    fontSize: 13,
    color: "#8fa79f",
  },
  vipBadge: {
    backgroundColor: "#ff9800",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    alignSelf: "flex-start",
    marginTop: 4,
  },
  vipText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#ffffff",
  },
  logoutButton: {
    backgroundColor: "#3a1a1a",
    padding: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  logoutButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#ff6b6b",
  },
});
