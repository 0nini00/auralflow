import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { SettingsCard } from "@/components/settings/SettingsCard";
import { saveBiliCookie } from "@/services/biliService";
import { useBiliAccountStore } from "@/stores/biliAccountStore";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { radius, spacing, touch, typography } from "@/theme/tokens";

export function BiliAccountCard() {
  const account = useBiliAccountStore((state) => state.account);
  const loaded = useBiliAccountStore((state) => state.isLoaded);
  const loading = useBiliAccountStore((state) => state.isLoading);
  const error = useBiliAccountStore((state) => state.error);
  const load = useBiliAccountStore((state) => state.load);
  const logout = useBiliAccountStore((state) => state.logout);
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);
  const [editing, setEditing] = useState(false);
  const [cookie, setCookie] = useState("");

  useEffect(() => {
    if (!loaded) void load();
  }, [load, loaded]);

  const handleLogin = async () => {
    const value = cookie.trim();
    if (!value) {
      Alert.alert("提示", "请先粘贴 B站 Cookie");
      return;
    }
    try {
      await saveBiliCookie(value);
      await load(value);
      const latest = useBiliAccountStore.getState();
      if (!latest.account) throw new Error(latest.error || "B站 Cookie 验证失败");
      setCookie("");
      setEditing(false);
      Alert.alert("登录成功", `已登录 B站账号：${latest.account.nickname}`);
    } catch (loginError) {
      Alert.alert("B站登录失败", loginError instanceof Error ? loginError.message : String(loginError));
    }
  };

  const handleLogout = () => {
    Alert.alert("退出 B站账号", "确定要退出当前 B站账号吗？", [
      { text: "取消", style: "cancel" },
      {
        text: "退出 B站账号",
        style: "destructive",
        onPress: async () => {
          try {
            await logout();
            Alert.alert("已退出", "已退出 B站账号");
          } catch (logoutError) {
            Alert.alert(
              "退出 B站账号失败",
              logoutError instanceof Error ? logoutError.message : "无法清除本地 B站账号信息",
            );
          }
        },
      },
    ]);
  };

  return (
    <SettingsCard style={styles.card}>
      <View style={styles.header}>
        <View style={styles.copy}>
          <Text style={[styles.title, { color: palette.text }]}>B站账号</Text>
          <Text style={[styles.subtitle, { color: error ? palette.danger : palette.textMuted }]}>
            {account?.nickname ?? error ?? "未登录"}
          </Text>
        </View>
        {loading ? (
          <ActivityIndicator color={palette.primary} />
        ) : account ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="退出 B站账号"
            accessibilityState={{ disabled: loading, busy: loading }}
            disabled={loading}
            onPress={handleLogout}
            style={[styles.button, { backgroundColor: palette.dangerSurface }]}
          >
            <Text style={[styles.buttonText, { color: palette.danger }]}>退出</Text>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={editing ? "收起 B站账号登录" : "登录 B站账号"}
            accessibilityState={{ expanded: editing, disabled: loading, busy: loading }}
            disabled={loading}
            onPress={() => setEditing((value) => !value)}
            style={[styles.button, { backgroundColor: palette.primary }]}
          >
            <Text style={[styles.buttonText, { color: palette.primaryText }]}>登录</Text>
          </Pressable>
        )}
      </View>
      {editing && !account ? (
        <View style={styles.form}>
          <TextInput
            accessibilityLabel="B站 Cookie"
            accessibilityState={{ disabled: loading }}
            editable={!loading}
            value={cookie}
            onChangeText={setCookie}
            placeholder="粘贴 B站 Cookie"
            placeholderTextColor={palette.textMuted}
            multiline
            textAlignVertical="top"
            style={[
              styles.input,
              { color: palette.text, borderColor: palette.border, backgroundColor: palette.surfaceMuted },
            ]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="验证并登录 B站账号"
            accessibilityState={{ disabled: loading, busy: loading }}
            disabled={loading}
            onPress={() => void handleLogin()}
            style={[styles.submit, { backgroundColor: palette.primary }]}
          >
            <Text style={[styles.buttonText, { color: palette.primaryText }]}>验证并登录</Text>
          </Pressable>
        </View>
      ) : null}
    </SettingsCard>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.s,
  },
  header: { minHeight: touch.minTarget, flexDirection: "row", alignItems: "center", gap: spacing.s },
  copy: { flex: 1, minWidth: 0, gap: spacing.xxs },
  title: { fontSize: typography.body, fontWeight: "600" },
  subtitle: { fontSize: typography.caption },
  button: {
    minWidth: 64,
    minHeight: touch.minTarget,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.s,
  },
  buttonText: { fontSize: typography.meta, fontWeight: "700" },
  form: { gap: spacing.xs },
  input: {
    minHeight: 96,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    padding: spacing.s,
    fontSize: typography.body,
  },
  submit: {
    minHeight: touch.minTarget,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
});
