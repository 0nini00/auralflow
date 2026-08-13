import { Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Download,
  ListEnd,
  ListMusic,
  ListStart,
  Pencil,
  Share2,
  Trash2,
  Video,
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

/** 触发按钮在窗口内的坐标（lx ListMenu 用 measure 获取，这里用点击点 pageX/pageY） */
export interface ActionMenuAnchor {
  x: number;
  y: number;
}

interface ActionMenuSheetProps {
  visible: boolean;
  title?: string;
  items: ActionMenuItem[];
  anchor: ActionMenuAnchor | null;
  onClose: () => void;
}

const ITEM_HEIGHT = 44;
const MENU_WIDTH = 212;
const SCREEN_EDGE_GAP = 8;
const ANCHOR_GAP = 6;

/**
 * 对齐 lx 的 ListMenu：锚定在触发按钮/点击点附近的弹出菜单，
 * 自动判断下方/上方、靠左/靠右，避免全宽白色底部弹层。
 */
export function ActionMenuSheet({ visible, title, items, anchor, onClose }: ActionMenuSheetProps) {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const titleHeight = title ? 36 : 0;
  const menuHeight = Math.min(
    titleHeight + items.length * ITEM_HEIGHT + 16,
    windowHeight - insets.top - insets.bottom - 24,
  );

  const position = (() => {
    if (!anchor) {
      // 兜底：无锚点时水平居中于底部上方
      return {
        left: Math.max(SCREEN_EDGE_GAP, (windowWidth - MENU_WIDTH) / 2),
        top: Math.max(insets.top + SCREEN_EDGE_GAP, windowHeight - insets.bottom - menuHeight - 48),
      };
    }
    let top = anchor.y + ANCHOR_GAP;
    if (top + menuHeight > windowHeight - insets.bottom - SCREEN_EDGE_GAP) {
      top = anchor.y - menuHeight - ANCHOR_GAP;
    }
    top = Math.max(insets.top + SCREEN_EDGE_GAP, Math.min(top, windowHeight - insets.bottom - menuHeight - SCREEN_EDGE_GAP));

    let left = anchor.x;
    if (left + MENU_WIDTH > windowWidth - SCREEN_EDGE_GAP) {
      left = Math.max(SCREEN_EDGE_GAP, windowWidth - MENU_WIDTH - SCREEN_EDGE_GAP);
    }
    left = Math.min(left, windowWidth - MENU_WIDTH - SCREEN_EDGE_GAP);
    return { left, top };
  })();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View
          style={[
            styles.menu,
            {
              backgroundColor: palette.surface,
              left: position.left,
              top: position.top,
              width: MENU_WIDTH,
            },
          ]}
        >
          {title ? (
            <Text style={[styles.title, { color: palette.textMuted }]} numberOfLines={1}>
              {title}
            </Text>
          ) : null}
          <View>
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
                  style={styles.item}
                  disabled={item.disabled}
                  activeScale={1}
                  activeOpacity={0.55}
                  accessibilityRole="button"
                  accessibilityLabel={item.label}
                  accessibilityState={{ disabled: item.disabled }}
                  onPress={() => {
                    onClose();
                    item.onPress();
                  }}
                >
                  {Icon ? <Icon size={18} color={iconColor} style={styles.itemIcon} /> : null}
                  <Text
                    numberOfLines={1}
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
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  menu: {
    position: "absolute",
    borderRadius: radius.md,
    paddingVertical: 8,
    paddingHorizontal: 6,
    elevation: 6,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  title: {
    fontSize: typography.caption,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  item: {
    minHeight: ITEM_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 10,
    borderRadius: radius.sm,
  },
  itemIcon: {
    width: 18,
  },
  itemLabel: {
    fontSize: typography.body,
    fontWeight: "500",
  },
});
