import React from "react";
import { View, Text, Pressable, Modal, StyleSheet } from "react-native";
import {
  Download,
  FolderPlus,
  Share2,
  ListMusic,
  Video,
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
  canAddToPlaylist?: boolean;
  onAddToPlaylist?: () => void;
  onOpenDownload?: () => void;
  onPlayMv?: () => void;
  canShare?: boolean;
  onShare?: () => void;
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
  onOpenQueue,
  queueLabel,
}: ImmersiveMoreMenuProps) {
  const menuItems = [
    {
      icon: Download,
      label: "下载",
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
          label: "分享",
          onPress: onShare,
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
                onClose();
                item.onPress?.();
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