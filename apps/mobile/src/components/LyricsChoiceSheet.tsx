import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Check, CircleSlash, RotateCcw, X } from "lucide-react-native";
import type { MusicInfo } from "@lx/core";
import { Touchable } from "@/components/Touchable";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { useLocalMusicStore } from "@/stores/localMusicStore";
import { radius, spacing, touch, typography } from "@/theme/tokens";
import { withAlpha } from "@/services/themePaletteModel";
import { hapticLight } from "@/services/hapticService";
import { formatLyricsAsLrc } from "@/services/downloadService";
import {
  findLocalLyricsCandidates,
  readLyricsCandidateLines,
  type LocalLyricsCandidate,
} from "@/services/localMediaSearchService";
import { readLocalLyricsFile } from "@/services/localMediaRuntime";
import { formatLyricsChoiceLabel, type LocalLyricsChoiceFields, type LocalLyricsChoiceRequest } from "@/services/localLyricsChoiceModel";

export interface LyricsChoiceSheetProps {
  visible: boolean;
  song: MusicInfo | null;
  onClose: () => void;
}

const TIER_LABELS: Record<string, string> = {
  "same-recording": "同一录音档",
  "other-performer": "同曲异唱档",
};

/** 「12.5s 差值」这种量级用一位小数足够；差值小于 0.5s 直接说一致。 */
function formatDurationGap(gap?: number): string | undefined {
  if (gap === undefined) return undefined;
  return gap < 0.5 ? "时长一致" : `时长差 ${gap.toFixed(1)}s`;
}

/**
 * 「选择歌词」面板。
 *
 * 候选**全部**摆出来，只用 core 的档位判定排序与标注：平台召回的质量不由本层担保，同名不同曲
 * 最终得由用户自己认。搜索失败只显示错误与「重试」，绝不改变当前 mode——否则一次断网就会把
 * 用户的选择悄悄改掉；「不要匹配」与本地已有歌词在离线时同样可用。
 */
