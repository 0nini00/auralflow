import React, { useMemo, useState } from "react";
import { Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { useCustomSourceStore } from "@/stores/customSourceStore";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import {
  buildCustomSourceUpdateDismissKey,
  getCustomSourceUpdateLog,
  selectCustomSourceUpdateNotice,
} from "@/services/customSourceUpdateNoticeModel";

export function CustomSourceUpdateModal() {
  const sources = useCustomSourceStore((state) => state.sources);
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(() => new Set());
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  const source = useMemo(
    () => selectCustomSourceUpdateNotice(sources, dismissedKeys),
    [dismissedKeys, sources],
  );

  if (!source) return null;

  const dismissKey = buildCustomSourceUpdateDismissKey(source);
  const updateLog = getCustomSourceUpdateLog(source);

  const close = () => {
    setDismissedKeys((current) => {
      const next = new Set(current);
      next.add(dismissKey);
      return next;
    });
  };

  const openUpdateUrl = () => {
    if (source.updateUrl) void Linking.openURL(source.updateUrl);
    close();
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      <View style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: palette.surface }]}>
          <Text style={[styles.title, { color: palette.text }]}>
            自定义音源发现新版本
          </Text>
          <Text style={[styles.sourceName, { color: palette.primary }]}>
            {source.name}
          </Text>
          <ScrollView style={styles.logScroll}>
            <Text style={[styles.logText, { color: palette.textMuted }]}>
              {updateLog}
            </Text>
          </ScrollView>
          <View style={styles.actions}>
            <Pressable
              style={[styles.button, { backgroundColor: palette.surfaceMuted }]}
              onPress={close}
            >
              <Text style={[styles.buttonText, { color: palette.textMuted }]}>关闭</Text>
            </Pressable>
            {source.updateUrl ? (
              <Pressable
                style={[styles.button, { backgroundColor: palette.primary }]}
                onPress={openUpdateUrl}
              >
                <Text style={[styles.buttonText, { color: palette.primaryText }]}>
                  打开更新地址
                </Text>
              </Pressable>
            ) : null}
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
    padding: 22,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 6,
  },
  sourceName: {
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 12,
  },
  logScroll: {
    maxHeight: 180,
    marginBottom: 16,
  },
  logText: {
    fontSize: 13,
    lineHeight: 20,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
  },
  button: {
    minHeight: 40,
    borderRadius: 8,
    paddingHorizontal: 16,
    justifyContent: "center",
  },
  buttonText: {
    fontSize: 14,
    fontWeight: "700",
  },
});
