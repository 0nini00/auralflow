import React, { useState } from "react";
import { Image, Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Database,
  HardDrive,
  Info,
  Settings,
  Upload,
} from "lucide-react-native";
import type { DrawerContentComponentProps } from "@react-navigation/drawer";

import { AccountInfo } from "@/components/AccountInfo";
import { Touchable } from "@/components/Touchable";
import { LoginScreen } from "@/screens/LoginScreen";
import { getThemePalette, useThemeStore, getResolvedTheme } from "@/stores/themeStore";
import { radius, spacing, touch, typography } from "@/theme/tokens";

interface DrawerItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ size: number; color: string }>;
  onPress: () => void;
}

const APP_VERSION = "v0.2.2";

export function DrawerContent({ navigation }: DrawerContentComponentProps) {
  const insets = useSafeAreaInsets();
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);
  const [loginOpen, setLoginOpen] = useState(false);

  const items: DrawerItem[] = [
    {
      id: "custom-sources",
      label: "自定义音源",
      icon: Database,
      onPress: () => {
        navigation.closeDrawer();
        navigation.navigate("Settings");
      },
    },
    {
      id: "webdav",
      label: "WebDAV 同步",
      icon: Upload,
      onPress: () => {
        navigation.closeDrawer();
        navigation.navigate("Settings");
      },
    },
    {
      id: "data",
      label: "数据管理",
      icon: HardDrive,
      onPress: () => {
        navigation.closeDrawer();
        navigation.navigate("Settings");
      },
    },
    {
      id: "settings",
      label: "设置",
      icon: Settings,
      onPress: () => {
        navigation.closeDrawer();
        navigation.navigate("Settings");
      },
    },
    {
      id: "about",
      label: "关于",
      icon: Info,
      onPress: () => {
        navigation.closeDrawer();
        navigation.navigate("Settings");
      },
    },
  ];

  const renderItem = (item: DrawerItem) => {
    const Icon = item.icon;
    return (
      <Touchable
        key={item.id}
        style={styles.item}
        activeScale={0.98}
        onPress={item.onPress}
        accessibilityRole="button"
        accessibilityLabel={item.label}
      >
        <View style={styles.itemInner}>
          <Icon size={20} color={palette.textMuted} />
          <Text style={[styles.itemText, { color: palette.text }]} numberOfLines={1}>
            {item.label}
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

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer} showsVerticalScrollIndicator={false}>
        <View style={styles.section}>
          <AccountInfo onLoginPress={() => setLoginOpen(true)} />
        </View>

        <View style={[styles.section, { borderTopColor: palette.border }]}>
          {items.map(renderItem)}
        </View>
      </ScrollView>

      <View style={[styles.footer, { borderTopColor: palette.border }]}>
        <Text style={[styles.version, { color: palette.textSubtle }]}>
          {APP_VERSION}
        </Text>
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
  content: {
    flex: 1,
  },
  contentContainer: {
    paddingTop: 12,
    paddingBottom: 12,
  },
  section: {
    paddingTop: 8,
    paddingBottom: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
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
    gap: spacing.s,
    paddingHorizontal: spacing.s,
  },
  itemText: {
    flex: 1,
    fontSize: typography.body,
    fontWeight: "500",
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 8,
    alignItems: "center",
  },
  version: {
    fontSize: typography.caption,
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
