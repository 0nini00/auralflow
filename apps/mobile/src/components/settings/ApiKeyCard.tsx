import React, { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { KeyRound } from "lucide-react-native";

import { SettingsCard } from "@/components/settings/SettingsCard";
import { useApiKeyStore } from "@/stores/apiKeyStore";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { withAlpha } from "@/services/themePaletteModel";
import { fetchWithTimeout } from "@/utils/fetchWithTimeout";
import { radius, spacing, typography } from "@/theme/tokens";

type TestStatus = "idle" | "testing" | "ok" | "failed";

/**
 * 内置音乐 API Key 输入卡片。
 *
 * ChKSz 网关（api.chksz.com）需要 apikey 鉴权；保存在本地，惰性注入竞速网关，
 * 保存后立即生效，无需重启。未配置时 App 自动跳过该网关，不影响旧网关（gdstudio）。
 */
export function ApiKeyCard() {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  const chkszApiKey = useApiKeyStore((state) => state.chkszApiKey);
  const setChkszApiKey = useApiKeyStore((state) => state.setChkszApiKey);

  const [draft, setDraft] = useState(chkszApiKey);
  const [status, setStatus] = useState<TestStatus>("idle");
  const [message, setMessage] = useState("");

  const save = async () => {
    setStatus("idle");
    await setChkszApiKey(draft);
  };

  const testKey = async () => {
    const key = draft.trim();
    if (!key) {
      setStatus("failed");
      setMessage("请先填写 API Key");
      return;
    }
    setStatus("testing");
    setMessage("");
    try {
      const url = `https://api.chksz.com/api/163_search?keyword=晴天&limit=1&apikey=${encodeURIComponent(key)}`;
      const response = await fetchWithTimeout(url, undefined, 10_000);
      const text = await response.text();
      let json: any = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
      if (json?.code != null && json.code !== 200) {
        setStatus("failed");
        setMessage(`接口返回错误 ${json.code}：${json.msg ?? "请检查 Key 是否正确"}`);
        return;
      }
      if (Array.isArray(json?.data) && json.data.length > 0) {
        setStatus("ok");
        setMessage("验证通过，网关已生效");
      } else {
        setStatus("failed");
        setMessage("接口未返回数据，请稍后重试");
      }
    } catch (error) {
      setStatus("failed");
      setMessage(error instanceof Error ? `连接失败：${error.message}` : "连接失败");
    }
  };

  return (
    <SettingsCard style={styles.card}>
      <View style={styles.header}>
        <KeyRound size={18} color={palette.primary} />
        <View style={styles.headerCopy}>
          <Text style={[styles.title, { color: palette.text }]}>内置音乐 API Key</Text>
          <Text style={[styles.subtitle, { color: palette.textMuted }]}>
            这是 ChKSz 音乐 API（api.chksz.com）的个人密钥，登录网站后点击「查看密钥」获取；
            与内置网关并发竞速用于播放与下载，谁快用谁；未配置自动跳过
          </Text>
        </View>
      </View>

      <TextInput
        value={draft}
        onChangeText={(value) => {
          setDraft(value);
          setStatus("idle");
          setMessage("");
        }}
        placeholder="粘贴 ChKSz apikey…"
        placeholderTextColor={palette.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        style={[
          styles.input,
          { backgroundColor: palette.background, borderColor: palette.border, color: palette.text },
        ]}
      />

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            void save();
          }}
          style={({ pressed }) => [
            styles.button,
            styles.saveButton,
            {
              backgroundColor: pressed ? withAlpha(palette.primary, 0.85) : palette.primary,
            },
          ]}
        >
          <Text style={[styles.buttonText, { color: palette.primaryText }]}>保存</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            void testKey();
          }}
          disabled={status === "testing"}
          style={({ pressed }) => [
            styles.button,
            styles.testButton,
            {
              backgroundColor: pressed ? palette.border : palette.surface,
              borderColor: palette.border,
            },
          ]}
        >
          {status === "testing" ? (
            <ActivityIndicator size="small" color={palette.primary} />
          ) : (
            <Text style={[styles.buttonText, { color: palette.text }]}>测试</Text>
          )}
        </Pressable>
      </View>

      {status !== "idle" ? (
        <Text
          style={[
            styles.message,
            { color: status === "ok" ? palette.primary : palette.danger },
          ]}
        >
          {message}
        </Text>
      ) : null}
    </SettingsCard>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.s,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.xs,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xxs,
  },
  title: {
    fontSize: typography.body,
    fontWeight: "600",
  },
  subtitle: {
    fontSize: typography.caption,
    lineHeight: 17,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.s,
    paddingVertical: spacing.s,
    fontSize: typography.body,
    minHeight: 46,
  },
  actions: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  button: {
    minHeight: 38,
    paddingHorizontal: spacing.m,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  saveButton: {
    flex: 1,
  },
  testButton: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
  },
  buttonText: {
    fontSize: typography.body,
    fontWeight: "600",
  },
  message: {
    fontSize: typography.caption,
  },
});
