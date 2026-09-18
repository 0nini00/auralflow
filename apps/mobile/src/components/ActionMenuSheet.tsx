import React from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Download,
  FolderPlus,
  ListEnd,
  ListStart,
  Music2,
  Pencil,
  Share2,
  Trash2,
  Video,
  type LucideIcon,
} from "lucide-react-native";
import type { MusicInfo } from "@lx/core";

import { radius, spacing, typography } from "@/theme/tokens";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { Touchable } from "@/components/Touchable";
import { CachedImage } from "@/components/CachedImage";
import { withAlpha } from "@/services/themePaletteModel";
import { hapticLight } from "@/services/hapticService";

export type ActionMenuIconKey =
  | "playNext"
  | "addToQueue"
  | "playlist"
  | "download"
  | "mv"
  | "share"
  | "edit"
  | "delete";

// 收藏到歌单更换为现代通用的 FolderPlus 图标（文件夹加号）
const ACTION_MENU_ICONS: Record<ActionMenuIconKey, LucideIcon> = {
  playNext: ListStart,
  addToQueue: ListEnd,
  playlist: FolderPlus,
  download: Download,
  mv: Video,
  share: Share2,
  edit: Pencil,
  delete: Trash2,
};

export interface ActionMenuItem {
  label: string;
  icon?: ActionMenuIconKey;
  onPress: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export interface ActionMenuAnchor {
  x: number;
  y: number;
}

export interface ActionMenuSheetProps {
  visible: boolean;
  title?: string;
  song?: MusicInfo | null;
  items: ActionMenuItem[];
  anchor?: ActionMenuAnchor | null;
  onClose: () => void;
}

/** 核心高频动作图标集合（抽离到上方横排大圆钮栏） */
const PRIMARY_ACTION_KEYS = new Set<ActionMenuIconKey>([
  "playNext",
  "playlist",
  "download",
  "share",
]);

/** 精简高频动作的短标签 */
function getShortActionLabel(item: ActionMenuItem): string {
  if (item.icon === "playNext") return "下一首";
  if (item.icon === "playlist") return "收藏";
  if (item.icon === "download") {
    return item.label.includes("%") || item.label === "已下载" || item.label === "重试"
      ? item.label
      : "下载";
  }
  if (item.icon === "share") return "分享";
  return item.label;
}

/**
 * 现代移动端单曲操作抽屉：
 * - 顶部：歌曲封面 + 歌名 + 歌手专辑摘要；
 * - 中部：核心高频动作（下一首、收藏、下载、分享）采用横排圆形大功能键栏，去除冗余长文案，单手秒选；
 * - 下部：次要操作（播放 MV、从队列移除、编辑等）轻量单行平铺；
 * - 底部：安全区自适应避让。
 */
export function ActionMenuSheet({
  visible,
  title,
  song,
  items,
  onClose,
}: ActionMenuSheetProps) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();

  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  const songName = song?.name || title || "";
  const songArtist = song?.singer || "";
  const songAlbum = song?.albumName || "";
  const subMeta = [songArtist, songAlbum].filter(Boolean).join(" · ");
  const artwork = song?.picUrl || song?.img;

