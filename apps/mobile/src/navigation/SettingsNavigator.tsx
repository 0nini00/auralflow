import React, { useEffect, useMemo } from "react";
import { CommonActions, useRoute, useNavigation } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { ChevronLeft } from "lucide-react-native";
import type { SettingsStackParamList } from "@/navigation/types";
import type { SettingsCategoryName } from "@/navigation/settingsRouteModel";
import { navigationRef } from "@/navigation/navigationRef";
import { IconButton } from "@/components/IconButton";
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
 * 设置堆栈主体：响应抽屉导航传入的目标分类，守卫内部堆栈形态。
 *
 * 两个已知问题都在这里兜住：
 * 1. 首次从抽屉进入某分类时，嵌套 navigate 会把该分类作为内部栈的初始路由
 *    （覆盖 initialRouteName）——栈底没有设置首页垫底，该页头部就没有返回键；
 *    旧方案挂在设置首页里的 Gate 此时根本没渲染，无从纠正。
 * 2. 推入/返回动画进行中的 dispatch 可能被 native-stack 吞掉，栈里残留旧分类页
 *    （打开 B 返回却先落到 A）。
 *
 * 按 (target, navId) 校验栈形态，不符合则定向 reset 纠正；450ms 后再校验一次
 * 兜底被吞的 dispatch。校验放行「目标页之上继续压入的更深页面」（如 账号 → 登录），
 * 不会误杀三级页。
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
    // navId 参与 effect 依赖：抽屉重复点击同一分类时 params.screen 不变，但 navId
    // 递增，从而重新触发栈形态校验（否则依赖不变、不再纠正，卡在错误栈形上）。
  const navId = params?.navId ?? 0;

  useEffect(() => {
    // 冷启动首次挂载（抽屉未携带参数）：栈本身就是 [设置首页]，无需校验
    if (navId === 0 && target === "SettingsHome") return;

    const fixup = () => {
      if (!navigationRef.isReady()) return;
      const settingsRoute = navigationRef
        .getRootState()
        ?.routes.find((item) => item.name === "Settings");
      const inner = settingsRoute?.state;
      if (!inner || inner.routes.length === 0) return;
      const innerIndex = inner.index ?? 0;

      if (target === "SettingsHome") {
        // 回到设置首页：清掉离开设置时遗留的旧分类页（抽屉切走不会清内部栈）
        if (innerIndex === 0 && inner.routes.length === 1) return;
        navigationRef.dispatch({
          ...CommonActions.reset({
            index: 0,
            routes: [{ name: "SettingsHome" as never }],
          }),
          target: inner.key,
        });
        return;
      }

      const settled =
        inner.routes.length === 1 &&
        inner.routes[0].name === target;
      if (settled) return;
      // 一律重置为 [目标分类]：清掉残留的旧分类页。
      // 返回键由 headerLeft 统一拦截回退到 Main
      navigationRef.dispatch({
        ...CommonActions.reset({
          index: 0,
          routes: [
            { name: target as never },
          ],
        }),
        target: inner.key,
      });
    };

    const immediateTimer = setTimeout(fixup, 0);
    const verifyTimer = setTimeout(fixup, 450);
    return () => {
      clearTimeout(immediateTimer);
      clearTimeout(verifyTimer);
    };
  }, [navId, target]);

  return (
    <Stack.Navigator
      initialRouteName="SettingsHome"
      screenOptions={({ navigation }) => ({
        animation: "slide_from_right",
        headerStyle: { backgroundColor: palette.surface },
        headerTintColor: palette.text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: "transparent" },
        headerLeft: ({ canGoBack }) => {
          if (canGoBack) return undefined;
          return (
            <IconButton
              render={({ size, color }) => <ChevronLeft size={size} color={color} />}
              accessibilityLabel="返回"
              tone="strong"
              onPress={() => navigation.navigate("Main" as never)}
              style={{ marginLeft: -12 }}
            />
          );
        },
      })}
    >
      <Stack.Screen name="SettingsHome" component={SettingsHomeScreen} options={{ title: "设置" }} />
      <Stack.Screen name="Account" component={AccountSettingsScreen} options={{ title: "账号与服务" }} />
      <Stack.Screen name="Playback" component={PlaybackSettingsScreen} options={{ title: "播放" }} />
      <Stack.Screen name="Lyrics" component={LyricsSettingsScreen} options={{ title: "歌词" }} />
      <Stack.Screen name="Appearance" component={AppearanceSettingsScreen} options={{ title: "外观" }} />
      <Stack.Screen name="Sources" component={SourcesSettingsScreen} options={{ title: "音源" }} />
      <Stack.Screen name="Sync" component={SyncSettingsScreen} options={{ title: "同步与备份" }} />
      <Stack.Screen name="Data" component={DataSettingsScreen} options={{ title: "存储与数据" }} />
      <Stack.Screen name="About" component={AboutSettingsScreen} options={{ title: "关于" }} />
    </Stack.Navigator>
  );
}
