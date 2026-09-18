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
  ListEnd,
  ListMusic,
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

export type ActionMenuIconKey =
  | "playNext"
  | "addToQueue"
  | "playlist"
  | "download"
  | "mv"
  | "share"
  | "edit"
  | "delete";

const ACTION_MENU_ICONS: Record<ActionMenuIconKey, LucideIcon> = {
  playNext: ListStart,
  addToQueue: ListEnd,
  playlist: ListMusic,
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

/** 触发按钮在窗口内的坐标（保持接口兼容） */
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

/**
 * 现代移动端歌曲更多操作抽屉（Bottom Action Sheet）：
 * - 顶部配有圆角拉手与当前歌曲概要（封面缩略图、歌名、歌手与专辑）；
 * - 底部舒适大触控热区（图标 + 文案），单手操作友好；
 * - 自动适配底部安全区域，点击遮罩快速关闭。
 */
export function ActionMenuSheet({
  visible,
  title,
  song,
  items,
  onClose,
}: ActionMenuSheetProps) {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const songName = song?.name || title || "";
  const songArtist = song?.singer || "";
  const songAlbum = song?.albumName || "";
  const subMeta = [songArtist, songAlbum].filter(Boolean).join(" · ");
  const artwork = song?.picUrl || song?.img;

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

          <View style={[styles.divider, { backgroundColor: palette.border }]} />

          {/* 菜单操作列表 */}
          <ScrollView
            style={styles.menuScroll}
            contentContainerStyle={styles.menuContent}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            {items.map((item, index) => {
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
                    styles.item,
                    item.danger && { backgroundColor: withAlpha(palette.danger, 0.04) },
                  ]}
                  disabled={item.disabled}
                  activeScale={0.99}
                  activeOpacity={0.65}
                  accessibilityRole="button"
                  accessibilityLabel={item.label}
                  accessibilityState={{ disabled: item.disabled }}
                  onPress={() => {
                    onClose();
                    item.onPress();
                  }}
                >
                  <View
                    style={[
                      styles.iconCircle,
                      {
                        backgroundColor: item.danger
                          ? withAlpha(palette.danger, 0.1)
                          : palette.surfaceMuted,
                      },
                    ]}
                  >
                    {Icon ? <Icon size={18} color={iconColor} /> : null}
                  </View>
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.itemLabel,
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
    marginBottom: spacing.xs,
  },
  menuScroll: {
    flexGrow: 0,
  },
  menuContent: {
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.xxs,
  },
  item: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.m,
    paddingHorizontal: spacing.m,
    borderRadius: radius.md,
    marginVertical: 1,
  },
  iconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: "center",
    alignItems: "center",
  },
  itemLabel: {
    fontSize: typography.body,
    fontWeight: "500",
    flex: 1,
  },
});