  // 将高频快捷动作与下方列表动作智能拆分
  const primaryItems = items.filter(
    (item) => item.icon && PRIMARY_ACTION_KEYS.has(item.icon),
  );
  const secondaryItems = items.filter(
    (item) => !item.icon || !PRIMARY_ACTION_KEYS.has(item.icon),
  );

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
              maxHeight: windowHeight * 0.78,
              paddingBottom: Math.max(insets.bottom, spacing.m),
            },
          ]}
        >
          {/* 顶部胶囊拉手 */}
          <View style={styles.handleContainer}>
            <View style={[styles.handle, { backgroundColor: palette.border }]} />
          </View>

          {/* 歌曲信息摘要头部 */}
          {songName ? (
            <View style={styles.header}>
              <View style={[styles.artworkWrap, { backgroundColor: palette.surfaceStrong }]}>
                {artwork ? (
                  <CachedImage
                    uri={artwork}
                    size={48}
                    style={styles.artwork}
                    fallback={
                      <View style={styles.artworkFallback}>
                        <Music2 size={22} color={palette.primary} />
                      </View>
                    }
                  />
                ) : (
                  <View style={styles.artworkFallback}>
                    <Music2 size={22} color={palette.primary} />
                  </View>
                )}
              </View>
              <View style={styles.headerTextWrap}>
                <Text style={[styles.songTitle, { color: palette.text }]} numberOfLines={1}>
                  {songName}
                </Text>
                {subMeta ? (
                  <Text style={[styles.songMeta, { color: palette.textMuted }]} numberOfLines={1}>
                    {subMeta}
                  </Text>
                ) : null}
              </View>
            </View>
          ) : null}

          {/* ── 核心高频动作横排圆形功能键栏（消除冗余文字行） ── */}
          {primaryItems.length > 0 ? (
            <View style={styles.quickActionsBar}>
              {primaryItems.map((item, index) => {
                const Icon = item.icon ? ACTION_MENU_ICONS[item.icon] : null;
                const disabled = item.disabled;
                const shortLabel = getShortActionLabel(item);

                return (
                  <Touchable
                    key={`${item.label}-${index}`}
                    style={styles.quickActionCell}
                    disabled={disabled}
                    activeScale={0.92}
                    onPress={() => {
                      hapticLight();
                      onClose();
                      item.onPress();
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={item.label}
                    accessibilityState={{ disabled }}
                  >
                    <View
                      style={[
                        styles.quickActionCircle,
                        {
                          backgroundColor: disabled
                            ? palette.surfaceMuted
                            : withAlpha(palette.primary, 0.1),
                        },
                      ]}
                    >
                      {Icon ? (
                        <Icon
                          size={21}
                          color={disabled ? palette.textSubtle : palette.primary}
                        />
                      ) : null}
                    </View>
                    <Text
                      style={[
                        styles.quickActionLabel,
                        { color: disabled ? palette.textSubtle : palette.text },
                      ]}
                      numberOfLines={1}
                    >
                      {shortLabel}
                    </Text>
                  </Touchable>
                );
              })}
            </View>
          ) : null}

          {/* 次要/高级操作列表（若存在） */}
          {secondaryItems.length > 0 ? (
            <>
              <View style={[styles.divider, { backgroundColor: palette.border }]} />
              <ScrollView
                style={styles.menuScroll}
                contentContainerStyle={styles.menuContent}
                showsVerticalScrollIndicator={false}
                bounces={false}
              >
                {secondaryItems.map((item, index) => {
                  const Icon = item.icon ? ACTION_MENU_ICONS[item.icon] : null;
                  const iconColor = item.disabled
                    ? palette.textMuted
                    : item.danger
                    ? palette.danger
                    : palette.text;

                  return (
                    <Touchable
                      key={`${item.label}-${index}`}
                      style={[
                        styles.secondaryItem,
                        item.danger && { backgroundColor: withAlpha(palette.danger, 0.04) },
                      ]}
                      disabled={item.disabled}
                      activeScale={0.98}
                      onPress={() => {
                        hapticLight();
                        onClose();
                        item.onPress();
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={item.label}
                      accessibilityState={{ disabled: item.disabled }}
                    >
                      <View
                        style={[
                          styles.secondaryIconCircle,
                          {
                            backgroundColor: item.danger
                              ? withAlpha(palette.danger, 0.1)
                              : palette.surfaceMuted,
                          },
                        ]}
                      >
                        {Icon ? <Icon size={17} color={iconColor} /> : null}
                      </View>
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.secondaryItemLabel,
                          { color: palette.text },
                          item.danger && { color: palette.danger, fontWeight: "600" },
                          item.disabled && { color: palette.textMuted },
                        ]}
                      >
                        {item.label}
                      </Text>
                    </Touchable>
                  );
                })}
              </ScrollView>
            </>
          ) : null}
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
    width: 48,
    height: 48,
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
  quickActionsBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    paddingHorizontal: spacing.m,
    paddingTop: spacing.m,
    paddingBottom: spacing.s,
  },
  quickActionCell: {
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minWidth: 64,
  },
  quickActionCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
  },
  quickActionLabel: {
    fontSize: 11.5,
    fontWeight: "500",
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: spacing.l,
    marginVertical: spacing.xs,
    opacity: 0.7,
  },
  menuScroll: {
    flexGrow: 0,
  },
  menuContent: {
    paddingHorizontal: spacing.m,
    paddingBottom: spacing.xs,
  },
  secondaryItem: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.m,
    paddingHorizontal: spacing.m,
    borderRadius: radius.md,
    marginVertical: 1,
  },
  secondaryIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  secondaryItemLabel: {
    fontSize: typography.body,
    fontWeight: "500",
    flex: 1,
  },
});
