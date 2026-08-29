import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { parsePlaylistLink } from "@lx/core";

import { importPlaylistFromLink } from "@/services/playlistLinkImportService";
import type { ThemePalette } from "@/stores/themeStore";
import { radius, spacing, typography } from "@/theme/tokens";

export interface ImportPlaylistLinkModalProps {
  visible: boolean;
  onClose: () => void;
  palette: ThemePalette;
  /** 导入成功回调（songCount, name） */
  onImported?: (songCount: number, name: string) => void;
}

/**
 * 粘贴链接导入歌单弹窗：
 * - 粘贴网易云 / QQ 音乐歌单链接或纯数字歌单 ID，自动识别音源；
 * - 歌单名称留空时使用默认名「导入的歌单」；
 * - 导入成功后创建为本地歌单。
 */
export function ImportPlaylistLinkModal({ visible, onClose, palette, onImported }: ImportPlaylistLinkModalProps) {
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
  const sourceHint = !link.trim()
    ? null
    : parsed
      ? parsed.source === "wy"
        ? "已识别：网易云歌单"
        : "已识别：QQ 音乐歌单"
      : "无法识别链接，请检查后重试";

  const handleImport = async () => {
    if (importing) return;
    setError(null);
    setImporting(true);
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
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.card, { backgroundColor: palette.surface }]}>
          <Text style={[styles.title, { color: palette.text }]}>从链接导入歌单</Text>
          <TextInput
            value={link}
            onChangeText={(text) => {
              setLink(text);
              setError(null);
            }}
            placeholder="粘贴网易云 / QQ 音乐歌单链接或纯数字 ID"
            placeholderTextColor={palette.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            style={[styles.input, styles.linkInput, { borderColor: palette.border, color: palette.text }]}
          />
          {sourceHint ? (
            <Text
              accessibilityLiveRegion="polite"
              style={[styles.hint, { color: parsed ? palette.primary : palette.danger }]}
            >
              {sourceHint}
            </Text>
          ) : null}
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="歌单名称（留空使用「导入的歌单」）"
            placeholderTextColor={palette.textMuted}
            style={[styles.input, { borderColor: palette.border, color: palette.text }]}
          />
          {error ? (
            <Text accessibilityLiveRegion="polite" style={[styles.errorText, { color: palette.danger }]}>
              {error}
            </Text>
          ) : null}
          <View style={styles.actions}>
            <Pressable style={styles.actionButton} onPress={onClose} disabled={importing}>
              <Text style={[styles.actionText, { color: palette.textMuted }]}>取消</Text>
            </Pressable>
            <Pressable
              style={[styles.actionButton, { borderWidth: 1, borderColor: palette.border }]}
              onPress={() => void handleImport()}
              disabled={importing || !parsed}
            >
              {importing ? (
                <ActivityIndicator color={palette.primary} size="small" />
              ) : (
                <Text style={[styles.actionText, { color: parsed ? palette.primary : palette.textMuted }]}>导入</Text>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "center" },
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  card: {
    marginHorizontal: spacing.l,
    borderRadius: radius.lg,
    padding: spacing.l,
    gap: spacing.s,
  },
  title: { fontSize: typography.title, fontWeight: "700" },
  input: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.s,
    paddingVertical: spacing.xs,
    fontSize: typography.body,
    minHeight: 44,
  },
  linkInput: { minHeight: 72, textAlignVertical: "top" },
  hint: { fontSize: typography.caption },
  errorText: { fontSize: typography.caption, lineHeight: 18 },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.m, marginTop: spacing.xxs },
  actionButton: { minHeight: 44, minWidth: 72, alignItems: "center", justifyContent: "center", borderRadius: radius.md },
  actionText: { fontSize: typography.body, fontWeight: "600" },
});
