import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Appearance,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { DarkTheme, DefaultTheme, NavigationContainer } from "@react-navigation/native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AppShell } from "@/components/AppShell";
import { CustomSourceUpdateModal } from "@/components/CustomSourceUpdateModal";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { LxBridgeHost } from "@/services/customSourceWebViewBridge";
import { MobilePactModal } from "@/components/MobilePactModal";
import { UpdateModal } from "@/components/UpdateModal";
import { RootNavigator, navigationRef } from "@/navigation";
import { acceptMobilePact, hasAcceptedMobilePact } from "@/services/mobilePactService";
import { useMobileDeepLinks, type ResolvedMobileIntent } from "@/hooks/useMobileDeepLinks";
import { readLocalAudioFile } from "@/services/localMusicService";
import { playQueue } from "@/services/playerService";
import { initPlaybackSnapshotPersistence } from "@/services/playbackSnapshot";
import { autoCleanCache } from "@/services/cacheService";
import { consumeLastJSError } from "@/services/globalErrorCapture";
import { checkForUpdates, type UpdateInfo } from "@/services/updateService";
import { logger } from "@/services/logger";
import { setupPlayerListeners } from "@/stores/playerStore";
import { canRunStartupNetworkTasks } from "@/services/startupPolicy";
import { useAccountStore } from "@/stores/accountStore";
import { useFavoritesStore } from "@/stores/favoritesStore";
import { useDownloadStore } from "@/stores/downloadStore";
import { usePlaybackSettingsStore } from "@/stores/playbackSettingsStore";
import { useCustomSourceStore } from "@/stores/customSourceStore";
import { useHistoryStore } from "@/stores/historyStore";
import { useLocalMusicStore } from "@/stores/localMusicStore";
import { usePlaylistStore } from "@/stores/playlistStore";
import { useLyricOverlayStore } from "@/stores/lyricOverlayStore";
import { useWebdavStore } from "@/stores/webdavStore";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { typography } from "@/theme/tokens";

/**
 * 外部「用其他应用打开」进来的音源脚本：确认后落库，并让用户立刻看到结果。
 *
 * 走 importFromFile 而不是 importScript：Android 给的是 content:// URI，
 * 读取由 RNFS（内部走 ContentResolver）负责，不需要先复制到应用目录。
 */
async function importSourceFromIntent(uri: string): Promise<void> {
  try {
    const item = await useCustomSourceStore.getState().importFromFile(uri);
    if (!item) return;
    if (navigationRef.isReady()) {
      (navigationRef.navigate as (screen: string, params?: unknown) => void)("Settings", {
        screen: "Sources",
      });
    }
    Alert.alert("导入成功", `已导入音源「${item.name}」`);
  } catch (error) {
    Alert.alert("导入失败", error instanceof Error ? error.message : String(error));
  }
}

async function dispatchMobileIntent(intent: ResolvedMobileIntent, isCurrent: () => boolean): Promise<void> {
  const nav = (name: string, params?: unknown) => {
    (navigationRef.navigate as (screen: string, params?: unknown) => void)(name, params);
  };
  switch (intent.type) {
    case "search":
      nav("MainTabs", { screen: "SearchTab", params: { initialKeyword: intent.keyword } });
      break;
    case "homeMode":
      nav(intent.mode === "fm" ? "PersonalFm" : "DailyRecommend");
      break;
    case "searchDetail":
      nav("MainTabs", { screen: "SearchTab", params: { initialDetailRoute: intent.route } });
      break;
    case "playAudio": {
      const song = await readLocalAudioFile(intent.uri);
      if (!isCurrent()) return;
      await playQueue([song], 0);
      if (!isCurrent()) return;
      navigationRef.navigate("Player");
      break;
    }
    case "importSource":
      Alert.alert(
        "导入自定义音源",
        intent.fileName ? `是否导入音源脚本「${intent.fileName}」？` : "是否导入此自定义音源文件？",
        [
          { text: "取消", style: "cancel" },
          { text: "导入", onPress: () => void importSourceFromIntent(intent.uri) },
        ],
      );
      break;
  }
}

