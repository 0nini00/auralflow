import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import type { LucideIcon } from "lucide-react-native";
import { X } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ThemePalette } from "@/stores/themeStore";
import { sheet } from "@/theme/sheetTokens";
import { spacing, typography } from "@/theme/tokens";
import { Touchable } from "@/components/Touchable";

export interface SheetFrameProps {
  visible: boolean;
  onClose: () => void;
  palette: ThemePalette;
  title: string;
  /** 标题下的一行说明，保持单行以内 */
  subtitle?: string;
  icon?: LucideIcon;
  /** 关闭按钮的无障碍文案，默认「关闭」 */
  closeLabel?: string;
  /** 面板最大高度占屏幕比例，默认 0.78 */
  maxHeightRatio?: number;
  /** 内容自行滚动时传 false，默认由容器滚动 */
  scroll?: boolean;
  /** 面板含输入框时开启键盘避让 */
  keyboard?: boolean;
  children: React.ReactNode;
}

/**
 * 底部弹层的统一外壳：遮罩、圆角、拉手、标题行、安全区、进出场动画。
 *
 * 之前每个弹层各自写一遍 Modal + 遮罩 + 面板，出现了 fade / slide / none
 * 三种出场方式和 16 / 20 两种圆角，同一个 app 里的弹层看起来不像一套东西。
 * 这里收成一处，业务内容只负责填 children。
 */
export function SheetFrame({
  visible,
  onClose,
  palette,
  title,
  subtitle,
  icon: Icon,
  closeLabel = "关闭",
  maxHeightRatio = 0.78,
  scroll = true,
  keyboard = false,
  children,
}: SheetFrameProps) {
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const progress = useRef(new Animated.Value(visible ? 1 : 0)).current;
  // 退场动画回调里判断是否仍处于关闭态，快速重开时不要把面板卸载掉。
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.timing(progress, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
      return;
    }
    if (!mounted) return;
    Animated.timing(progress, {
      toValue: 0,
      duration: 160,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && !visibleRef.current) setMounted(false);
    });
  }, [visible, mounted, progress]);

  if (!mounted) return null;

  const scrimStyle = {
    opacity: progress,
  };
  const panelStyle = {
    transform: [
      {
        translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [32, 0] }),
      },
    ],
  };

  const panel = (
        <Animated.View
          style={[
            styles.panel,
            {
              maxHeight: windowHeight * maxHeightRatio,
              backgroundColor: palette.surface,
              borderTopColor: palette.border,
              paddingBottom: Math.max(insets.bottom, sheet.bottomInsetMin),
            },
            panelStyle,
          ]}
        >
          <View style={styles.handleWrap}>
            <View style={[styles.handle, { backgroundColor: palette.border }]} />
          </View>

          <View style={styles.header}>
            <View style={styles.titleGroup}>
              <View style={styles.titleRow}>
                {Icon ? <Icon size={17} color={palette.primaryInk} /> : null}
                <Text style={[styles.title, { color: palette.text }]} numberOfLines={1}>
                  {title}
                </Text>
              </View>
              {subtitle ? (
                <Text style={[styles.subtitle, { color: palette.textMuted }]} numberOfLines={1}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
            <Touchable
              style={[styles.close, { backgroundColor: palette.surfaceMuted }]}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={closeLabel}
              hitSlop={8}
            >
              <X size={16} color={palette.textMuted} />
            </Touchable>
          </View>

          {scroll ? (
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {children}
            </ScrollView>
          ) : (
            children
          )}
        </Animated.View>
  );

  return (
    <Modal
      visible={mounted}
      transparent
      statusBarTranslucent
      animationType="none"
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <Animated.View style={[styles.scrim, scrimStyle]}>
          <Pressable
            style={styles.scrimTouch}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="关闭弹层"
          />
        </Animated.View>
        {keyboard ? (
          <KeyboardAvoidingView
            pointerEvents="box-none"
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={styles.keyboard}
          >
            {panel}
          </KeyboardAvoidingView>
        ) : panel}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  scrim: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: sheet.scrim },
  scrimTouch: { flex: 1 },
  panel: {
    width: "100%",
    borderTopLeftRadius: sheet.radius,
    borderTopRightRadius: sheet.radius,
    borderTopWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  handleWrap: { alignItems: "center", paddingVertical: sheet.handlePaddingVertical },
  handle: {
    width: sheet.handleWidth,
    height: sheet.handleHeight,
    borderRadius: sheet.handleRadius,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.s,
    paddingHorizontal: spacing.l,
    paddingBottom: spacing.s,
  },
  titleGroup: { flex: 1, gap: 2 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  title: { fontSize: typography.title, fontWeight: "700" },
  subtitle: { fontSize: typography.caption },
  close: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  keyboard: { flex: 1, justifyContent: "flex-end" },
  scroll: { flexGrow: 0 },
  scrollContent: { paddingHorizontal: spacing.l, paddingTop: spacing.xxs, paddingBottom: spacing.s },
});
