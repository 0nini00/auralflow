import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import { useHistoryStore } from "@/stores/historyStore";
import { useCustomSourceStore } from "@/stores/customSourceStore";
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

  const loadHistory = useHistoryStore((s) => s.loadHistory);
  const loadCustomSources = useCustomSourceStore((s) => s.loadFromStorage);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setupPlayerListeners();
        await loadHistory();
        await loadCustomSources();
        const accepted = await hasAcceptedMobilePact();
        if (!cancelled) setPactAccepted(accepted);
      } catch (error) {
        console.warn("[App] bootstrap failed", error);
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
  }, [loadCustomSources, loadHistory]);


  // Deep links: auralflow://search|daily|fm|playlist|album|artist
  useEffect(() => {
    const handleUrl = (rawUrl: string | null) => {
      if (!rawUrl) return;
      const intent = parseMobileDeepLink(rawUrl);
      if (!intent) return;

      const go = () => {
        if (!navigationRef.isReady()) {
          setTimeout(go, 80);
          return;
        }
        switch (intent.type) {
          case "search":
            navigationRef.navigate("Main", {
              screen: "Search",
              params: { initialKeyword: intent.keyword },
            });
            break;
          case "homeMode":
            navigationRef.navigate("Main", {
              screen: intent.mode === "fm" ? "FM" : "Daily",
            });
            break;
          case "searchDetail":
            navigationRef.navigate("Main", {
              screen: "Search",
              params: { initialDetailRoute: intent.route },
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