export default function App() {
  const [booting, setBooting] = useState(true);
  const [pactAccepted, setPactAccepted] = useState<boolean | null>(null);
  const [acceptingPact, setAcceptingPact] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);
  const [localDataReady, setLocalDataReady] = useState(false);
  const [navigationReady, setNavigationReady] = useState(false);
  useMobileDeepLinks(navigationReady && !booting && !bootError && pactAccepted === true, dispatchMobileIntent);

  const themeMode = useThemeStore((s) => s.mode);
  const systemTheme = useThemeStore((s) => s.systemTheme);
  const setSystemTheme = useThemeStore((s) => s.setSystemTheme);
  const accentColor = useThemeStore((s) => s.accentColor);
  const resolvedTheme = getResolvedTheme(themeMode, systemTheme);
  const palette = useMemo(
    () => getThemePalette(resolvedTheme, accentColor),
    [resolvedTheme, accentColor],
  );
  // React Navigation 自带主题默认固定浅色（背景 rgb(242,242,242)）：不接入自有调色板时，
  // 每个屏幕都会铺导航器白底，深色主题下出现"内容白底、文字看不清"
  const navigationTheme = useMemo(() => {
    const base = resolvedTheme === "dark" ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        background: palette.background,
        card: palette.surface,
        primary: palette.primary,
        text: palette.text,
        border: palette.border,
        notification: palette.danger,
      },
    };
  }, [resolvedTheme, palette]);

  // 系统深色模式切换同步到 store：mode="system" 时跟随系统，
  // 否则 store 里 systemTheme 永远停在启动时的值，切系统主题界面不变。
  useEffect(() => {
    const subscription = Appearance.addChangeListener(({ colorScheme }) => {
      setSystemTheme(colorScheme === "light" ? "light" : "dark");
    });
    return () => subscription.remove();
  }, [setSystemTheme]);

  const loadTheme = useThemeStore((s) => s.loadTheme);
  const loadPlaybackSettings = usePlaybackSettingsStore((s) => s.loadFromStorage);
  const checkAccountStatus = useAccountStore((s) => s.checkStatus);
  const loadDownloads = useDownloadStore((s) => s.loadDownloads);
  const loadCustomSources = useCustomSourceStore((s) => s.loadFromStorage);
  const loadLocalPlaylists = usePlaylistStore((s) => s.loadLocalPlaylists);
  const loadFavorites = useFavoritesStore((s) => s.loadFromStorage);
  const loadHistory = useHistoryStore((s) => s.loadHistory);
  // 本地歌曲扫描结果在 scanMusic 时已持久化：启动时必须读回，
  // 否则每次冷启动本地曲库都是空的、都要重新扫描
  const loadLocalSongs = useLocalMusicStore((s) => s.loadLocalSongs);
  const lyricOverlaySettingsLoaded = useLyricOverlayStore((s) => s.loaded);
  const loadLyricOverlaySettings = useLyricOverlayStore((s) => s.loadFromStorage);
  const syncLyricOverlayVisible = useLyricOverlayStore((s) => s.syncVisibleFromNative);
  const loadWebdavConfig = useWebdavStore((s) => s.loadConfig);
  const webdavLoaded = useWebdavStore((s) => s.loaded);
  const webdavAutoSyncPlaylists = useWebdavStore((s) => s.autoSyncPlaylists);
  const webdavUrl = useWebdavStore((s) => s.url);
  const webdavUsername = useWebdavStore((s) => s.username);
  const webdavPassword = useWebdavStore((s) => s.password);
  const autoSyncPlaylistsOnce = useWebdavStore((s) => s.autoSyncPlaylistsOnce);
  const customSourcesLoaded = useCustomSourceStore((s) => s.loaded);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setBootError(null);
        // 上一次闪退的 JS 异常取证：存在则直接展示在启动屏（点「重试」后正常启动）
        const lastCrash = await consumeLastJSError();
        if (!cancelled && lastCrash) {
          setBootError(lastCrash);
          return;
        }
        setupPlayerListeners();
        initPlaybackSnapshotPersistence();

        // 缓存容量上限已到 2GB：启动时做一次磁盘空间守卫（内部自带阈值判断，
        // 剩余 <500MB 才清理 7 天前文件；磁盘健康时是零开销的 statvfs 调用）
        void autoCleanCache();

        const accepted = await hasAcceptedMobilePact();
        if (cancelled) return;
        setPactAccepted(accepted);

        await Promise.all([
          loadTheme(),
          loadPlaybackSettings(),
          checkAccountStatus(),
          loadCustomSources(),
          loadLyricOverlaySettings(),
          loadWebdavConfig(),
        ]);

        setLocalDataReady(false);
        const backgroundLabels = [
          "本地歌单",
          "本地收藏",
          "播放历史",
          "本地音乐",
          "下载记录",
        ];
        void Promise.allSettled([
          loadLocalPlaylists(),
          loadFavorites(),
          loadHistory(),
          loadLocalSongs(),
          loadDownloads(),
        ]).then((backgroundTasks) => {
          backgroundTasks.forEach((result, index) => {
            if (result.status === "rejected") {
              console.error(`[启动恢复] ${backgroundLabels[index]}加载失败`, result.reason);
            }
          });
          if (!cancelled) {
            setLocalDataReady(backgroundTasks.every((result) => result.status === "fulfilled"));
          }
        });
      } catch (error) {
        if (!cancelled) {
          setBootError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    bootstrapAttempt,
    checkAccountStatus,
    loadCustomSources,
    loadDownloads,
    loadFavorites,
    loadHistory,
    loadLocalPlaylists,
    loadLocalSongs,
    loadLyricOverlaySettings,
    loadPlaybackSettings,
    loadTheme,
    loadWebdavConfig,
  ]);

  useEffect(() => {
    if (!canRunStartupNetworkTasks(pactAccepted) || !webdavLoaded || !localDataReady) return;
    if (!webdavAutoSyncPlaylists || !webdavUrl.trim() || !webdavUsername.trim() || !webdavPassword) return;
    void autoSyncPlaylistsOnce();
  }, [
    autoSyncPlaylistsOnce,
    localDataReady,
    pactAccepted,
    webdavAutoSyncPlaylists,
    webdavLoaded,
    webdavPassword,
    webdavUrl,
    webdavUsername,
  ]);

  useEffect(() => {
    if (!canRunStartupNetworkTasks(pactAccepted)) return;
    void checkForUpdates()
      .then((info) => {
        if (info.hasUpdate) setUpdateInfo(info);
      })
      .catch((error) => {
        logger.error("[启动更新] 检查更新失败", error);
      });
  }, [pactAccepted]);

  useEffect(() => {
    if (!lyricOverlaySettingsLoaded) return;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      void syncLyricOverlayVisible().catch((error: unknown) => {
        console.error("[歌词悬浮窗] 同步可见状态失败", error);
      });
    });
    return () => subscription.remove();
  }, [lyricOverlaySettingsLoaded, syncLyricOverlayVisible]);

  // 协议同意且本地音源加载完成后，延迟检查自定义音源更新，避免阻塞首屏。
  useEffect(() => {
    if (!canRunStartupNetworkTasks(pactAccepted) || !customSourcesLoaded) return;
    const timer = setTimeout(() => {
      void useCustomSourceStore.getState().checkStartupUpdates().catch((error) => {
        logger.error("[自定义音源] 启动更新检查失败", error);
      });
    }, 4500);
    return () => clearTimeout(timer);
  }, [customSourcesLoaded, pactAccepted]);

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

  const showBoot = booting || pactAccepted === null || bootError !== null;

  return (
    <GestureHandlerRootView style={styles.flex}>
      <SafeAreaProvider>
        <ErrorBoundary>
          {/* 自定义音源 WebView 桥：Hermes 不支持 new Function，用户脚本在此隐藏 WebView 内执行；
              常驻单树避免启动屏→主 UI 切换时 WebView 卸载重建丢失已初始化的音源 runtime */}
          <LxBridgeHost />
          {showBoot ? (
            <View style={[styles.boot, { backgroundColor: palette.background }]}>
              {bootError ? (
                <>
                  <Text style={[styles.bootText, { color: palette.text }]}>{bootError}</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="重试启动"
                    onPress={() => {
                      setBootError(null);
                      setPactAccepted(null);
                      setLocalDataReady(false);
                      setBooting(true);
                      setBootstrapAttempt((value) => value + 1);
                    }}
                    style={[styles.retryButton, { backgroundColor: palette.actionFill }]}
                  >
                    <Text style={[styles.retryButtonText, { color: palette.onActionFill }]}>重试</Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <ActivityIndicator color={palette.primary} size="large" />
                  <Text style={[styles.bootText, { color: palette.textMuted }]}>启动中…</Text>
                </>
              )}
            </View>
          ) : (
            <>
              <NavigationContainer ref={navigationRef} theme={navigationTheme} onReady={() => setNavigationReady(true)}>
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
            </>
          )}
        </ErrorBoundary>
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
    textAlign: "center",
    maxWidth: 320,
  },
  retryButton: {
    minHeight: 44,
    borderRadius: 8,
    paddingHorizontal: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  retryButtonText: {
    fontSize: typography.body,
    fontWeight: "700",
  },
});
