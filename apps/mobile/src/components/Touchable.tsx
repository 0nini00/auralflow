import React from "react";
import {
  Animated,
  Pressable,
  type PressableProps,
  type StyleProp,
  StyleSheet,
  type ViewStyle,
} from "react-native";

interface TouchableProps extends Omit<PressableProps, "style"> {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** 按下时缩放系数，1 = 不变。默认 0.97 */
  activeScale?: number;
  /** 按下时透明度，不传则不动透明度（仅缩放反馈） */
  activeOpacity?: number;
}

/**
 * 布局类属性：这些必须作用在「外层 Pressable」上，
 * 否则 flex:1 / 固定宽高 / margin 等在父级 flex 布局中完全不生效
 * （内层 Animated.View 的 flex 只能填满 Pressable 自身，而 Pressable 没有尺寸约束时只占内容宽度）。
 */
const LAYOUT_PROPS = new Set([
  "flex",
  "flexGrow",
  "flexShrink",
  "flexBasis",
  "width",
  "height",
  "minWidth",
  "minHeight",
  "maxWidth",
  "maxHeight",
  "aspectRatio",
  "margin",
  "marginTop",
  "marginRight",
  "marginBottom",
  "marginLeft",
  "marginHorizontal",
  "marginVertical",
  "alignSelf",
  "position",
  "top",
  "right",
  "bottom",
  "left",
  "zIndex",
]);

/** 把 style 拆成两份：布局属性 → 外层 Pressable，其余视觉属性 → 内层 Animated.View。 */
function splitLayoutStyle(style: StyleProp<ViewStyle>): {
  layoutStyle: ViewStyle;
  visualStyle: ViewStyle;
} {
  const flat = StyleSheet.flatten(style) ?? {};
  const layoutStyle: ViewStyle = {};
  const visualStyle: ViewStyle = {};
  for (const [key, value] of Object.entries(flat)) {
    if (LAYOUT_PROPS.has(key)) {
      (layoutStyle as Record<string, unknown>)[key] = value;
    } else {
      (visualStyle as Record<string, unknown>)[key] = value;
    }
  }
  return { layoutStyle, visualStyle };
}

/**
 * 统一的按压反馈组件：替代各处裸 Pressable 的"点了没反应"。
 * 仅依赖 RN core 的 Animated，不引入 reanimated，保持依赖精简。
 * 父级需要 onLayout 测量时直接透传即可（挂在 Pressable 上，测量高度一致）。
 */
export function Touchable({
  children,
  style,
  activeScale = 0.97,
  activeOpacity,
  onPressIn,
  onPressOut,
  ...rest
}: TouchableProps) {
  const scale = React.useRef(new Animated.Value(1)).current;
  const opacity = React.useRef(new Animated.Value(1)).current;

  const { layoutStyle, visualStyle } = React.useMemo(
    () => splitLayoutStyle(style),
    [style],
  );

  const handleIn = (e: any) => {
    Animated.timing(scale, { toValue: activeScale, duration: 120, useNativeDriver: true }).start();
    if (activeOpacity != null) {
      Animated.timing(opacity, { toValue: activeOpacity, duration: 120, useNativeDriver: true }).start();
    }
    onPressIn?.(e);
  };

  const handleOut = (e: any) => {
    Animated.timing(scale, { toValue: 1, duration: 120, useNativeDriver: true }).start();
    if (activeOpacity != null) {
      Animated.timing(opacity, { toValue: 1, duration: 120, useNativeDriver: true }).start();
    }
    onPressOut?.(e);
  };

  // 仅当 style 含布局属性（flex/尺寸/margin/定位）时，内层才需要填满外层 Pressable；
  // 纯视觉样式（背景/圆角/内边距等）的用法保持原样，避免波及其它 16 处调用。
  const hasLayoutProps = Object.keys(layoutStyle).length > 0;

  return (
    <Pressable style={layoutStyle} onPressIn={handleIn} onPressOut={handleOut} {...rest}>
      <Animated.View
        style={
          hasLayoutProps
            ? [visualStyle, { flex: 1, alignSelf: "stretch", transform: [{ scale }], opacity }]
            : [visualStyle, { transform: [{ scale }], opacity }]
        }
      >
        {children}
      </Animated.View>
    </Pressable>
  );
}
