import React from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Check } from "lucide-react-native";
import { IMMERSIVE_BACKGROUND_OPTIONS } from "@/services/immersiveBackgroundSettings";
import { useLyricSettingsStore } from "@/stores/lyricSettingsStore";
import type { ThemePalette } from "@/stores/themeStore";
import { sheet } from "@/theme/sheetTokens";
import { radius, spacing, touch, typography } from "@/theme/tokens";

export interface ImmersiveBackgroundSheetProps {
  visible: boolean;
  onClose: () => void;
  palette: ThemePalette;
}

/** 独立原生弹层供设置页与播放页共用，不受设置页滚动容器的边界裁剪。 */
export function ImmersiveBackgroundSheet({ visible, onClose, palette }: ImmersiveBackgroundSheetProps) {
  const background = useLyricSettingsStore((state) => state.immersiveBackground);
  const setBackground = useLyricSettingsStore((state) => state.setImmersiveBackground);
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel="关闭播放背景选择"
          onPress={onClose}
        />
        <View
          accessibilityViewIsModal
          style={[styles.panel, {
            backgroundColor: palette.surface,
            maxHeight: height * 0.75,
            paddingBottom: Math.max(insets.bottom, sheet.bottomInsetMin),
          }]}
        >
          <View style={styles.header}>
            <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>播放背景</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="完成背景选择"
              onPress={onClose}
              style={styles.done}
            >
              <Text style={[styles.doneText, { color: palette.primaryInk }]}>完成</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.options} contentContainerStyle={styles.optionContent}>
            {IMMERSIVE_BACKGROUND_OPTIONS.map((option) => {
              const selected = background === option.value;
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="radio"
                  accessibilityLabel={`播放背景：${option.label}`}
                  accessibilityState={{ selected, checked: selected }}
                  onPress={() => setBackground(option.value)}
                  style={({ pressed }) => [styles.option, {
                    backgroundColor: selected || pressed ? palette.surfaceMuted : "transparent",
                  }]}
                >
                  <Text style={[styles.label, { color: selected ? palette.primaryInk : palette.text }]}>
                    {option.label}
                  </Text>
                  <View style={styles.check}>
                    {selected ? <Check size={20} color={palette.primaryInk} accessible={false} /> : null}
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: sheet.scrim },
  panel: { borderTopLeftRadius: sheet.radius, borderTopRightRadius: sheet.radius, overflow: "hidden" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.l, paddingTop: spacing.xs },
  title: { fontSize: typography.heading, fontWeight: "700" },
  done: { minHeight: touch.minTarget, minWidth: touch.minTarget, alignItems: "center", justifyContent: "center" },
  doneText: { fontSize: typography.body, fontWeight: "600" },
  options: { flexGrow: 0 },
  optionContent: { paddingHorizontal: spacing.m, gap: spacing.xxs },
  option: { minHeight: 52, paddingHorizontal: spacing.s, borderRadius: radius.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  label: { fontSize: typography.body, fontWeight: "500" },
  check: { width: 24, alignItems: "center" },
});
