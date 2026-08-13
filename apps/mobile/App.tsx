import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Linking,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { NavigationContainer } from "@react-navigation/native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AppShell } from "@/components/AppShell";
import { CustomSourceUpdateModal } from "@/components/CustomSourceUpdateModal";
import { MobilePactModal } from "@/components/MobilePactModal";
import { UpdateModal } from "@/components/UpdateModal";
import { RootNavigator, navigationRef } from "@/navigation";
import { acceptMobilePact, hasAcceptedMobilePact } from "@/services/mobilePactService";
import { parseMobileDeepLink } from "@/services/mobileDeepLinkService";
import { checkForUpdates, type UpdateInfo } from "@/services/updateService";
import { setupPlayerListeners } from "@/stores/playerStore";
import { useCustomSourceStore } from "@/stores/customSourceStore";
import { useApiKeyStore } from "@/stores/apiKeyStore";
import { useHistoryStore } from "@/stores/historyStore";
import { usePlaylistStore } from "@/stores/playlistStore";
import { useLyricOverlayStore } from "@/stores/lyricOverlayStore";
import { useWebdavStore } from "@/stores/webdavStore";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { typography } from "@/theme/tokens";

export default function App() {
  const [booting, setBooting] = useState(true);
  const [pactAccepted, setPactAccepted] = useState<boolean | null>(null);
  const [acceptingPact, setAcceptingPact] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);

  const themeMode = useThemeStore((s) => s.mode);
  const systemTheme = useThemeStore((s) => s.systemTheme);
  const accentColor = useThemeStore((s) => s.accentColor);
  const palette = useMemo(
    () => getThemePalette(getResolvedTheme(themeMode, systemTheme), accentColor),
    [themeMode, systemTheme, accentColor],
  );

  const loadCustomSources = useCustomSourceStore((s) => s.loadFromStorage);
  const loadApiKeys = useApiKeyStore((s) => s.loadFromStorage);
  const loadLocalPlaylists = usePlaylistStore((s) => s.loadLocalPlaylists);
  const loadLikedSongs = usePlaylistStore((s) => s.loadLikedSongsFromStorage);
  const loadHistory = useHistoryStore((s) => s.loadHistory);
  const lyricOverlaySettingsLoaded = useLyricOverlayStore((s) => s.loaded);
  const loadLyricOverlaySettings = useLyricOverlayStore((s) => s.loadFromStorage);
  const syncLyricOverlayVisible = useLyricOverlayStore((s) => s.syncVisibleFromNative);
  const loadWebdavConfig = useWebdavStore((s) => s.loadConfig);
  const autoSyncPlaylistsOnce = useWebdavStore((s) => s.autoSyncPlaylistsOnce);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setupPlayerListeners();
        // 协议状态是纯本地读取：先于数据加载完成，未同意时立即弹窗，
        // 不让用户等本地数据加载完才看到协议。
        // 读取失败按“已同意”兜底，且绝不能因此跳过下面的数据加载。
        const accepted = await hasAcceptedMobilePact().catch(() => true);
        if (!cancelled) setPactAccepted(accepted);
        await Promise.all([
          loadCustomSources(),
          loadApiKeys(),
          loadLocalPlaylists(),
          loadLikedSongs(),
          loadHistory(),
          loadLyricOverlaySettings(),
          loadWebdavConfig(),
        ]);
        const webdav = useWebdavStore.getState();
        // 未同意协议前不发起 WebDAV 网络同步
        if (
          accepted &&
          webdav.autoSyncPlaylists &&
          webdav.url.trim() &&
          webdav.username.trim() &&
          webdav.password
        ) {
          void autoSyncPlaylistsOnce();
        }
      } catch (error) {
        if (!cancelled) setPactAccepted(true);
      } finally {
        if (!cancelled) setBooting(false);
      }

      try {
        const info = await checkForUpdates();
        if (!cancelled && info.hasUpdate) setUpdateInfo(info);
      } catch {
        // 忽略更新检查失败
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    autoSyncPlaylistsOnce,
    loadApiKeys,
    loadCustomSources,
    loadHistory,
    loadLikedSongs,
    loadLocalPlaylists,
    loadLyricOverlaySettings,
    loadWebdavConfig,
  ]);

  useEffect(() => {
    if (!lyricOverlaySettingsLoaded) return;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      void syncLyricOverlayVisible().catch((error: unknown) => {
      });
    });
    return () => subscription.remove();
  }, [lyricOverlaySettingsLoaded, syncLyricOverlayVisible]);

  // Deep links: auralflow://search|daily|fm|playlist|album|artist
  useEffect(() => {
    const handleUrl = (rawUrl: string | null) => {
      if (!rawUrl) return;
      const intent = parseMobileDeepLink(rawUrl);
      if (!intent) return;

      const nav = (name: string, params?: any) => {
        (navigationRef as any).navigate(name, params);
      };
      const go = () => {
        if (!navigationRef.isReady()) {
          setTimeout(go, 80);
          return;
        }
        switch (intent.type) {
          case "search":
            nav("Main", {
              screen: "MainTabs",
              params: {
                screen: "SearchTab",
                params: { initialKeyword: intent.keyword },
              },
            });
            break;
          case "homeMode":
            if (intent.mode === "fm") {
              nav("PersonalFm");
            } else {
              nav("DailyRecommend");
            }
            break;
          case "searchDetail":
            nav("Main", {
              screen: "MainTabs",
              params: {
                screen: "SearchTab",
                params: { initialDetailRoute: intent.route },
              },
            });
            break;
        }
      };
      go();
    };

    void Linking.getInitialURL().then(handleUrl).catch(() => undefined);
    const sub = Linking.addEventListener("url", (event) => handleUrl(event.url));
    return () => sub.remove();
  }, []);

  const handleAcceptPact = async () => {
    if (acceptingPact) return;
    setAcceptingPact(true);
    try {
      await acceptMobilePact();
      setPactAccepted(true);
    } catch (error) {
      Alert.alert("保存失败", error instanceof Error ? error.message : String(error));
    } finally {
      setAcceptingPact(false);
    }
  };

  if (booting || pactAccepted === null) {
    return (
      <GestureHandlerRootView style={styles.flex}>
        <SafeAreaProvider>
          <View style={[styles.boot, { backgroundColor: palette.background }]}>
            <ActivityIndicator color={palette.primary} size="large" />
            <Text style={[styles.bootText, { color: palette.textMuted }]}>启动中…</Text>
          </View>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={styles.flex}>
      <SafeAreaProvider>
        <NavigationContainer ref={navigationRef}>
          <AppShell>
            <RootNavigator />
          </AppShell>
        </NavigationContainer>

        {updateInfo ? (
          <UpdateModal
            visible={!!updateInfo}
            info={updateInfo}
            onClose={() => setUpdateInfo(null)}
          />
        ) : null}
        <CustomSourceUpdateModal />
        <MobilePactModal
          visible={pactAccepted === false}
          accepting={acceptingPact}
          onAccept={() => {
            void handleAcceptPact();
          }}
        />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  boot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  bootText: {
    fontSize: typography.meta,
  },
});
