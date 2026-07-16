import React from "react";
import { Animated, Pressable, type PressableProps, type StyleProp, type ViewStyle } from "react-native";

interface TouchableProps extends Omit<PressableProps, "style"> {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** 按下时缩放系数，1 = 不变。默认 0.97 */
  activeScale?: number;
  /** 按下时透明度，不传则不动透明度（仅缩放反馈） */
  activeOpacity?: number;
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

  return (
    <Pressable onPressIn={handleIn} onPressOut={handleOut} {...rest}>
      <Animated.View style={[style, { transform: [{ scale }], opacity }]}>{children}</Animated.View>
    </Pressable>
  );
}
