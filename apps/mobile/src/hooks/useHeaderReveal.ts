import { useCallback, useRef } from "react";
import { Animated, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";

/** 标题栏浮出的滚动阈值（与旧插值 inputRange 的上界一致）。 */
const REVEAL_THRESHOLD = 132;

/**
 * 详情页吸顶头的显隐驱动。
 *
 * 旧实现用 Animated.event 把 contentOffset 逐帧写进 Animated.Value（JS 驱动），
 * 滚动期间每 16ms 一次 setValue。这里只做阈值比较：跨过阈值时才起一段原生动画，
 * JS 线程成本从「每帧一次」降到「每次跨越一次」。
 */
export function useHeaderReveal(): {
  reveal: Animated.Value;
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
} {
  const reveal = useRef(new Animated.Value(0)).current;
  const targetRef = useRef(0);

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = event.nativeEvent.contentOffset.y >= REVEAL_THRESHOLD ? 1 : 0;
      if (next === targetRef.current) return;
      targetRef.current = next;
      Animated.timing(reveal, { toValue: next, duration: 140, useNativeDriver: true }).start();
    },
    [reveal],
  );

  return { reveal, onScroll };
}
