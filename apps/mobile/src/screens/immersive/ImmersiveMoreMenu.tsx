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
  ListMusic,
  MoreHorizontal,
  Share2,
  Sparkles,
  Video,
  X,
  type LucideIcon,
} from "lucide-react-native";
import { Touchable } from "@/components/Touchable";
import type { ThemePalette } from "@/stores/themeStore";
import { radius, spacing, typography } from "@/theme/tokens";
import { withAlpha } from "@/services/themePaletteModel";
import { hapticLight } from "@/services/hapticService";

interface MenuItem {
  icon: LucideIcon;
  label: string;
  onPress?: () => void;
  active?: boolean;
}

export interface ImmersiveMoreMenuProps {
  visible: boolean;
  onClose: () => void;
  palette: ThemePalette;
  canAddToPlaylist?: boolean;
  onAddToPlaylist?: () => void;
  onOpenDownload?: () => void;
  onPlayMv?: () => void;
  canShare?: boolean;
  onShare?: () => void;
  canShowSimilarSongs?: boolean;
  onOpenSimilarSongs?: () => void;
  onOpenQueue?: () => void;
  queueLabel?: string;
}

export function ImmersiveMoreMenu({
  visible,
  onClose,
  palette,
  canAddToPlaylist,
  onAddToPlaylist,
  onOpenDownload,
  onPlayMv,
  canShare,
  onShare,
  canShowSimilarSongs,
  onOpenSimilarSongs,
  onOpenQueue,
  queueLabel,
}: ImmersiveMoreMenuProps) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();

  const menuItems = [
    {
      icon: Download,
      label: "下载歌曲",
      onPress: onOpenDownload,
    },
    canAddToPlaylist
      ? {
          icon: FolderPlus,
          label: "添加到歌单",
          onPress: onAddToPlaylist,
        }
      : undefined,
    onPlayMv
      ? {
          icon: Video,
          label: "播放 MV",
          onPress: onPlayMv,
        }
      : undefined,
    canShare
      ? {
          icon: Share2,
          label: "分享音乐",
          onPress: onShare,
        }
      : undefined,
    canShowSimilarSongs
      ? {
          icon: Sparkles,
          label: "相似歌曲推荐",
          onPress: onOpenSimilarSongs,
        }
      : undefined,
    {
      icon: ListMusic,
      label: queueLabel || "播放列表",
      onPress: onOpenQueue,
    },
  ].filter(Boolean) as MenuItem[];

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
          accessibilityLabel="关闭更多菜单"
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

          {/* 标题栏 */}
          <View style={styles.header}>
            <View style={styles.titleWithIcon}>
              <MoreHorizontal size={18} color={palette.primary} />
              <Text style={[styles.title, { color: palette.text }]}>更多选项</Text>
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

          {/* 选项列表 */}
          <ScrollView
            style={styles.scrollArea}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            {menuItems.map((item, index) => (
              <Touchable
                key={index}
                style={[
                  styles.item,
                  item.active && { backgroundColor: withAlpha(palette.primary, 0.08) },
                ]}
                activeScale={0.99}
                activeOpacity={0.65}
                onPress={() => {
                  hapticLight();
                  onClose();
                  item.onPress?.();
                }}
                accessibilityRole="button"
                accessibilityLabel={item.label}
              >
                <View
                  style={[
                    styles.iconCircle,
                    {
                      backgroundColor: item.active
                        ? withAlpha(palette.primary, 0.14)
                        : palette.surfaceMuted,
                    },
                  ]}
                >
                  <item.icon
                    size={18}
                    color={item.active ? palette.primary : palette.text}
                  />
                </View>
                <Text
                  style={[
                    styles.itemLabel,
                    { color: item.active ? palette.primary : palette.text },
                  ]}
                >
                  {item.label}
                </Text>
              </Touchable>
            ))}
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
    justifyContent: "space-between",
    paddingHorizontal: spacing.l,
    paddingBottom: spacing.s,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(0, 0, 0, 0.06)",
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
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.s,
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
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  itemLabel: {
    fontSize: typography.body,
    fontWeight: "500",
    flex: 1,
  },
});
