import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Linking, Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { ActionButton } from "@/components/ActionButton";
import { useCustomSourceStore } from "@/stores/customSourceStore";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { radius } from "@/theme/tokens";
import {
  buildCustomSourceUpdateDismissKey,
  getCustomSourceUpdateLog,
  selectCustomSourceUpdateNotice,
} from "@/services/customSourceUpdateNoticeModel";

const DISMISSED_KEYS_STORAGE_KEY = "auralflow.mobile.customSourceUpdateDismissed";

function parseDismissedKeys(value: string | null): Set<string> {
  if (!value) return new Set();
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? new Set(parsed) : new Set();
  } catch {
    return new Set();
  }
}

export function CustomSourceUpdateModal() {
  const sources = useCustomSourceStore((state) => state.sources);
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(() => new Set());
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(DISMISSED_KEYS_STORAGE_KEY)
      .then((value) => {
        if (!cancelled) setDismissedKeys(parseDismissedKeys(value));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const source = useMemo(
    () => selectCustomSourceUpdateNotice(sources, dismissedKeys),
    [dismissedKeys, sources],
  );

  const dismissKey = source ? buildCustomSourceUpdateDismissKey(source) : "";

  const close = useCallback(() => {
    setDismissedKeys((current) => {
      const next = new Set(current);
      next.add(dismissKey);
      AsyncStorage.setItem(DISMISSED_KEYS_STORAGE_KEY, JSON.stringify([...next])).catch(() => {});
      return next;
    });
  }, [dismissKey]);

  if (!source) return null;

  const updateLog = getCustomSourceUpdateLog(source);

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
            <ActionButton
              small
              label="关闭"
              onPress={close}
            />
            {source.updateUrl ? (
              <ActionButton
                small
                variant="primary"
                label="打开更新地址"
                onPress={openUpdateUrl}
              />
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
    borderRadius: radius.lg,
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
});
