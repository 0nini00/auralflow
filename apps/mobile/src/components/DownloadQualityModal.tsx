import React from "react";
import {
  Modal,
  View,
  Text,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  Platform,
} from "react-native";
import type { MusicInfo } from "@lx/core";
import {
  getResolvedTheme,
  getThemePalette,
  useThemeStore,
} from "@/stores/themeStore";
import type { DownloadQuality } from "@/stores/downloadStore";
import { PLAYBACK_QUALITY_OPTIONS } from "@/services/playbackQualityModel";
import { withAlpha } from "@/services/themePaletteModel";
import { radius } from "@/theme/tokens";

interface DownloadQualityModalProps {
  /** 弹窗是否可见 */
  visible: boolean;
  /** 待下载的歌曲 */
  song: MusicInfo | null;
  /** 关闭弹窗 */
  onClose: () => void;
  /** 选择音质后触发下载 */
  onDownload: (quality: DownloadQuality) => void;
  /** 当前正在下载的音质（用于显示加载态），无则 null */
  pendingQuality?: DownloadQuality | null;
  /** 默认选中的音质（读取上次选择后回填），无则 null */
  defaultQuality?: DownloadQuality | null;
  summaryText?: string;
  progressText?: string | null;
}

export function DownloadQualityModal({
  visible,
  song,
  onClose,
  onDownload,
  pendingQuality = null,
  defaultQuality = null,
  summaryText,
  progressText = null,
}: DownloadQualityModalProps) {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);
  // 上次选择的音质作为默认高亮（对齐 lx：记住上次选择）
  const [selectedQuality, setSelectedQuality] = React.useState<DownloadQuality | null>(defaultQuality);

  React.useEffect(() => {
    if (visible) setSelectedQuality(defaultQuality);
  }, [visible, defaultQuality]);

  const busy = pendingQuality != null;

  const handleSelect = (quality: DownloadQuality) => {
    if (busy) return;
    setSelectedQuality(quality);
    onDownload(quality);
  };

  const isSelected = (quality: DownloadQuality) => selectedQuality === quality;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent={Platform.OS === "android"}
      accessibilityViewIsModal
    >
      <Pressable style={styles.overlay} accessible={false} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { backgroundColor: palette.surface }]}
          accessible={false}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={[styles.handle, { backgroundColor: palette.border }]} />

          <Text style={[styles.title, { color: palette.text }]}>选择下载音质</Text>
          {summaryText || song ? (
            <Text style={[styles.songName, { color: palette.textMuted }]} numberOfLines={1}>
              {summaryText ?? `${song?.name} · ${song?.singer || "未知歌手"}`}
            </Text>
          ) : null}
          {progressText ? (
            <Text style={[styles.progressText, { color: palette.primary }]}>{progressText}</Text>
          ) : null}

          <View style={styles.optionList}>
            {PLAYBACK_QUALITY_OPTIONS.map((option) => {
              const isPending = pendingQuality === option.value;
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="button"
                  accessibilityLabel={`下载音质，${option.label}，${option.description}`}
                  accessibilityState={{ disabled: busy, busy: isPending }}
                  style={({ pressed }) => [
                    styles.option,
                    {
                      backgroundColor: isSelected(option.value) ? withAlpha(palette.primary, 0.08) : palette.surfaceMuted,
                      borderWidth: 1,
                      borderColor: isSelected(option.value) ? palette.primary : "transparent",
                    },
                    pressed && { opacity: 0.7 },
                  ]}
                  onPress={() => handleSelect(option.value)}
                  disabled={busy}
                >
                  <View style={styles.optionTextWrap}>
                    <Text style={[styles.optionLabel, { color: isSelected(option.value) ? palette.primary : palette.text }]}>
                      {option.label}
                    </Text>
                    <Text style={[styles.optionDesc, { color: palette.textSubtle }]}>
                      {option.description}
                    </Text>
                  </View>
                  {isPending ? (
                    <ActivityIndicator color={palette.primary} size="small" />
                  ) : (
                    <Text style={[styles.optionAction, { color: isSelected(option.value) ? palette.primary : palette.textMuted }]}>
                      {isSelected(option.value) ? "已选" : "下载"}
                    </Text>
                  )}
                </Pressable>
              );
            })}
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="取消下载音质选择"
            accessibilityState={{ disabled: busy }}
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
  songName: {
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
    fontSize: 14,
    fontWeight: "700",
    marginLeft: 12,
  },
  cancelButton: {
    minHeight: 44,
    marginTop: 14,
    paddingVertical: 12,
    borderRadius: radius.md,
    alignItems: "center",
  },
  cancelText: {
    fontSize: 15,
    fontWeight: "600",
  },
});
