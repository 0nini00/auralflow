import React, { useEffect, useRef, useMemo, useCallback, useState } from "react";
import {
  Animated,
  FlatList,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewStyle,
  type TextStyle,
  type StyleProp,
} from "react-native";
import type { LyricLine } from "@lx/core";
import type { ThemePalette } from "@/stores/themeStore";
import { useLyricSettingsStore, LYRIC_FONT_SIZE_MIN, LYRIC_FONT_SIZE_MAX } from "@/stores/lyricSettingsStore";
import {
  buildLyricAnimationModel,
  buildLyricTypographyStyleModel,
} from "@/services/lyricSettingsModel";
import {
  convertChineseText,
  type ChineseConversionMode,
} from "@/services/chineseConversionService";

export interface LyricViewProps {
  lyrics: LyricLine[];
  /** 当前高亮歌词行索引，无匹配时为 -1 */
  currentLineIndex: number;
  /** 是否显示译文 */
  showTranslation: boolean;
  /** 主题调色板 */
  palette: ThemePalette;
  /** 点击歌词行定位到对应时间点（seek） */
  onSeek?: (time: number) => void;
  /** 容器样式 */
  style?: StyleProp<ViewStyle>;
}

// 未测量行高的兜底估算（首次渲染 / 行高尚未 onLayout 时用于滚动偏移计算，对齐 lx 的动态行高方案）
const FALLBACK_ITEM_HEIGHT = 68;
// 上下各填充几行空白，让当前歌词始终显示在列表中间
const SPACING_ROWS = 4;
const AnimatedView = Animated.createAnimatedComponent(View);

/** easeInOutQuad 缓动（对齐 lx utils/scroll.ts）。 */
function easeInOutQuad(t: number, b: number, c: number, d: number): number {
  t /= d / 2;
  if (t < 1) return (c / 2) * t * t + b;
  t -= 1;
  return (-c / 2) * (t * (t - 2) - 1) + b;
}

/**
 * 平滑滚动到指定偏移（对齐 lx scrollTo：10ms 步进 + easeInOutQuad 缓动 + scrollToOffset animated:false）。
 * 返回取消函数；新滚动 / 用户拖动时调用取消，避免动画与新目标打架。
 */
function smoothScrollToOffset(
  list: FlatList<LyricLine> | null,
  info: NativeSyntheticEvent<NativeScrollEvent>["nativeEvent"] | null,
  to: number,
  duration: number,
  onDone?: () => void,
): () => void {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  if (list == null || info == null) {
    onDone?.();
    return () => undefined;
  }

  let start = info.contentOffset.y;
  if (to > start) {
    const maxScrollTop = Math.max(0, info.contentSize.height - info.layoutMeasurement.height);
    if (to > maxScrollTop) to = maxScrollTop;
  } else if (to < start) {
    if (to < 0) to = 0;
  } else {
    onDone?.();
    return () => undefined;
  }

  const change = to - start;
  const increment = 10;
  let currentTime = 0;

  const step = () => {
    if (cancelled) return;
    timer = null;
    currentTime += increment;
    const val = Math.trunc(easeInOutQuad(currentTime, start, change, duration));
    list?.scrollToOffset({ offset: val, animated: false });
    if (currentTime < duration) {
      timer = setTimeout(step, increment);
    } else {
      onDone?.();
    }
  };

  step();
  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
    timer = null;
  };
}

