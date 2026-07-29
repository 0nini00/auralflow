import React from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, Linking } from "react-native";
import { ChevronRight } from "lucide-react-native";
import type { UpdateInfo } from "@/services/updateService";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";

interface UpdateModalProps {
  visible: boolean;
  info: UpdateInfo;
  onClose: () => void;
}

export function UpdateModal({ visible, info, onClose }: UpdateModalProps) {
  const mode = useThemeStore((s) => s.mode);
  const systemTheme = useThemeStore((s) => s.systemTheme);
  const accentColor = useThemeStore((s) => s.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  const handleDownload = () => {
    if (info.releaseUrl) void Linking.openURL(info.releaseUrl);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: palette.surface }]}>
          <Text style={[styles.title, { color: palette.text }]}>发现新版本</Text>
          <View
            style={styles.versionRow}
            accessible
            accessibilityLabel={`当前版本 ${info.currentVersion}，最新版本 ${info.latestVersion}`}
          >
            <Text style={[styles.version, { color: palette.primary }]}>当前 {info.currentVersion}</Text>
            <ChevronRight size={16} color={palette.primary} />
            <Text style={[styles.version, { color: palette.primary }]}>最新 {info.latestVersion}</Text>
          </View>
          <Text style={[styles.releaseName, { color: palette.text }]}>{info.releaseName}</Text>
          <ScrollView style={styles.changelogScroll}>
            <Text style={[styles.changelog, { color: palette.textMuted }]}>
              {info.changelog || "暂无更新日志"}
            </Text>
          </ScrollView>
          <View style={styles.actions}>
            <Pressable
              style={[styles.button, { backgroundColor: palette.surfaceMuted }]}
              onPress={onClose}
            >
              <Text style={[styles.buttonText, { color: palette.textMuted }]}>稍后</Text>
            </Pressable>
            <Pressable
              style={[styles.button, { backgroundColor: palette.primary }]}
              onPress={handleDownload}
            >
              <Text style={[styles.buttonText, { color: palette.primaryText }]}>打开发布页</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.6)",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 14,
    padding: 24,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 4,
  },
  versionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 6,
  },
  version: {
    fontSize: 15,
    fontWeight: "600",
  },
  releaseName: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 12,
  },
  changelogScroll: {
    maxHeight: 200,
    marginBottom: 16,
  },
  changelog: {
    fontSize: 13,
    lineHeight: 20,
  },
  actions: {
    flexDirection: "row",
    gap: 12,
    justifyContent: "flex-end",
  },
  button: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  buttonText: {
    fontSize: 14,
    fontWeight: "600",
  },
});
