import React from "react";
import { View, Text, Pressable, Modal, StyleSheet } from "react-native";
import {
  Heart,
  FolderPlus,
  Share2,
  Volume2,
  VolumeX,
  Timer,
  ListMusic,
  Languages,
  Image,
  Sliders,
  Gauge,
} from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import type { ThemePalette } from "@/stores/themeStore";

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
  // 功能按钮
  canLike?: boolean;
  isLiked?: boolean;
  onLike?: () => void;
  canAddToPlaylist?: boolean;
  onAddToPlaylist?: () => void;
  canShare?: boolean;
  onShare?: () => void;
  onOpenVolume?: () => void;
  volumeMuted?: boolean;
  onOpenSleep?: () => void;
  sleepLabel?: string;
  sleepActive?: boolean;
  onOpenQueue?: () => void;
  queueLabel?: string;
  onToggleTranslation?: () => void;
  translationActive?: boolean;
  onToggleChineseConversion?: () => void;
  chineseConversionActive?: boolean;
  chineseConversionLabel?: string;
  onTogglePosterMode?: () => void;
  posterMode?: boolean;
  onOpenSoundEffect?: () => void;
  rateLabel?: string;
  onOpenRate?: () => void;
}

export function ImmersiveMoreMenu({
  visible,
  onClose,
  palette,
  canLike,
  isLiked,
  onLike,
  canAddToPlaylist,
  onAddToPlaylist,
  canShare,
  onShare,
  onOpenVolume,
  volumeMuted,
  onOpenSleep,
  sleepLabel,
  sleepActive,
  onOpenQueue,
  queueLabel,
  onToggleTranslation,
  translationActive,
  onToggleChineseConversion,
  chineseConversionActive,
  chineseConversionLabel,
  onTogglePosterMode,
  posterMode,
  onOpenSoundEffect,
  rateLabel,
  onOpenRate,
}: ImmersiveMoreMenuProps) {
  const menuItems = [
    canLike
      ? {
          icon: Heart,
          label: isLiked ? "取消喜欢" : "喜欢",
          onPress: onLike,
          active: isLiked,
        }
      : undefined,
    canAddToPlaylist
      ? {
          icon: FolderPlus,
          label: "加入歌单",
          onPress: onAddToPlaylist,
        }
      : undefined,
    canShare
      ? {
          icon: Share2,
          label: "分享",
          onPress: onShare,
        }
      : undefined,
    {
      icon: volumeMuted ? VolumeX : Volume2,
      label: "音量",
      onPress: onOpenVolume,
    },
    {
      icon: Timer,
      label: sleepLabel || "睡眠定时",
      onPress: onOpenSleep,
      active: sleepActive,
    },
    {
      icon: ListMusic,
      label: queueLabel || "播放列表",
      onPress: onOpenQueue,
    },
    {
      icon: Languages,
      label: "翻译",
      onPress: onToggleTranslation,
      active: translationActive,
    },
    {
      icon: Languages,
      label: chineseConversionLabel || "简繁",
      onPress: onToggleChineseConversion,
      active: chineseConversionActive,
    },
    {
      icon: Image,
      label: posterMode ? "关闭海报" : "海报模式",
      onPress: onTogglePosterMode,
      active: posterMode,
    },
    {
      icon: Sliders,
      label: "音效",
      onPress: onOpenSoundEffect,
    },
    {
      icon: Gauge,
      label: rateLabel || "倍速",
      onPress: onOpenRate,
    },
  ].filter(Boolean) as MenuItem[];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.overlay} onPress={onClose}>
        <View
          style={[
            styles.menu,
            { backgroundColor: palette.surface, borderColor: palette.border },
          ]}
        >
          {menuItems.map((item, index) => (
            <Pressable
              key={index}
              style={[
                styles.menuItem,
                item.active && { backgroundColor: palette.surfaceStrong },
              ]}
              onPress={() => {
                item.onPress?.();
                onClose();
              }}
            >
              <item.icon size={20} color={item.active ? palette.primary : palette.text} />
              <Text
                style={[
                  styles.menuItemText,
                  { color: item.active ? palette.primary : palette.text },
                ]}
              >
                {item.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  menu: {
    width: "80%",
    maxWidth: 300,
    borderRadius: 12,
    borderWidth: 1,
    padding: 8,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 8,
  },
  menuItemText: {
    marginLeft: 12,
    fontSize: 16,
  },
});