export function LyricsChoiceSheet({ visible, song, onClose }: LyricsChoiceSheetProps) {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const setLocalSongLyricsChoice = useLocalMusicStore((state) => state.setLocalSongLyricsChoice);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<LocalLyricsCandidate[]>([]);
  // 指纹是选择生效的依据：必须在用户做出选择的那一刻读一次（一次原生 SHA-256）。
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!song) return;
    setLoading(true);
    setError(null);
    setCandidates([]);
    try {
      const local = await readLocalLyricsFile(song);
      setFingerprint(local.fingerprint);
      const found = await findLocalLyricsCandidates(song, { localText: local.lyrics || song.localLyrics });
      setCandidates(found.candidates);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setLoading(false);
    }
  }, [song]);

  useEffect(() => {
    if (!visible) {
      setCandidates([]);
      setError(null);
      setFingerprint(null);
      return;
    }
    void load();
  }, [visible, load]);

  const save = async (request: LocalLyricsChoiceRequest) => {
    if (!song) return;
    setBusy(true);
    try {
      await setLocalSongLyricsChoice({ id: song.id, source: song.source }, request);
      onClose();
    } catch (failure) {
      Alert.alert("保存歌词选择失败", failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  const requireFingerprint = (): string | null => {
    if (fingerprint) return fingerprint;
    Alert.alert("无法绑定这首歌", "读取音频文件指纹失败，请重试；仍失败请安装新版 APK。");
    return null;
  };

  const handleNoMatch = () => {
    const bound = requireFingerprint();
    if (!bound) return;
    void save({ type: "local-only", fingerprint: bound });
  };

  const handleRestoreAuto = () => {
    void save({ type: "auto" });
  };

  const handlePickCandidate = async (candidate: LocalLyricsCandidate) => {
    const bound = requireFingerprint();
    if (!bound || busy || !song) return;
    setBusy(true);
    try {
      const lines = await readLyricsCandidateLines(candidate);
      if (!lines.length) {
        Alert.alert("没取到歌词", `${candidate.sourceLabel} 这一条没能取到歌词，请换一条或稍后重试。`);
        return;
      }
      await setLocalSongLyricsChoice(
        { id: song.id, source: song.source },
        { type: "picked", fingerprint: bound, sourceLabel: candidate.sourceLabel, text: formatLyricsAsLrc(lines) },
      );
      onClose();
    } catch (failure) {
      Alert.alert("保存歌词选择失败", failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  const currentLabel = song ? formatLyricsChoiceLabel(song as LocalLyricsChoiceFields) : "";


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
          accessibilityLabel="关闭选择歌词面板"
        />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: palette.surface,
              maxHeight: windowHeight * 0.8,
              paddingBottom: Math.max(insets.bottom, spacing.m),
            },
          ]}
        >
          <View style={styles.handleContainer}>
            <View style={[styles.handle, { backgroundColor: palette.border }]} />
          </View>

          <View style={styles.header}>
            <View style={styles.headerTextWrap}>
              <Text style={[styles.title, { color: palette.text }]} numberOfLines={1}>选择歌词</Text>
              <Text style={[styles.subtitle, { color: palette.textMuted }]} numberOfLines={1}>
                {song?.name || ""} · 当前：{currentLabel}
              </Text>
            </View>
            <Touchable
              style={[styles.closeButton, { backgroundColor: palette.surfaceMuted }]}
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
            bounces={false}
          >
            {loading ? (
              <View style={styles.stateRow}>
                <ActivityIndicator color={palette.primary} size="small" />
                <Text style={[styles.stateText, { color: palette.textMuted }]}>正在查找可用的歌词…</Text>
              </View>
            ) : null}

            {!loading && error ? (
              <View style={[styles.errorCard, { borderColor: palette.border }]}>
                <Text style={[styles.errorText, { color: palette.danger }]}>候选搜索失败：{error}</Text>
                <Text style={[styles.stateText, { color: palette.textMuted }]}>
                  当前选择没有被改动；仍可「不要匹配」，或重试后再挑。
                </Text>
                <Touchable
                  style={[styles.retryButton, { borderColor: palette.border }]}
                  onPress={() => { void load(); }}
                  accessibilityRole="button"
                  accessibilityLabel="重试"
                >
                  <RotateCcw size={16} color={palette.primary} />
                  <Text style={[styles.retryText, { color: palette.primary }]}>重试</Text>
                </Touchable>
              </View>
            ) : null}

            {!loading && !error && candidates.length === 0 ? (
              <Text style={[styles.stateText, { color: palette.textMuted }]}>
                没有可用的候选：本地没有歌词，平台与 LRCLIB 也没有返回结果。
              </Text>
            ) : null}

            {!loading
              ? candidates.map((candidate) => {
                  const gap = formatDurationGap(candidate.durationDeltaSeconds);
                  const tier = candidate.tier ? TIER_LABELS[candidate.tier] : undefined;
                  return (
                    <Touchable
                      key={candidate.key}
                      style={[styles.item, { borderColor: palette.border }]}
                      activeScale={0.99}
                      activeOpacity={0.7}
                      disabled={busy}
                      onPress={() => {
                        hapticLight();
                        void handlePickCandidate(candidate);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`使用${candidate.sourceLabel}的歌词：${candidate.name}`}
                    >
                      <View style={styles.itemHeader}>
                        <Text style={[styles.sourceChip, { color: palette.primary, backgroundColor: withAlpha(palette.primary, 0.12) }]}>
                          {candidate.sourceLabel}
                        </Text>
                        {tier ? (
                          <Text style={[styles.tierChip, { color: palette.textMuted, backgroundColor: palette.surfaceMuted }]}>
                            {tier}
                          </Text>
                        ) : null}
                        {gap ? (
                          <Text style={[styles.gapText, { color: palette.textSubtle }]}>{gap}</Text>
                        ) : null}
                      </View>
                      <Text style={[styles.itemTitle, { color: palette.text }]} numberOfLines={1}>
                        {candidate.name}
                      </Text>
                      <Text style={[styles.itemMeta, { color: palette.textMuted }]} numberOfLines={1}>
                        {[candidate.singer, candidate.albumName].filter(Boolean).join(" · ")}
                      </Text>
                      <Text style={[styles.preview, { color: palette.textSubtle }]} numberOfLines={2}>
                        {candidate.preview ? `首行：${candidate.preview}` : "未预览到歌词（点选后获取）"}
                      </Text>
                    </Touchable>
                  );
                })
              : null}
          </ScrollView>

          <View style={[styles.actions, { borderTopColor: palette.border }]}>
            <Touchable
              style={[styles.action, { borderColor: palette.border }]}
              disabled={busy}
              onPress={() => {
                hapticLight();
                handleNoMatch();
              }}
              accessibilityRole="button"
              accessibilityLabel="不要匹配，只用本地歌词"
            >
              <CircleSlash size={16} color={palette.text} />
              <Text style={[styles.actionText, { color: palette.text }]}>不要匹配（只用本地歌词）</Text>
            </Touchable>
            <Touchable
              style={[styles.action, { borderColor: palette.border }]}
              disabled={busy}
              onPress={() => {
                hapticLight();
                handleRestoreAuto();
              }}
              accessibilityRole="button"
              accessibilityLabel="恢复自动匹配"
            >
              <Check size={16} color={palette.primary} />
              <Text style={[styles.actionText, { color: palette.primary }]}>恢复自动匹配</Text>
            </Touchable>
          </View>
        </View>
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
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  sheet: {
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
    paddingHorizontal: spacing.l,
    paddingBottom: spacing.s,
    gap: spacing.m,
  },
  headerTextWrap: {
    flex: 1,
    gap: 3,
  },
  title: {
    fontSize: typography.title,
    fontWeight: "700",
  },
  subtitle: {
    fontSize: typography.caption,
  },
  closeButton: {
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
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.xs,
    gap: spacing.xs,
  },
  stateRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.s,
    paddingVertical: spacing.l,
  },
  stateText: {
    fontSize: typography.caption,
    lineHeight: 18,
    paddingHorizontal: spacing.xs,
  },
  errorCard: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.m,
    gap: spacing.xs,
  },
  errorText: {
    fontSize: typography.body,
    fontWeight: "600",
  },
  retryButton: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.m,
    minHeight: touch.minTarget,
  },
  retryText: {
    fontSize: typography.body,
    fontWeight: "600",
  },
  item: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.s,
    gap: 3,
  },
  itemHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  sourceChip: {
    fontSize: typography.caption,
    fontWeight: "600",
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radius.sm,
    overflow: "hidden",
  },
  tierChip: {
    fontSize: typography.caption,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radius.sm,
    overflow: "hidden",
  },
  gapText: {
    fontSize: typography.caption,
  },
  itemTitle: {
    fontSize: typography.body,
    fontWeight: "600",
  },
  itemMeta: {
    fontSize: typography.caption,
  },
  preview: {
    fontSize: typography.caption,
  },
  actions: {
    flexDirection: "row",
    gap: spacing.s,
    paddingHorizontal: spacing.m,
    paddingTop: spacing.s,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  action: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    minHeight: touch.minTarget,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.xs,
  },
  actionText: {
    fontSize: typography.caption,
    fontWeight: "600",
  },
});
