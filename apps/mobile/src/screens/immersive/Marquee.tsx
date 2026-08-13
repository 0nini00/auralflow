import React, { useRef, useEffect, useState } from "react";
import { Animated, Easing, Text, View, type LayoutChangeEvent, type StyleProp, type TextStyle } from "react-native";

export interface MarqueeProps {
  text: string;
  width: number;
  style?: StyleProp<TextStyle>;
  duration?: number;
  pauseDuration?: number;
}

/**
 * 超长文本跑马灯：文本宽度超过容器时滚动，否则静止。
 * 对齐 lx Marquee：只渲染一份文本，用 translateX 滚出后瞬移归位循环；
 * 文本不超长时始终只显示一份（修复短标题显示两次的问题）。
 */
export function Marquee({
  text,
  width,
  style,
  duration = 6000,
  pauseDuration = 1200,
}: MarqueeProps) {
  const translateX = useRef(new Animated.Value(0)).current;
  const textWidthRef = useRef(0);
  const containerWidthRef = useRef(0);
  const [scrolling, setScrolling] = useState(false);

  const onTextLayout = (e: LayoutChangeEvent) => {
    textWidthRef.current = e.nativeEvent.layout.width;
    setScrolling(textWidthRef.current > containerWidthRef.current);
  };

  const onContainerLayout = (e: LayoutChangeEvent) => {
    containerWidthRef.current = e.nativeEvent.layout.width;
    // 容器宽度变化（如标题区变宽）后重新评估是否滚动，避免 stale 状态
    setScrolling(textWidthRef.current > containerWidthRef.current);
  };

  useEffect(() => {
    if (!scrolling || containerWidthRef.current <= 0) return;
    const distance = textWidthRef.current - containerWidthRef.current + 40; // 40 = 首尾间隔
    if (distance <= 0) return;
    translateX.setValue(0);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(translateX, {
          toValue: -distance,
          duration,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.timing(translateX, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
        Animated.delay(pauseDuration),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [scrolling, text, width, duration, pauseDuration, translateX]);

  return (
    <View style={{ width, overflow: "hidden" }} onLayout={onContainerLayout}>
      <Animated.View style={{ transform: [{ translateX }] }}>
        <Text
          style={style}
          numberOfLines={1}
          onLayout={onTextLayout}
          accessible={false}
        >
          {text}
        </Text>
      </Animated.View>
    </View>
  );
}