export function LyricView({
  lyrics,
  currentLineIndex,
  showTranslation: showTranslationProp,
  palette,
  onSeek,
  style,
}: LyricViewProps) {
  const listRef = useRef<FlatList<LyricLine>>(null);

  // 从 store 读取歌词显示设置（字号/颜色/行距/对齐/字重/透明度/动画等）
  const fontSize = useLyricSettingsStore((s) => s.fontSize);
  const storeShowTranslation = useLyricSettingsStore((s) => s.showTranslation);
  const activeColorSetting = useLyricSettingsStore((s) => s.activeColor);
  const inactiveColorSetting = useLyricSettingsStore((s) => s.inactiveColor);
  const lineGap = useLyricSettingsStore((s) => s.lineGap);
  const fontFamily = useLyricSettingsStore((s) => s.fontFamily);
  const textAlign = useLyricSettingsStore((s) => s.textAlign);
  const fontWeight = useLyricSettingsStore((s) => s.fontWeight);
  const textOpacity = useLyricSettingsStore((s) => s.textOpacity);
  const enableAnimation = useLyricSettingsStore((s) => s.enableAnimation);
  const animationIntensity = useLyricSettingsStore((s) => s.animationIntensity);

  const chineseConversion = useLyricSettingsStore((s) => s.chineseConversion);

  const setStoreFontSize = useLyricSettingsStore((s) => s.setFontSize);

  // 捏合缩放：先用本地 state 即时更新字号，松手后再写入 store
  const [localFontSize, setLocalFontSize] = useState(fontSize);
  const localFontSizeRef = useRef(fontSize);

  // store 字号变化（设置页修改）时同步本地值
  useEffect(() => {
    setLocalFontSize(fontSize);
    localFontSizeRef.current = fontSize;
  }, [fontSize]);

  // 捏合手势：仅双指触控生效，避免与 FlatList 纵向滚动冲突
  const pinchStartDistRef = useRef(0);
  const pinchStartFontSizeRef = useRef(16);
  const isPinchingRef = useRef(false);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return gestureState.numberActiveTouches === 2;
      },
      onPanResponderGrant: () => {},
      onPanResponderMove: (evt, gestureState) => {
        if (gestureState.numberActiveTouches < 2) return;
        const touches = evt.nativeEvent.touches;
        if (touches.length < 2) return;

        const dx = touches[0].pageX - touches[1].pageX;
        const dy = touches[0].pageY - touches[1].pageY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (!isPinchingRef.current) {
          isPinchingRef.current = true;
          pinchStartDistRef.current = dist;
          pinchStartFontSizeRef.current = localFontSizeRef.current;
          return;
        }

        const scale = dist / pinchStartDistRef.current;
        const newSize = Math.round(pinchStartFontSizeRef.current * scale);
        const clamped = Math.max(LYRIC_FONT_SIZE_MIN, Math.min(LYRIC_FONT_SIZE_MAX, newSize));
        setLocalFontSize(clamped);
        localFontSizeRef.current = clamped;
      },
      onPanResponderRelease: () => {
        if (isPinchingRef.current) {
          setStoreFontSize(localFontSizeRef.current);
          isPinchingRef.current = false;
        }
      },
      onPanResponderTerminate: () => {
        if (isPinchingRef.current) {
          setStoreFontSize(localFontSizeRef.current);
          isPinchingRef.current = false;
        }
      },
    })
  ).current;

  // 译文开关：页面级 prop 与 store 设置同时生效
  const showTranslation = showTranslationProp && storeShowTranslation;

  // 在歌词数组上下各插入空白行，用于居中显示当前行
  const data = useMemo<LyricLine[]>(() => {
    if (lyrics.length === 0) return [];
    const spacer: LyricLine = { time: -1, text: "" };
    return [...Array(SPACING_ROWS).fill(spacer), ...lyrics, ...Array(SPACING_ROWS).fill(spacer)];
  }, [lyrics]);

  // 高亮行在插入空白后的真实索引
  const targetIndex = currentLineIndex >= 0 ? currentLineIndex + SPACING_ROWS : -1;
  const animationModel = useMemo(
    () => buildLyricAnimationModel({ enabled: enableAnimation, intensity: animationIntensity }),
    [enableAnimation, animationIntensity]
  );

  // ── 动态行高（对齐 lx：onLayout 记录每行真实高度，滚动偏移按累计高度计算，解决译文行高度不一的偏移）──
  const lineHeightsRef = useRef<number[]>([]);
  const scrollInfoRef = useRef<NativeSyntheticEvent<NativeScrollEvent>["nativeEvent"] | null>(null);
  const scrollCancelRef = useRef<(() => void) | null>(null);

  const handleLineLayout = useCallback((index: number, height: number) => {
    if (height > 0) lineHeightsRef.current[index] = height;
  }, []);

  // 计算目标行居中所需的滚动偏移（对齐 lx handleScrollToActive）：
  // offset = 累计行高(0..index-1) + 当前行一半 - 视口高度 × 0.42
  const computeTargetOffset = useCallback((index: number): number => {
    const heights = lineHeightsRef.current;
    let offset = 0;
    for (let i = 0; i < index; i += 1) {
      offset += heights[i] ?? FALLBACK_ITEM_HEIGHT;
    }
    offset += (heights[index] ?? FALLBACK_ITEM_HEIGHT) / 2;
    const viewportHeight =
      scrollInfoRef.current?.layoutMeasurement.height ?? 0;
    return offset - viewportHeight * 0.42;
  }, []);

  // 滚动到目标行（对齐 lx）：
  //  - 相邻行（diff==1）→ 平滑滚动动画（easeInOutQuad 600ms，按动态行高精确计算偏移）
  //  - 跨行/seek/首次 → scrollToIndex viewPosition 0.42（立即定位，不播动画）
  const handleScrollToActive = useCallback(
    (index: number, adjacent = false) => {
      if (index < 0 || !listRef.current) return;
      if (scrollCancelRef.current) {
        scrollCancelRef.current();
        scrollCancelRef.current = null;
      }
      // 相邻行且已有滚动信息 → 平滑滚动（对齐 lx 的精确偏移计算）
      if (adjacent && scrollInfoRef.current) {
        const to = computeTargetOffset(index);
        scrollCancelRef.current = smoothScrollToOffset(
          listRef.current,
          scrollInfoRef.current,
          to,
          600,
          () => {
            scrollCancelRef.current = null;
          }
        );
        return;
      }
      // 跨行/首次 → scrollToIndex 立即定位
      try {
        listRef.current.scrollToIndex({ index, animated: false, viewPosition: 0.42 });
      } catch {
        // 目标未就绪静默忽略（由 onScrollToIndexFailed 重试）
      }
    },
    [computeTargetOffset]
  );

  // ── 行切换 → 滚动（对齐 lx）：连续逐行（diff==1）延迟 600ms，跨行/seek 立即滚 ──
  const prevTargetRef = useRef(targetIndex);
  const delayScrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 最新目标行号 ref：供延迟回调/恢复回调读取，避免闭包捕获过期行号
  const targetIndexRef = useRef(targetIndex);
  targetIndexRef.current = targetIndex;

  // 用户滚动后暂停自动跟唱（对齐 lx：onScrollEndDrag 后 3s 恢复）
  const isPauseScrollRef = useRef(false);
  const scrollResumeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (delayScrollTimeoutRef.current) clearTimeout(delayScrollTimeoutRef.current);
      if (scrollResumeTimeoutRef.current) clearTimeout(scrollResumeTimeoutRef.current);
      if (scrollCancelRef.current) scrollCancelRef.current();
    };
  }, []);

  // 切歌/歌词更新时：重置滚动状态，立即滚回首行（对齐 lx：歌词更新即重置 isPauseScrollRef）
  useEffect(() => {
    isPauseScrollRef.current = false;
    if (scrollResumeTimeoutRef.current) {
      clearTimeout(scrollResumeTimeoutRef.current);
      scrollResumeTimeoutRef.current = null;
    }
    lineHeightsRef.current = [];
    prevTargetRef.current = -1;
    if (listRef.current) {
      try {
        listRef.current.scrollToOffset({ offset: 0, animated: false });
      } catch {
        // 忽略
      }
    }
  }, [lyrics]);

  // 字号/行距变化（捏合缩放、设置页修改）时：行高缓存失效，等待 onLayout 重新测量，
  // 避免用旧高度计算滚动偏移导致错位；行高重排完成后把当前行滚回 42% 锚点，
  // 否则缩放后高亮行会漂移，直到下一次换行才归位。
  useEffect(() => {
    lineHeightsRef.current = [];
    const timer = setTimeout(() => {
      if (isPauseScrollRef.current) return;
      const target = targetIndexRef.current;
      if (target >= 0) handleScrollToActive(target, false);
    }, 350);
    return () => clearTimeout(timer);
  }, [localFontSize, lineGap, handleScrollToActive]);

  useEffect(() => {
    if (targetIndex < 0 || data.length === 0) return;
    // 用户正在手动浏览歌词时不抢滚动（同时不推进 prevTargetRef，保持暂停前的相邻判定基线）
    if (isPauseScrollRef.current) return;

    const prev = prevTargetRef.current;
    prevTargetRef.current = targetIndex;
    const isAdjacent = targetIndex - prev === 1;

    const doScroll = () => {
      handleScrollToActive(targetIndex, isAdjacent);
    };

    if (delayScrollTimeoutRef.current) {
      clearTimeout(delayScrollTimeoutRef.current);
      delayScrollTimeoutRef.current = null;
    }
    if (scrollCancelRef.current) {
      scrollCancelRef.current();
      scrollCancelRef.current = null;
    }

    if (isAdjacent) {
      // 连续逐行：延迟 600ms 再滚（对齐 lx），给用户留出看清当前行的时间
      delayScrollTimeoutRef.current = setTimeout(() => {
        delayScrollTimeoutRef.current = null;
        if (isPauseScrollRef.current) return;
        doScroll();
      }, 600);
    } else {
      // 跨行/seek/首次：立即滚
      doScroll();
    }
  }, [targetIndex, data.length, handleScrollToActive]);

  const handleScrollToIndexFailed = (info: { index: number; highestMeasuredFrameIndex: number; averageItemLength: number }) => {
    // 目标未渲染时重试（对齐 lx：等待后再次滚动到目标）
    setTimeout(() => {
      handleScrollToActive(info.index, false);
    }, 100);
  };

  const renderItem = useCallback(
    ({ item, index }: { item: LyricLine; index: number }) => {
      const isActive = index === targetIndex;
      const isSpacer = item.time < 0;

      if (isSpacer) {
        return (
          <View
            style={{ height: FALLBACK_ITEM_HEIGHT }}
            onLayout={(e) => handleLineLayout(index, e.nativeEvent.layout.height)}
          />
        );
      }

      const hasTranslation = showTranslation && !!item.tr;
      const typography = buildLyricTypographyStyleModel({
        active: isActive,
        fontSize: localFontSize,
        lineGap,
        fontFamily,
        activeColor: activeColorSetting,
        inactiveColor: inactiveColorSetting,
        textAlign,
        fontWeight,
        textOpacity,
        palette,
      });

      // 对齐 lx：高亮行只用颜色区分（active 纯色），不做逐字卡拉 OK 双层文本填充
      return (
        <View onLayout={(e) => handleLineLayout(index, e.nativeEvent.layout.height)}>
          <AnimatedLyricLine
            item={item}
            isActive={isActive}
            hasTranslation={hasTranslation}
            onSeek={onSeek}
            typography={typography}
            animationModel={animationModel}
            chineseConversion={chineseConversion}
          />
        </View>
      );
    },
    [
      targetIndex,
      showTranslation,
      localFontSize,
      fontFamily,
      lineGap,
      activeColorSetting,
      inactiveColorSetting,
      textAlign,
      fontWeight,
      textOpacity,
      palette,
      onSeek,
      animationModel,
      chineseConversion,
      handleLineLayout,
    ]
  );

  return (
    <View style={[styles.container, style]} {...panResponder.panHandlers}>
      {data.length === 0 ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyText, { color: palette.textMuted }]}>暂无歌词</Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={data}
          keyExtractor={(item, index) => `${index}-${item.time}`}
          renderItem={renderItem}
          onScrollToIndexFailed={handleScrollToIndexFailed}
          fadingEdgeLength={100}
          initialNumToRender={Math.max(targetIndex + 10, 10)}
          onScrollBeginDrag={() => {
            // 对齐 lx：开始拖动 → 取消自动滚动动画与延迟，暂停自动跟唱
            isPauseScrollRef.current = true;
            if (delayScrollTimeoutRef.current) {
              clearTimeout(delayScrollTimeoutRef.current);
              delayScrollTimeoutRef.current = null;
            }
            if (scrollResumeTimeoutRef.current) {
              clearTimeout(scrollResumeTimeoutRef.current);
              scrollResumeTimeoutRef.current = null;
            }
            if (scrollCancelRef.current) {
              scrollCancelRef.current();
              scrollCancelRef.current = null;
            }
          }}
          onScrollEndDrag={() => {
            // 对齐 lx：松手后 3s 恢复自动跟唱（滚动持续时不会提前恢复）
            if (scrollResumeTimeoutRef.current) {
              clearTimeout(scrollResumeTimeoutRef.current);
              scrollResumeTimeoutRef.current = null;
            }
            scrollResumeTimeoutRef.current = setTimeout(() => {
              scrollResumeTimeoutRef.current = null;
              isPauseScrollRef.current = false;
              // 读取最新行号（ref），暂停期间行号已前进时恢复仍滚到当前行；
              // 恢复属于跨行跳转（暂停期间行号可能前进多行），用非动画立即定位
              const latest = targetIndexRef.current;
              prevTargetRef.current = latest;
              if (latest >= 0) handleScrollToActive(latest, false);
            }, 3000);
          }}
          onScroll={(event) => {
            scrollInfoRef.current = event.nativeEvent;
          }}
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={16}
          contentContainerStyle={styles.listContent}
        />
      )}
    </View>
  );
}

