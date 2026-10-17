import React from "react";
import {
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
import { Music2, Star } from "lucide-react-native";
import type { MusicInfo } from "@lx/core";
import { buildSongKey, getSongVariants, orderPlaybackCandidates, withSongVariants } from "@lx/core";

import { radius, spacing, typography } from "@/theme/tokens";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { Touchable } from "@/components/Touchable";
import { CachedImage } from "@/components/CachedImage";
import { withAlpha } from "@/services/themePaletteModel";
import { hapticLight } from "@/services/hapticService";
import { useVariantPinStore } from "@/stores/variantPinStore";
import { playQueue } from "@/services/playerService";

const SOURCE_LABELS: Record<string, string> = {
  wy: "网易云",
  tx: "QQ音乐",
  local: "本地",
};

function formatDuration(seconds?: number): string {
  if (!seconds || seconds <= 0) return "--:--";
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export interface VariantPickerSheetProps {
  song: MusicInfo | null;
  visible: boolean;
  onClose: () => void;
}

/**
 * 「其他版本」面板：列出同一首歌的跨源候选（主版本在前，其余按搜索匹配度排序）。
 * 点击条目即播放该版本；星标把版本记为「本机首选」，后续解析优先生效（不参与云同步）。
 */
export function VariantPickerSheet({ song, visible, onClose }: VariantPickerSheetProps) {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const groupKey = song ? buildSongKey(song) : "";
  const pinnedKey = useVariantPinStore((state) => (groupKey ? state.pins[groupKey] ?? null : null));
  const togglePinnedVariant = useVariantPinStore((state) => state.togglePinnedVariant);

  const variants = song ? getSongVariants(song) : [];
  const candidates = song ? orderPlaybackCandidates(song) : [];
  const artwork = song?.picUrl || song?.img;

  const handlePlay = (candidate: MusicInfo) => {
    hapticLight();
    onClose();
    // 选中版本作为新队列播单：其余变体随行进入解析链，后续自动兜底仍然可用
    playQueue([withSongVariants(candidate, variants)], 0).catch((error) => {
      Alert.alert("播放失败", error instanceof Error ? error.message : "所选版本暂时无法播放");
    });
  };

  const handleTogglePin = (candidate: MusicInfo) => {
    hapticLight();
    void togglePinnedVariant(groupKey, buildSongKey(candidate)).catch(() => undefined);
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
          accessibilityLabel="关闭菜单"
        />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: palette.surface,
              maxHeight: windowHeight * 0.75,
              paddingBottom: Math.max(insets.bottom, spacing.m),
            },
          ]}
        >
          <View style={styles.handleContainer}>
            <View style={[styles.handle, { backgroundColor: palette.border }]} />
          </View>

          {song ? (
            <View style={styles.header}>
              <View style={[styles.artworkWrap, { backgroundColor: palette.surfaceMuted }]}>
                {artwork ? (
                  <CachedImage
                    uri={artwork}
                    size={48}
                    style={styles.artwork}
                    fallback={
                      <View style={styles.artworkFallback}>
                        <Music2 size={20} color={palette.textMuted} />
                      </View>
                    }
                  />
                ) : (
                  <View style={styles.artworkFallback}>
                    <Music2 size={20} color={palette.textMuted} />
                  </View>
                )}
              </View>
              <View style={styles.headerTextWrap}>
                <Text style={[styles.songTitle, { color: palette.text }]} numberOfLines={1}>
                  {song.name}
                </Text>
                <Text style={[styles.songMeta, { color: palette.textMuted }]} numberOfLines={1}>
                  其他版本
                </Text>
              </View>
            </View>
          ) : null}

          <View style={[styles.divider, { backgroundColor: palette.border }]} />

          <ScrollView
            style={styles.listScroll}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            {candidates.map((candidate) => {
              const candidateKey = buildSongKey(candidate);
              const pinned = pinnedKey === candidateKey;
              return (
                <View key={candidateKey} style={styles.row}>
                  <Touchable
                    style={styles.rowMain}
                    activeScale={0.99}
                    activeOpacity={0.65}
                    accessibilityRole="button"
                    accessibilityLabel={`播放 ${candidate.name}`}
                    onPress={() => handlePlay(candidate)}
                  >
                    <View style={[styles.badge, { borderColor: palette.border }]}>
                      <Text style={[styles.badgeText, { color: palette.textMuted }]}>
                        {SOURCE_LABELS[candidate.source] ?? candidate.source}
                      </Text>
                    </View>
                    <View style={styles.rowText}>
                      <Text style={[styles.rowName, { color: palette.text }]} numberOfLines={1}>
                        {candidate.name}
                      </Text>
                      <Text style={[styles.rowMeta, { color: palette.textMuted }]} numberOfLines={1}>
                        {[candidate.singer?.trim(), formatDuration(candidate.interval)]
                          .filter(Boolean)
                          .join(" · ")}
                      </Text>
                    </View>
                  </Touchable>
                  <Touchable
                    style={styles.pinButton}
                    activeScale={0.9}
                    activeOpacity={0.65}
                    accessibilityRole="button"
                    accessibilityLabel={pinned ? `取消 ${candidate.name} 的本机首选` : `把 ${candidate.name} 设为本机首选`}
                    accessibilityState={{ selected: pinned }}
                    onPress={() => handleTogglePin(candidate)}
                  >
                    <Star
                      size={18}
                      color={pinned ? palette.primary : palette.textMuted}
                      fill={pinned ? palette.primary : "none"}
                    />
                  </Touchable>
                </View>
              );
            })}
          </ScrollView>

          <Text style={[styles.hint, { color: palette.textMuted }]}>
            星标记住本机首选版本，不参与云同步
          </Text>
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
    ...StyleSheet.absoluteFill,
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
  artworkWrap: {
    width: 46,
    height: 46,
    borderRadius: radius.sm,
    overflow: "hidden",
  },
  artwork: {
    width: "100%",
    height: "100%",
  },
  artworkFallback: {
    width: "100%",
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
  },
  headerTextWrap: {
    flex: 1,
    justifyContent: "center",
    gap: 3,
  },
  songTitle: {
    fontSize: typography.body,
    fontWeight: "700",
  },
  songMeta: {
    fontSize: typography.caption,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: spacing.l,
    marginBottom: spacing.xxs,
  },
  listScroll: {
    flexGrow: 0,
  },
  listContent: {
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.xxs,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
    marginVertical: 1,
  },
  rowMain: {
    flex: 1,
    minWidth: 0,
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s,
    paddingHorizontal: spacing.s,
    borderRadius: radius.md,
  },
  badge: {
    flexShrink: 0,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  badgeText: {
    fontSize: typography.caption - 1,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowName: {
    fontSize: typography.body,
    fontWeight: "500",
  },
  rowMeta: {
    marginTop: 1,
    fontSize: typography.caption,
  },
  pinButton: {
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: radius.md,
  },
  hint: {
    paddingHorizontal: spacing.l,
    paddingTop: spacing.xs,
    fontSize: typography.caption - 1,
  },
});
