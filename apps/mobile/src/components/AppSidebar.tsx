import React, { useState } from "react";
import { Image, Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Calendar,
  Download,
  Home,
  ListMusic,
  Music,
  Radio,
  Search,
  Settings,
  type LucideIcon,
} from "lucide-react-native";

import { AccountInfo } from "@/components/AccountInfo";
import { Touchable } from "@/components/Touchable";
import { LoginScreen } from "@/screens/LoginScreen";
import {
  APP_SETTINGS_TAB,
  APP_TABS,
  type AppTabIconKey,
  type VisibleTabId,
} from "@/services/appNavigation";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { radius, spacing, touch, typography } from "@/theme/tokens";

/** 图标 key → lucide 组件，与桌面 Sidebar 一一对应 */
const ICON_MAP: Record<AppTabIconKey, LucideIcon> = {
  home: Home,
  search: Search,
  calendar: Calendar,
  radio: Radio,
  listMusic: ListMusic,
  download: Download,
  music: Music,
  settings: Settings,
};

interface AppSidebarProps {
  activeTab: VisibleTabId;
  onSelect: (tabId: VisibleTabId) => void;
}

/**
 * 移动端侧边栏 —— 镜像桌面 Sidebar 的导航结构与 footer 账号区。
 * 默认隐藏，由抽屉控制显隐；不在此组件内处理滑入动画。
 */
export function AppSidebar({ activeTab, onSelect }: AppSidebarProps) {
  const insets = useSafeAreaInsets();
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);
  const [loginOpen, setLoginOpen] = useState(false);

  const renderItem = (tab: { id: VisibleTabId; label: string; icon: AppTabIconKey }) => {
    const active = activeTab === tab.id;
    const Icon = ICON_MAP[tab.icon];
    const tint = active ? palette.primary : palette.textMuted;
    return (
      <Touchable
        key={tab.id}
        style={[styles.item, active && { backgroundColor: palette.surfaceMuted }]}
        activeScale={0.98}
        onPress={() => onSelect(tab.id)}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        accessibilityLabel={tab.label}
      >
        <View style={styles.itemInner}>
          <View style={[styles.indicator, active && { backgroundColor: palette.primary }]} />
          <View style={styles.iconWrap}>
            <Icon size={20} strokeWidth={2} color={tint} />
          </View>
          <Text
            style={[
              styles.itemText,
              { color: tint },
              active && styles.itemTextActive,
            ]}
            numberOfLines={1}
          >
            {tab.label}
          </Text>
        </View>
      </Touchable>
    );
  };

  return (
    <View
      style={[
        styles.root,
        {
          backgroundColor: palette.surface,
          paddingTop: Math.max(insets.top, 8),
          paddingBottom: Math.max(insets.bottom, 12),
        },
      ]}
    >
      <View style={[styles.brand, { borderBottomColor: palette.border }]}>
        <Image
          source={require("../assets/logo.png")}
          style={styles.logoImage}
          accessibilityLabel="AuralFlow"
        />
        <Text style={[styles.brandText, { color: palette.text }]}>AuralFlow</Text>
      </View>

      <ScrollView style={styles.nav} contentContainerStyle={styles.navContent} showsVerticalScrollIndicator={false}>
        {APP_TABS.map(renderItem)}
      </ScrollView>

      <View style={[styles.footer, { borderTopColor: palette.border }]}>
        {renderItem(APP_SETTINGS_TAB)}
        <View style={styles.accountWrap}>
          <AccountInfo onLoginPress={() => setLoginOpen(true)} />
        </View>
      </View>

      <Modal
        visible={loginOpen}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setLoginOpen(false)}
      >
        <View style={[styles.loginModal, { backgroundColor: palette.background, paddingTop: insets.top }]}>
          <View style={styles.loginToolbar}>
            <Touchable onPress={() => setLoginOpen(false)} style={styles.loginClose}>
              <Text style={[styles.loginCloseText, { color: palette.primary }]}>关闭</Text>
            </Touchable>
          </View>
          <LoginScreen onSuccess={() => setLoginOpen(false)} />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  brand: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.s,
    paddingVertical: spacing.s,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  logoImage: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
  },
  brandText: {
    fontSize: typography.heading,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  nav: {
    flex: 1,
  },
  navContent: {
    paddingTop: 10,
    paddingBottom: 12,
  },
  item: {
    borderRadius: radius.md,
    marginHorizontal: 10,
    marginVertical: 2,
  },
  itemInner: {
    minHeight: touch.minTarget,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  indicator: {
    width: 3,
    height: 18,
    borderRadius: 2,
    backgroundColor: "transparent",
  },
  iconWrap: {
    width: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  itemText: {
    flex: 1,
    fontSize: typography.body,
    fontWeight: "500",
  },
  itemTextActive: {
    fontWeight: "700",
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
    gap: 8,
  },
  accountWrap: {
    paddingHorizontal: 12,
    paddingBottom: 4,
  },
  loginModal: {
    flex: 1,
  },
  loginToolbar: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    alignItems: "flex-end",
  },
  loginClose: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  loginCloseText: {
    fontSize: typography.title,
    fontWeight: "600",
  },
});