interface AnimatedLyricLineProps {
  item: LyricLine;
  isActive: boolean;
  hasTranslation: boolean;
  onSeek?: (time: number) => void;
  typography: ReturnType<typeof buildLyricTypographyStyleModel>;
  animationModel: ReturnType<typeof buildLyricAnimationModel>;
  /** 简繁转换模式：off / t2s / s2t，作用于歌词与译文文本 */
  chineseConversion: ChineseConversionMode;
}

function AnimatedLyricLine({
  item,
  isActive,
  hasTranslation,
  onSeek,
  typography,
  animationModel,
  chineseConversion,
}: AnimatedLyricLineProps) {
  const progress = useRef(new Animated.Value(isActive ? 1 : 0)).current;

  useEffect(() => {
    const nextValue = isActive ? 1 : 0;
    if (!animationModel.enabled || animationModel.lineTransitionDurationMs <= 0) {
      progress.setValue(nextValue);
      return;
    }

    const animation = Animated.timing(progress, {
      toValue: nextValue,
      duration: animationModel.lineTransitionDurationMs,
      useNativeDriver: true,
    });
    animation.start();

    return () => {
      animation.stop();
    };
  }, [animationModel.enabled, animationModel.lineTransitionDurationMs, isActive, progress]);

  const animatedStyle = {
    transform: [
      {
        scale: progress.interpolate({
          inputRange: [0, 1],
          outputRange: [animationModel.inactiveScale, animationModel.activeScale],
        }),
      },
    ],
  } as const;

  return (
    <AnimatedView style={animatedStyle}>
      <Pressable
        onPress={() => onSeek?.(item.time)}
        style={[styles.lineWrap, typography.lineWrapStyle]}
        disabled={!onSeek}
      >
        <Text numberOfLines={2} style={[styles.lineText, typography.lineTextStyle as TextStyle]}>
          {convertChineseText(item.text, chineseConversion)}
        </Text>
        {hasTranslation && (
          <Text numberOfLines={1} style={[styles.translation, typography.translationStyle as TextStyle]}>
            {convertChineseText(item.tr!, chineseConversion)}
          </Text>
        )}
      </Pressable>
    </AnimatedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    paddingVertical: 0,
  },
  lineWrap: {
    minHeight: FALLBACK_ITEM_HEIGHT,
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  lineText: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "500",
    textAlign: "center",
  } as TextStyle,
  translation: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
    textAlign: "center",
  } as TextStyle,
  empty: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyText: {
    fontSize: 15,
  },
});
