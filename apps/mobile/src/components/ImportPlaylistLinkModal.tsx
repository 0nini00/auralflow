import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CheckCircle2, AlertCircle, Link2, X } from "lucide-react-native";
import { parsePlaylistLink } from "@lx/core";

import { importPlaylistFromLink } from "@/services/playlistLinkImportService";
import type { ThemePalette } from "@/stores/themeStore";
import { radius, spacing, typography } from "@/theme/tokens";
import { Touchable } from "@/components/Touchable";
import { withAlpha } from "@/services/themePaletteModel";
import { hapticLight } from "@/services/hapticService";

export interface ImportPlaylistLinkModalProps {
  visible: boolean;
  onClose: () => void;
  palette: ThemePalette;
  /** 导入成功回调（songCount, name） */
  onImported?: (songCount: number, name: string) => void;
}

/**
 * 粘贴链接导入歌单抽屉：
 * - 粘贴网易云 / QQ 音乐歌单链接或纯数字歌单 ID，自动识别音源；
 * - 歌单名称留空时使用默认名「导入的歌单」；
 * - 导入成功后创建为本地歌单；
 * - 贴底布局，软键盘自适应。
 */
export function ImportPlaylistLinkModal({
  visible,
  onClose,
  palette,
  onImported,
}: ImportPlaylistLinkModalProps) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();

  const [link, setLink] = useState("");
  const [name, setName] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setLink("");
      setName("");
      setError(null);
      setImporting(false);
    }
  }, [visible]);

  const parsed = link.trim() ? parsePlaylistLink(link) : null;
  const isWy = parsed?.source === "wy";
  const sourceHint = !link.trim()
    ? null
    : parsed
    ? isWy
      ? "已识别：网易云歌单"
      : "已识别：QQ 音乐歌单"
    : "无法识别链接，请检查后重试";

  const handleImport = async () => {
    if (importing || !parsed) return;
    setError(null);
    setImporting(true);
    hapticLight();
    try {
      const finalName = name.trim() || "导入的歌单";
      const result = await importPlaylistFromLink({ link, name: finalName });
      onImported?.(result.songCount, finalName);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="关闭导入歌单"
        />

        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.keyboardWrap}
        >
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: palette.surface,
                maxHeight: windowHeight * 0.85,
                paddingBottom: Math.max(insets.bottom, spacing.m),
              },
            ]}
          >
            {/* 顶部胶囊拉手 */}
            <View style={styles.handleContainer}>
              <View style={[styles.handle, { backgroundColor: palette.border }]} />
            </View>

            {/* 标题栏 */}
            <View style={styles.header}>
              <View style={styles.titleGroup}>
                <View style={styles.titleWithIcon}>
                  <Link2 size={18} color={palette.primary} />
                  <Text style={[styles.title, { color: palette.text }]}>从链接导入歌单</Text>
                </View>
                <Text style={[styles.subtitle, { color: palette.textMuted }]}>
                  支持网易云 / QQ 音乐歌单链接或纯数字 ID
                </Text>
              </View>
              <Touchable
                style={[styles.closeIconButton, { backgroundColor: palette.surfaceMuted }]}
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="关闭"
              >
                <X size={18} color={palette.textMuted} />
              </Touchable>
            </View>

            <ScrollView
              style={styles.scrollArea}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {/* 链接输入区域 */}
              <View style={styles.fieldGroup}>
                <Text style={[styles.fieldLabel, { color: palette.text }]}>歌单链接或 ID</Text>
                <TextInput
                  value={link}
                  onChangeText={(text) => {
                    setLink(text);
                    setError(null);
                  }}
                  placeholder="粘贴歌单分享链接，或纯数字歌单 ID..."
                  placeholderTextColor={palette.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  multiline
                  style={[
                    styles.linkInput,
                    {
                      backgroundColor: palette.surfaceMuted,
                      borderColor: parsed ? palette.primary : palette.border,
                      color: palette.text,
                    },
                  ]}
                />
                {sourceHint ? (
                  <View
                    style={[
                      styles.hintBadge,
                      {
                        backgroundColor: parsed
                          ? withAlpha(palette.primary, 0.1)
                          : withAlpha(palette.danger, 0.1),
                      },
                    ]}
                  >
                    {parsed ? (
                      <CheckCircle2 size={14} color={palette.primary} />
                    ) : (
                      <AlertCircle size={14} color={palette.danger} />
                    )}
                    <Text
                      style={[
                        styles.hintText,
                        { color: parsed ? palette.primary : palette.danger },
                      ]}
                    >
                      {sourceHint}
                    </Text>
                  </View>
                ) : null}
              </View>

              {/* 歌单名称输入 */}
              <View style={styles.fieldGroup}>
                <Text style={[styles.fieldLabel, { color: palette.text }]}>
                  保存歌单名称 <Text style={{ color: palette.textMuted, fontWeight: "400" }}>（可选）</Text>
                </Text>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="留空默认使用「导入的歌单」"
                  placeholderTextColor={palette.textMuted}
                  style={[
                    styles.nameInput,
                    {
                      backgroundColor: palette.surfaceMuted,
                      borderColor: palette.border,
                      color: palette.text,
                    },
                  ]}
                />
              </View>

              {/* 错误信息展示 */}
              {error ? (
                <View
                  style={[styles.errorBox, { backgroundColor: withAlpha(palette.danger, 0.1) }]}
                >
                  <AlertCircle size={15} color={palette.danger} />
                  <Text style={[styles.errorText, { color: palette.danger }]}>{error}</Text>
                </View>
              ) : null}

              {/* 操作按钮组 */}
              <View style={styles.actions}>
                <Touchable
                  style={[styles.cancelBtn, { backgroundColor: palette.surfaceMuted }]}
                  onPress={onClose}
                  disabled={importing}
                  accessibilityRole="button"
                  accessibilityLabel="取消"
                >
                  <Text style={[styles.cancelBtnText, { color: palette.textMuted }]}>取消</Text>
                </Touchable>

                <Touchable
                  style={[
                    styles.importBtn,
                    {
                      backgroundColor: parsed && !importing ? palette.primary : palette.border,
                    },
                  ]}
                  onPress={() => void handleImport()}
                  disabled={importing || !parsed}
                  accessibilityRole="button"
                  accessibilityLabel="导入歌单"
                >
                  {importing ? (
                    <ActivityIndicator color={palette.primaryText} size="small" />
                  ) : (
                    <Text
                      style={[
                        styles.importBtnText,
                        { color: parsed ? palette.primaryText : palette.textMuted },
                      ]}
                    >
                      开始导入
                    </Text>
                  )}
                </Touchable>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0, 0, 0, 0.45)",
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  keyboardWrap: {
    width: "100%",
    justifyContent: "flex-end",
  },
  sheet: {
    width: "100%",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -4 },
    elevation: 20,
  },
  handleContainer: {
    alignItems: "center",
    paddingVertical: 10,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.l,
    paddingBottom: spacing.s,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(0, 0, 0, 0.06)",
  },
  titleGroup: {
    flex: 1,
    gap: 3,
  },
  titleWithIcon: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  title: {
    fontSize: typography.title,
    fontWeight: "700",
  },
  subtitle: {
    fontSize: typography.caption,
  },
  closeIconButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  scrollArea: {
    flexGrow: 0,
  },
  scrollContent: {
    paddingHorizontal: spacing.l,
    paddingVertical: spacing.m,
    gap: spacing.m,
  },
  fieldGroup: {
    gap: 6,
  },
  fieldLabel: {
    fontSize: typography.caption,
    fontWeight: "600",
  },
  linkInput: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.s,
    fontSize: typography.body,
    minHeight: 70,
    textAlignVertical: "top",
  },
  hintBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.m,
    paddingVertical: 6,
    borderRadius: radius.sm,
    alignSelf: "flex-start",
  },
  hintText: {
    fontSize: typography.caption,
    fontWeight: "600",
  },
  nameInput: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.m,
    height: 44,
    fontSize: typography.body,
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    padding: spacing.s,
    borderRadius: radius.sm,
  },
  errorText: {
    fontSize: typography.caption,
    flex: 1,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.m,
    marginTop: spacing.xs,
  },
  cancelBtn: {
    flex: 1,
    height: 46,
    borderRadius: radius.md,
    justifyContent: "center",
    alignItems: "center",
  },
  cancelBtnText: {
    fontSize: typography.body,
    fontWeight: "600",
  },
  importBtn: {
    flex: 2,
    height: 46,
    borderRadius: radius.md,
    justifyContent: "center",
    alignItems: "center",
  },
  importBtnText: {
    fontSize: typography.body,
    fontWeight: "700",
  },
});
