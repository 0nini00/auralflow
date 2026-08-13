import React, { useEffect, useMemo } from "react";
import { useRoute } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { SettingsStackParamList } from "@/navigation/types";
import type { SettingsCategoryName } from "@/navigation/settingsRouteModel";
import { LoginScreen } from "@/screens/LoginScreen";
import { WebDavSyncScreen } from "@/screens/WebDavSyncScreen";
import { CustomSourceScreen } from "@/screens/CustomSourceScreen";
import { LyricSettingsContent } from "@/screens/LyricSettingsScreen";
import { AboutSettingsScreen } from "@/screens/settings/AboutSettingsScreen";
import { AccountSettingsScreen } from "@/screens/settings/AccountSettingsScreen";
import { AppearanceSettingsScreen } from "@/screens/settings/AppearanceSettingsScreen";
import { DataSettingsScreen } from "@/screens/settings/DataSettingsScreen";
import { LyricsSettingsScreen } from "@/screens/settings/LyricsSettingsScreen";
import { PlaybackSettingsScreen } from "@/screens/settings/PlaybackSettingsScreen";
import { SettingsHomeScreen } from "@/screens/settings/SettingsHomeScreen";
import { SourcesSettingsScreen } from "@/screens/settings/SourcesSettingsScreen";
import { SyncSettingsScreen } from "@/screens/settings/SyncSettingsScreen";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";

const Stack = createNativeStackNavigator<SettingsStackParamList>();

/**
 * 设置首页入口：当抽屉导航携带目标分类时，在栈内跳转到该分类。
 * 由于 SettingsStack 外层拿不到栈导航（useNavigation 返回的是抽屉导航），
 * 必须放在 Stack.Screen 内部（栈上下文内）才能 navigate 到目标分类。
 */
function SettingsHomeGate({
  target,
  navigation,
}: {
  target: SettingsCategoryName | "SettingsHome";
  navigation: NativeStackNavigationProp<SettingsStackParamList, "SettingsHome">;
}) {
  useEffect(() => {
    if (target === "SettingsHome") return;
    // 栈重建后首帧定位到目标分类；延迟一帧避免初始渲染未就绪
    const timer = setTimeout(() => {
      navigation.navigate(target);
    }, 0);
    return () => clearTimeout(timer);
  }, [navigation, target]);

  return <SettingsHomeScreen />;
}

export function SettingsNavigator() {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = useMemo(
    () => getThemePalette(getResolvedTheme(mode, systemTheme), accentColor),
    [mode, systemTheme, accentColor],
  );

  return (
    <SettingsStack
      palette={palette}
    />
  );
}

/**
 * 设置堆栈主体：响应抽屉导航传入的目标分类，重置内部堆栈。
 *
 * 背景：抽屉点击「账号与服务」等分类时，若 Settings 内部堆栈已有旧分类页
 * （先点账号、再点播放 → [SettingsHome, Account, Playback]），返回键会先回到
 * 旧分类页而非设置首页，表现为「返回总是回到账号设置」。
 * 这里在抽屉导航到新分类时重置为 [设置首页, 目标分类]，保证返回始终回设置首页。
 */
function SettingsStack({
  palette,
}: {
  palette: ReturnType<typeof getThemePalette>;
}) {
  const route = useRoute();
  // 抽屉导航可能携带 { screen: 目标分类, navId: 递增序号 }；仅当显式指定分类时作为 key 使用（未指定则默认设置首页）
  const params = route.params as
    | { screen?: SettingsCategoryName; navId?: number }
    | undefined;
  const target: SettingsCategoryName | "SettingsHome" =
    params?.screen ?? "SettingsHome";
  // navId 参与 key：抽屉重复点击同一分类时 params.screen 不变，但 navId 递增，
  // 从而强制重建内部栈（否则 key 不变、gate 不重新跳转，用户会卡在设置首页）。
  // 代价：每次从抽屉点分类都会闪一帧设置首页（native-stack 不支持动态 initialState）——
  // 这是修复“返回总是回到旧分类页 / 同分类不跳转”所必需的取舍，勿优化掉。
  const stackKey = `${target}-${params?.navId ?? 0}`;

  return (
    <Stack.Navigator
      key={stackKey}
      initialRouteName="SettingsHome"
      screenOptions={{
        animation: "slide_from_right",
        headerStyle: { backgroundColor: palette.surface },
        headerTintColor: palette.text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: "transparent" },
      }}
    >
      <Stack.Screen name="SettingsHome" options={{ title: "设置" }}>
        {({ navigation }) => (
          <SettingsHomeGate target={target} navigation={navigation} />
        )}
      </Stack.Screen>
      <Stack.Screen name="Account" component={AccountSettingsScreen} options={{ title: "账号与服务" }} />
      <Stack.Screen name="Playback" component={PlaybackSettingsScreen} options={{ title: "播放" }} />
      <Stack.Screen name="Lyrics" component={LyricsSettingsScreen} options={{ title: "歌词" }} />
      <Stack.Screen name="Appearance" component={AppearanceSettingsScreen} options={{ title: "外观" }} />
      <Stack.Screen name="Sources" component={SourcesSettingsScreen} options={{ title: "音源" }} />
      <Stack.Screen name="Sync" component={SyncSettingsScreen} options={{ title: "同步与备份" }} />
      <Stack.Screen name="Data" component={DataSettingsScreen} options={{ title: "存储与数据" }} />
      <Stack.Screen name="About" component={AboutSettingsScreen} options={{ title: "关于" }} />
      <Stack.Screen name="Login" options={{ title: "账号与服务" }}>
        {({ navigation }) => <LoginScreen onSuccess={() => navigation.replace("Account")} />}
      </Stack.Screen>
      <Stack.Screen name="WebDav" component={WebDavSyncScreen} options={{ title: "同步与备份" }} />
      <Stack.Screen name="CustomSources" component={CustomSourceScreen} options={{ title: "音源" }} />
      <Stack.Screen name="LyricDetail" options={{ title: "歌词" }}>
        {({ navigation }) => (
          <LyricSettingsContent onBack={() => navigation.goBack()} showNavigation={false} />
        )}
      </Stack.Screen>
    </Stack.Navigator>
  );
}
