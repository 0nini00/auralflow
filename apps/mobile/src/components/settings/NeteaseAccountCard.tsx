import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Clipboard, StyleSheet, Text, TextInput, View } from "react-native";
import { Headphones } from "lucide-react-native";

import { CachedImage } from "@/components/CachedImage";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { Button } from "@/components/ui/Button";
import { useAccountStore } from "@/stores/accountStore";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { radius, spacing, touch, typography } from "@/theme/tokens";

/**
 * 网易云账号卡片（对齐 BiliAccountCard 交互）：
 * 点「登录」展开内嵌 Cookie 表单，验证成功后收起；
 * 进入页面时刷新登录状态，与 B站卡片行为一致。
 */
export function NeteaseAccountCard() {
  const user = useAccountStore((state) => state.user);
  const loading = useAccountStore((state) => state.loading);
  const error = useAccountStore((state) => state.error);
  const checkStatus = useAccountStore((state) => state.checkStatus);
  const logout = useAccountStore((state) => state.logout);
  const login = useAccountStore((state) => state.login);
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);
  const [editing, setEditing] = useState(false);
  const [cookie, setCookie] = useState("");
  /** false=摘要掩码（默认），true=显示原文；粘贴后仍能点「验证并登录」，无需看原文 */
  const [showRawCookie, setShowRawCookie] = useState(false);

  // Cookie 动辄数千字符，明文展开又长又乱：默认只显示掩码摘要行，
  // 「从剪贴板读取」一键自动填入免长按粘贴，「查看原文」按需切换。
  const handlePasteFromClipboard = async () => {
    try {
      const text = (await Clipboard.getString()).trim();
      if (!text) {
        Alert.alert("提示", "剪贴板为空，请先复制网易云 Cookie");
        return;
      }
      setCookie(text);
      setShowRawCookie(false);
    } catch {
      Alert.alert("提示", "读取剪贴板失败，请点「查看原文」后长按手动粘贴");
    }
  };

  // 进入页面只查一次：若把 loading 放进依赖，checkStatus 完成时置 loading=false 会再次
  // 触发本 effect → 无限循环，右侧按钮被无限转圈占住，「登录」键永不出现。
  // 对齐 BiliAccountCard 的「查一次」守卫模式（它用 loaded 标志，这里用 ref 防重入）。
  const checkedRef = useRef(false);

  useEffect(() => {
    if (checkedRef.current) return;
    checkedRef.current = true;
    void checkStatus().catch(() => undefined);
  }, [checkStatus]);

  const handleLogin = async () => {
    const value = cookie.trim();
    if (!value) {
      Alert.alert("提示", "请先粘贴网易云 Cookie");
      return;
    }
    try {
      await login(value);
      const loginUser = useAccountStore.getState().user;
      setCookie("");
      setEditing(false);
      Alert.alert("登录成功", loginUser ? `已登录网易云账号：${loginUser.nickname}` : "已登录网易云账号");
    } catch (loginError) {
      Alert.alert("登录失败", loginError instanceof Error ? loginError.message : String(loginError));
    }
  };

  const handleLogout = () => {
    Alert.alert("退出网易云账号", "确定要退出当前账号吗？", [
      { text: "取消", style: "cancel" },
      {
        text: "退出账号",
        style: "destructive",
        onPress: async () => {
          try {
            await logout();
          } catch (logoutError) {
            Alert.alert(
              "退出账号失败",
              logoutError instanceof Error ? logoutError.message : "无法清除本地账号信息",
            );
          }
        },
      },
    ]);
  };

  const subtitle = user?.nickname ?? (error ?? "未登录");
  const showVip = Boolean(user?.vipType && user.vipType > 0);

  return (
    <SettingsCard style={styles.card}>
      <View style={styles.header}>
        {user?.avatarUrl ? (
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
            <Headphones size={20} color={palette.primary} />
          </View>
        )}
        <View style={styles.copy}>
          <View style={styles.titleRow}>
            <Text style={[styles.title, { color: palette.text }]}>网易云账号</Text>
            {showVip && (
              <View style={styles.vipBadge}>
                <Text style={styles.vipText}>VIP</Text>
              </View>
            )}
          </View>
          <Text
            numberOfLines={1}
            style={[styles.subtitle, { color: error && !user ? palette.danger : palette.textMuted }]}
          >
            {subtitle}
          </Text>
        </View>
        {loading ? (
          <ActivityIndicator color={palette.primary} />
        ) : user ? (
          <Button
            label="退出"
            variant="danger"
            size="small"
            accessibilityLabel="退出网易云账号"
            disabled={loading}
            onPress={handleLogout}
          />
        ) : (
          <Button
            label="登录"
            size="small"
            accessibilityLabel={editing ? "收起网易云账号登录" : "登录网易云账号"}
            disabled={loading}
            onPress={() => setEditing((value) => !value)}
          />
        )}
      </View>
      {editing && !user ? (
        <View style={styles.form}>
          {showRawCookie ? (
            <TextInput
              accessibilityLabel="网易云 Cookie"
              accessibilityState={{ disabled: loading }}
              editable={!loading}
              value={cookie}
              onChangeText={setCookie}
              placeholder="粘贴网易云 Cookie"
              placeholderTextColor={palette.textMuted}
              multiline
              textAlignVertical="top"
              style={[
                styles.input,
                { color: palette.text, borderColor: palette.border, backgroundColor: palette.surfaceMuted },
              ]}
            />
          ) : (
            <View
              style={[styles.summary, { borderColor: palette.border, backgroundColor: palette.surfaceMuted }]}
            >
              <Text
                numberOfLines={2}
                style={[styles.summaryText, { color: cookie ? palette.text : palette.textMuted }]}
              >
                {cookie
                  ? `已填入 Cookie（${cookie.length} 字符，含 MUSIC_U：${/MUSIC_U=/.test(cookie) ? "是" : "否"}）`
                  : "尚未填入 Cookie：点「从剪贴板读取」自动填入，或「查看原文」后手动粘贴"}
              </Text>
            </View>
          )}
          <View style={styles.formActions}>
            <Button
              label="从剪贴板读取"
              size="small"
              accessibilityLabel="从剪贴板读取网易云 Cookie"
              disabled={loading}
              onPress={() => void handlePasteFromClipboard()}
            />
            <Button
              label={showRawCookie ? "隐藏原文" : "查看原文"}
              size="small"
              accessibilityLabel={showRawCookie ? "隐藏 Cookie 原文" : "查看 Cookie 原文"}
              disabled={loading}
              onPress={() => setShowRawCookie((value) => !value)}
            />
          </View>
          <Button
            label="验证并登录"
            loading={loading}
            accessibilityLabel="验证并登录网易云账号"
            onPress={() => void handleLogin()}
            style={styles.submit}
          />
        </View>
      ) : null}
    </SettingsCard>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.s,
  },
  header: {
    minHeight: touch.minTarget,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  avatarFallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  avatarFallbackText: {
    fontSize: 16,
    fontWeight: "600",
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xxs,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  title: {
    fontSize: typography.body,
    fontWeight: "600",
  },
  vipBadge: {
    backgroundColor: "#ff9800",
    paddingHorizontal: spacing.xs,
    paddingVertical: 1,
    borderRadius: radius.sm,
  },
  vipText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#ffffff",
  },
  subtitle: {
    fontSize: typography.caption,
  },
  form: {
    gap: spacing.xs,
  },
  formActions: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  summary: {
    minHeight: 52,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    padding: spacing.s,
    justifyContent: "center",
  },
  summaryText: {
    fontSize: typography.meta,
    lineHeight: 18,
  },
  input: {
    minHeight: 96,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    padding: spacing.s,
    fontSize: typography.body,
  },
  submit: {
    alignSelf: "stretch",
  },
});
