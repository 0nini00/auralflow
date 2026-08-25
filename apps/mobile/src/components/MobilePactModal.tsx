import React from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";

interface MobilePactModalProps {
  visible: boolean;
  accepting?: boolean;
  onAccept: () => void;
}

export function MobilePactModal({ visible, accepting = false, onAccept }: MobilePactModalProps) {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => {}}>
      <View style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: palette.surface }]}>
          <Text style={[styles.title, { color: palette.text }]}>使用须知</Text>
          <ScrollView style={styles.bodyScroll} contentContainerStyle={styles.body}>
            <Text style={[styles.paragraph, { color: palette.textMuted }]}>AuralFlow 是一个多源音乐播放器，仅供学习交流使用。</Text>
            <Text style={[styles.item, { color: palette.textMuted }]}>本软件不存储任何音频文件，所有内容来自第三方音源，版权归原权利人所有。</Text>
            <Text style={[styles.item, { color: palette.textMuted }]}>VIP 歌曲播放需要你自己的网易云账号登录，请勿用于商业用途或批量下载。</Text>
            <Text style={[styles.item, { color: palette.textMuted }]}>使用本软件产生的任何法律责任由使用者自行承担。</Text>
            <Text style={[styles.item, { color: palette.textMuted }]}>请遵守所在地相关版权法律法规。</Text>
            <Text style={[styles.confirm, { color: palette.text }]}>继续使用即视为你已阅读并同意以上条款。</Text>
          </ScrollView>
          <Pressable
            style={[styles.acceptButton, { backgroundColor: palette.surface, borderColor: palette.border, borderWidth: 1 }]}
            onPress={onAccept}
            disabled={accepting}
          >
            {accepting ? (
              <ActivityIndicator color={palette.primary} size="small" />
            ) : (
              <Text style={[styles.acceptText, { color: palette.primary }]}>我已阅读并同意</Text>
            )}
          </Pressable>
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
    backgroundColor: "rgba(0, 0, 0, 0.62)",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 380,
    borderRadius: 14,
    padding: 22,
    gap: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
  },
  bodyScroll: {
    maxHeight: 320,
  },
  body: {
    gap: 10,
  },
  paragraph: {
    fontSize: 14,
    lineHeight: 21,
  },
  item: {
    fontSize: 13,
    lineHeight: 20,
  },
  confirm: {
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "600",
  },
  acceptButton: {
    minHeight: 44,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  acceptText: {
    fontSize: 14,
    fontWeight: "700",
  },
});
