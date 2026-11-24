import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/Button";
import { showToast } from "@/components/ui/Toast";
import { readNeteaseWebLoginCookie } from "@/services/webLoginService";
import { useAccountStore } from "@/stores/accountStore";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { layout, spacing, typography } from "@/theme/tokens";

interface NeteaseWebLoginModalProps {
  visible: boolean;
  onClose: () => void;
  onUseCookieLogin: () => void;
}

const LOGIN_URL = "https://music.163.com/#/login";

/** 应用内网易云网页登录：登录成功后由原生读取 Cookie 并验证保存。 */
export function NeteaseWebLoginModal({ visible, onClose, onUseCookieLogin }: NeteaseWebLoginModalProps) {
  const insets = useSafeAreaInsets();
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);
  const login = useAccountStore((state) => state.login);
  const [status, setStatus] = useState<"waiting" | "validating" | "error">("waiting");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const checkingRef = useRef(false);
  const attemptedCookieRef = useRef<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setStatus("waiting");
    setErrorMessage(null);
    attemptedCookieRef.current = null;
  }, [visible]);

  const checkCookie = useCallback(async () => {
    if (!visible || checkingRef.current) return;
    checkingRef.current = true;
    try {
      const cookie = await readNeteaseWebLoginCookie();
      if (!cookie || attemptedCookieRef.current === cookie) return;
      attemptedCookieRef.current = cookie;
      setStatus("validating");
      await login(cookie);
      const user = useAccountStore.getState().user;
      showToast(user ? `已登录网易云账号：${user.nickname}` : "已登录网易云账号");
      onClose();
    } catch (error) {
      // 页面可能刚种下 Cookie、账号态还没就绪；保持等待，稍后允许同一 Cookie 重试。
      setStatus("waiting");
      const failedCookie = attemptedCookieRef.current;
      setTimeout(() => {
        if (attemptedCookieRef.current === failedCookie) attemptedCookieRef.current = null;
      }, 4000);
      if (error instanceof Error && /模块不可用/.test(error.message)) {
        setStatus("error");
        setErrorMessage(error.message);
      }
    } finally {
      checkingRef.current = false;
    }
  }, [visible, login, onClose]);

  useEffect(() => {
    if (!visible) return;
    const timer = setInterval(() => { void checkCookie(); }, 1500);
    return () => clearInterval(timer);
  }, [visible, checkCookie]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.root, { backgroundColor: palette.background, paddingTop: insets.top }]}>
        <PageHeader title="登录网易云账号" canGoBack onGoBack={onClose} />
        <View style={styles.web}>
          <WebView
            source={{ uri: LOGIN_URL }}
            style={styles.web}
            javaScriptEnabled
            domStorageEnabled
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            setSupportMultipleWindows={false}
            originWhitelist={["http://*", "https://*"]}
            onLoadEnd={() => { void checkCookie(); }}
            onError={(event) => {
              setStatus("error");
              setErrorMessage(event.nativeEvent.description || "网页加载失败");
            }}
            onShouldStartLoadWithRequest={(request) =>
              request.url.startsWith("http://") || request.url.startsWith("https://")
            }
            startInLoadingState
            renderLoading={() => (
              <View style={styles.loading}>
                <ActivityIndicator color={palette.primaryInk} />
              </View>
            )}
          />
        </View>
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.m), borderTopColor: palette.border }]}>
          <Text style={[styles.status, { color: status === "error" ? palette.danger : palette.textMuted }]}>
            {status === "validating"
              ? "已检测到登录信息，正在验证…"
              : status === "error"
                ? errorMessage || "网页登录失败，可以改用 Cookie 登录"
                : "请在网页中完成登录，成功后会自动返回"}
          </Text>
          <Button
            label="改用 Cookie 登录"
            variant="secondary"
            accessibilityLabel="改用 Cookie 登录"
            onPress={() => { onClose(); onUseCookieLogin(); }}
            style={styles.cookieButton}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  web: {
    flex: 1,
  },
  loading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  footer: {
    gap: spacing.xs,
    paddingHorizontal: layout.pagePadding,
    paddingTop: spacing.s,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  status: {
    fontSize: typography.caption,
    lineHeight: 18,
  },
  cookieButton: {
    alignSelf: "stretch",
  },
});
