import React, { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import type { MusicInfo } from "@lx/core";

import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { useDownloadStore, type DownloadQuality } from "@/stores/downloadStore";
import { PLAYBACK_QUALITY_OPTIONS } from "@/services/playbackQualityModel";
import { getLastSelectQuality, saveLastSelectQuality } from "@/services/downloadService";
import { withAlpha } from "@/services/themePaletteModel";
import { radius, spacing, typography } from "@/theme/tokens";

interface BatchDownloadModalProps {
  visible: boolean;
  /** 待批量下载的歌曲列表 */
  songs: MusicInfo[];
  onClose: () => void;
  /** 逐首触发下载（外层编排，可统计进度） */
  onDownload: (song: MusicInfo, quality: DownloadQuality) => void | Promise<void>;
  /** 批量下载进行中的进度提示 */
  progressText?: string | null;
  /** 批量下载是否进行中（锁定选择） */
  busy?: boolean;
}

/**
 * 批量下载弹窗（对齐 lx BatchDownloadModal）：
 * 选音质（记住上次选择）→ 确认后逐首加入下载队列。
 * 用于歌单/专辑/歌手等详情页的「下载全部」入口。
 */
export function BatchDownloadModal({
  visible,
  songs,
  onClose,
  onDownload,
  progressText = null,
  busy = false,
}: BatchDownloadModalProps) {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);
  const [selectedQuality, setSelectedQuality] = useState<DownloadQuality>("320k");

  useEffect(() => {
    if (!visible) return;
    // 记住上次选择的音质（对齐 lx），读取失败回退默认 320k
    void getLastSelectQuality().then((last) => {
      if (last) setSelectedQuality(last);
    });
  }, [visible]);

  const handleConfirm = () => {
    if (busy || songs.length === 0) return;
    void saveLastSelectQuality(selectedQuality);
    for (const song of songs) {
      void onDownload(song, selectedQuality);
    }
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent={Platform.OS === "android"}
      accessibilityViewIsModal
    >
      <Pressable style={styles.overlay} accessible={false} onPress={busy ? undefined : onClose}>
        <Pressable
          style={[styles.sheet, { backgroundColor: palette.surface }]}
          accessible={false}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={[styles.handle, { backgroundColor: palette.border }]} />

          <Text style={[styles.title, { color: palette.text }]}>
            批量下载 {songs.length} 首歌曲
          </Text>
          <Text style={[styles.subtitle, { color: palette.textMuted }]}>
            按所选音质依次加入下载队列
          </Text>
          {progressText ? (
            <Text style={[styles.progressText, { color: palette.primary }]}>{progressText}</Text>
          ) : null}

          <View style={styles.optionList}>
            {PLAYBACK_QUALITY_OPTIONS.map((option) => {
              const isSelected = selectedQuality === option.value;
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="button"
                  accessibilityLabel={`下载音质，${option.label}，${option.description}`}
                  accessibilityState={{ disabled: busy, selected: isSelected }}
                  style={({ pressed }) => [
                    styles.option,
                    {
                      backgroundColor: isSelected ? withAlpha(palette.primary, 0.08) : palette.surfaceMuted,
                      borderWidth: 1,
                      borderColor: isSelected ? palette.primary : "transparent",
                    },
                    pressed && { opacity: 0.7 },
                  ]}
                  onPress={() => setSelectedQuality(option.value)}
                  disabled={busy}
                >
                  <View style={styles.optionTextWrap}>
                    <Text style={[styles.optionLabel, { color: isSelected ? palette.primary : palette.text }]}>
                      {option.label}
                    </Text>
                    <Text style={[styles.optionDesc, { color: palette.textSubtle }]}>
                      {option.description}
                    </Text>
                  </View>
                  <Text style={[styles.optionAction, { color: isSelected ? palette.primary : palette.textMuted }]}>
                    {isSelected ? "已选" : ""}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.footer}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="取消批量下载"
              style={({ pressed }) => [
                styles.cancelButton,
                { backgroundColor: palette.surfaceStrong },
                pressed && { opacity: 0.7 },
              ]}
              onPress={onClose}
              disabled={busy}
            >
              <Text style={[styles.cancelText, { color: palette.textMuted }]}>取消</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`确认批量下载 ${songs.length} 首歌曲`}
              accessibilityState={{ disabled: busy || songs.length === 0 }}
              style={({ pressed }) => [
                styles.confirmButton,
                { backgroundColor: palette.surface, borderColor: palette.border, borderWidth: 1 },
                pressed && { opacity: 0.8 },
                (busy || songs.length === 0) && { opacity: 0.5 },
              ]}
              onPress={handleConfirm}
              disabled={busy || songs.length === 0}
            >
              {busy ? (
                <ActivityIndicator color={palette.primary} size="small" />
              ) : (
                <Text style={[styles.confirmText, { color: palette.primary }]}>开始下载</Text>
              )}
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 34,
    maxHeight: "80%",
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 12,
  },
  title: {
    fontSize: 17,
    fontWeight: "700",
    textAlign: "center",
  },
  subtitle: {
    fontSize: 13,
    textAlign: "center",
    marginTop: 4,
    marginBottom: 12,
  },
  progressText: {
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 12,
  },
  optionList: {
    gap: 8,
  },
  option: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: radius.md,
  },
  optionTextWrap: {
    flex: 1,
    gap: 2,
  },
  optionLabel: {
    fontSize: 15,
    fontWeight: "600",
  },
  optionDesc: {
    fontSize: 12,
  },
  optionAction: {
    fontSize: 13,
    fontWeight: "600",
  },
  footer: {
    flexDirection: "row",
    gap: spacing.s,
    marginTop: 16,
  },
  cancelButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelText: {
    fontSize: 15,
    fontWeight: "600",
  },
  confirmButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmText: {
    fontSize: 15,
    fontWeight: "700",
  },
});
