import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  Alert,
  ActivityIndicator,
  ScrollView,
  Linking,
} from "react-native";
import { QrLoginView } from "@/components/QrLoginView";
import { useAccountStore } from "@/stores/accountStore";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { radius, spacing, typography } from "@/theme/tokens";

interface LoginScreenProps {
  onSuccess?: () => void;
}

type LoginMode = "cookie" | "qr";

export function LoginScreen({ onSuccess }: LoginScreenProps) {
  const [cookie, setCookie] = useState("");
  const [mode, setMode] = useState<LoginMode>("cookie");
  const [qrBusy, setQrBusy] = useState(false);
  const login = useAccountStore((state) => state.login);
  const loading = useAccountStore((state) => state.loading);

  const themeMode = useThemeStore((s) => s.mode);
  const systemTheme = useThemeStore((s) => s.systemTheme);
  const accentColor = useThemeStore((s) => s.accentColor);
  const palette = getThemePalette(getResolvedTheme(themeMode, systemTheme), accentColor);

  const loginBusy = loading || qrBusy;

  const styles = StyleSheet.create({
    container: {
      padding: spacing.l,
      paddingBottom: spacing.xl + spacing.m,
    },
    header: {
      marginBottom: spacing.l + spacing.s,
    },
    title: {
      fontSize: typography.displayLg,
      fontWeight: "700",
      color: palette.text,
      marginBottom: spacing.xs,
    },
    subtitle: {
      fontSize: typography.title,
      color: palette.textMuted,
    },
    form: {
      marginBottom: spacing.l + spacing.s,
    },
    segmentedControl: {
      flexDirection: "row",
      backgroundColor: palette.surface,
      borderRadius: radius.md,
      padding: spacing.xxs,
      marginBottom: spacing.l,
    },
    segmentButton: {
      flex: 1,
      minHeight: 44,
      borderRadius: radius.md,
      alignItems: "center",
      justifyContent: "center",
    },
    segmentButtonActive: {
      backgroundColor: palette.primary,
    },
    segmentText: {
      fontSize: typography.body,
      fontWeight: "600",
      color: palette.textMuted,
    },
    segmentTextActive: {
      color: palette.primaryText,
    },
    inputContainer: {
      marginBottom: spacing.m,
    },
    label: {
      fontSize: typography.body,
      fontWeight: "600",
      color: palette.text,
      marginBottom: spacing.xs,
    },
    input: {
      backgroundColor: palette.surface,
      color: palette.text,
      padding: spacing.m,
      borderRadius: radius.md,
      fontSize: typography.body,
      minHeight: 120,
      fontFamily: "monospace",
    },
    helpButton: {
      alignSelf: "flex-start",
      marginBottom: spacing.xl,
    },
    helpText: {
      fontSize: typography.body,
      color: palette.primary,
      textDecorationLine: "underline",
    },
    loginButton: {
      backgroundColor: palette.primary,
      padding: spacing.m,
      borderRadius: radius.md,
      alignItems: "center",
    },
    loginButtonDisabled: {
      opacity: 0.5,
    },
    loginButtonText: {
      fontSize: typography.title,
      fontWeight: "600",
      color: palette.primaryText,
    },
    notice: {
      backgroundColor: palette.dangerSurface,
      padding: spacing.m,
      borderRadius: radius.md,
      borderLeftWidth: 4,
      borderLeftColor: palette.danger,
    },
    noticeTitle: {
      fontSize: typography.body,
      fontWeight: "600",
      color: palette.danger,
      marginBottom: spacing.xs,
    },
    noticeText: {
      fontSize: typography.meta,
      color: palette.textMuted,
      lineHeight: 20,
    },
  });

  const handleLogin = async () => {
    const trimmedCookie = cookie.trim();
    if (!trimmedCookie) {
      Alert.alert("提示", "请输入 Cookie");
      return;
    }

    try {
      await login(trimmedCookie);
      Alert.alert("登录成功", "欢迎回来！", [
        {
          text: "确定",
          onPress: () => onSuccess?.(),
        },
      ]);
    } catch (error) {
      Alert.alert(
        "登录失败",
        error instanceof Error ? error.message : "请检查 Cookie 是否正确"
      );
    }
  };

  const handleQrSuccess = async (qrCookie: string) => {
    try {
      await login(qrCookie);
      Alert.alert("登录成功", "二维码授权完成", [
        {
          text: "确定",
          onPress: () => onSuccess?.(),
        },
      ]);
    } catch (error) {
      Alert.alert("登录失败", error instanceof Error ? error.message : "二维码登录失败");
    }
  };

  const openHelp = () => {
    Alert.alert(
      "如何获取 Cookie？",
      "1. 在电脑浏览器打开 music.163.com\n" +
        "2. 登录你的网易云账号\n" +
        "3. 按 F12 打开开发者工具\n" +
        "4. 切换到 Network（网络）标签\n" +
        "5. 刷新页面\n" +
        "6. 点击任意请求，找到 Request Headers\n" +
        "7. 复制 Cookie 字段的值\n\n" +
        "注意：Cookie 包含登录凭证，请勿泄露给他人",
      [
        { text: "知道了" },
        {
          text: "查看详细教程",
          onPress: () => {
            // 打开详细教程页面
            Linking.openURL("https://github.com/0nini00/auralflow");
          },
        },
      ]
    );
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>网易云音乐登录</Text>
        <Text style={styles.subtitle}>支持 Cookie 与二维码授权</Text>
      </View>

      <View style={styles.segmentedControl}>
        <Pressable
          style={[styles.segmentButton, mode === "cookie" && styles.segmentButtonActive]}
          onPress={() => setMode("cookie")}
        >
          <Text style={[styles.segmentText, mode === "cookie" && styles.segmentTextActive]}>Cookie</Text>
        </Pressable>
        <Pressable
          style={[styles.segmentButton, mode === "qr" && styles.segmentButtonActive]}
          onPress={() => setMode("qr")}
        >
          <Text style={[styles.segmentText, mode === "qr" && styles.segmentTextActive]}>二维码</Text>
        </Pressable>
      </View>

      <View style={styles.form}>
        {mode === "cookie" ? (
          <>
            <View style={styles.inputContainer}>
              <Text style={styles.label}>Cookie</Text>
              <TextInput
                value={cookie}
                onChangeText={setCookie}
                placeholder="粘贴从浏览器复制的 Cookie"
                placeholderTextColor={palette.textMuted}
                style={styles.input}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
              />
            </View>

            <Pressable style={styles.helpButton} onPress={openHelp}>
              <Text style={styles.helpText}>如何获取 Cookie？</Text>
            </Pressable>

            <Pressable
              style={[styles.loginButton, loginBusy && styles.loginButtonDisabled]}
              onPress={handleLogin}
              disabled={loginBusy}
            >
              {loading ? (
                <ActivityIndicator color={palette.primaryText} />
              ) : (
                <Text style={styles.loginButtonText}>登录</Text>
              )}
            </Pressable>
          </>
        ) : (
          <>
            <QrLoginView
              onSuccess={(qrCookie) => void handleQrSuccess(qrCookie)}
              onError={(message) => Alert.alert("二维码登录失败", message)}
              onBusyChange={setQrBusy}
            />
          </>
        )}
      </View>

      <View style={styles.notice}>
        <Text style={styles.noticeTitle}>安全提示</Text>
        <Text style={styles.noticeText}>
          • Cookie 包含你的登录凭证，请勿泄露给他人{"\n"}
          • 本应用仅在本地存储 Cookie，不会上传到任何服务器{"\n"}
          • Cookie 可能会过期，过期后需要重新登录{"\n"}
          • 建议使用小号进行测试
        </Text>
      </View>
    </ScrollView>
  );
}
