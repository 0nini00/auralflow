import { Modal, Pressable, StyleSheet, Text } from "react-native";
import {
  Download,
  ListEnd,
  ListMusic,
  ListStart,
  Pencil,
  Share2,
  Trash2,
  type LucideIcon,
} from "lucide-react-native";

import { radius, typography } from "@/theme/tokens";

import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { Touchable } from "@/components/Touchable";

export type ActionMenuIconKey =
  | "playNext"
  | "addToQueue"
  | "playlist"
  | "download"
  | "share"
  | "edit"
  | "delete";

const ACTION_MENU_ICONS: Record<ActionMenuIconKey, LucideIcon> = {
  playNext: ListStart,
  addToQueue: ListEnd,
  playlist: ListMusic,
  download: Download,
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

interface ActionMenuSheetProps {
  visible: boolean;
  title?: string;
  items: ActionMenuItem[];
  onClose: () => void;
}

/**
 * 统一的底部操作菜单。歌曲行把「下载 / 下一首播放 / 收藏到歌单 / 分享 / 编辑 / 删除」
 * 等次要操作收进这里，避免行内按键过多溢出，并保持所有歌曲列表的 UI 一致。
 */
export function ActionMenuSheet({ visible, title, items, onClose }: ActionMenuSheetProps) {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: palette.surface }]} onPress={() => {}}>
          {title ? (
            <Text style={[styles.title, { color: palette.textMuted }]} numberOfLines={1}>
              {title}
            </Text>
          ) : null}
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
                style={[styles.item, index === 0 && styles.itemFirst]}
                disabled={item.disabled}
                activeScale={1}
                activeOpacity={0.55}
                accessibilityRole="button"
                accessibilityLabel={item.label}
                accessibilityState={{ disabled: item.disabled }}
                onPress={() => {
                  item.onPress();
                  onClose();
                }}
              >
                {Icon ? (
                  <Icon style={styles.itemIcon} size={22} color={iconColor} />
                ) : null}
                <Text
                  style={[
                    styles.itemLabel,
                    { color: palette.text },
                    item.danger && { color: palette.danger },
                    item.disabled && { color: palette.textMuted },
                  ]}
                >
                  {item.label}
                </Text>
              </Touchable>
            );
          })}
          <Touchable
            style={[styles.cancel, { backgroundColor: palette.surfaceStrong }]}
            activeScale={1}
            activeOpacity={0.55}
            onPress={onClose}
          >
            <Text style={[styles.cancelText, { color: palette.text }]}>取消</Text>
          </Touchable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 12,
    paddingBottom: 24,
    gap: 4,
  },
  title: {
    fontSize: typography.meta,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: radius.md,
  },
  itemFirst: {
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
  },
  itemIcon: {
    width: 22,
  },
  itemLabel: {
    fontSize: typography.title,
    fontWeight: "500",
  },
  cancel: {
    marginTop: 8,
    paddingVertical: 14,
    borderRadius: radius.md,
    alignItems: "center",
  },
  cancelText: {
    fontSize: typography.title,
    fontWeight: "600",
  },
});
