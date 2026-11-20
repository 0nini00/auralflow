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
import { logger } from "@/services/logger";

export interface LyricViewProps {
  lyrics: LyricLine[];
  emptyText?: string;
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
  /** 隐藏页保留列表状态，但暂停跟唱与逐行更新。 */
  active?: boolean;
}

// 未测量行高的兜底估算（首次渲染 / 行高尚未 onLayout 时用于滚动偏移计算）
const FALLBACK_ITEM_HEIGHT = 68;
// 上下各填充几行空白，让当前歌词始终显示在列表中间
const SPACING_ROWS = 4;

/**
 * 首帧同步渲染的行数上限。旧实现按 targetIndex + 10 预渲染：快歌唱到歌词中段
 * （如第 300 行）时打开播放页，首帧要同步挂载 300+ 行（每行 onLayout + Animated）
 * 造成可感知卡顿。固定小窗口，深处的当前行由 onScrollToIndexFailed 的估算偏移
 * 补偿定位收口（先跳平均行高估算点触发窗口渲染，再精确对位）。
 */
const LYRIC_INITIAL_NUM_TO_RENDER = 30;
const AnimatedView = Animated.createAnimatedComponent(View);

export const LyricView = React.memo(function LyricView({
  lyrics,
  emptyText = "暂无歌词",
  currentLineIndex,
  showTranslation: showTranslationProp,
  palette,
  onSeek,
  style,
  active = true,
}: LyricViewProps) {
  const listRef = useRef<FlatList<LyricLine>>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const onSeekRef = useRef(onSeek);
  onSeekRef.current = onSeek;
  const seekToLine = useCallback((time: number) => onSeekRef.current?.(time), []);
  const canSeek = onSeek !== undefined;

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

  // ── 动态行高（onLayout 记录每行真实高度，滚动偏移按累计高度计算，解决译文行高度不一的偏移）──
  const lineHeightsRef = useRef<number[]>([]);
  const scrollInfoRef = useRef<NativeSyntheticEvent<NativeScrollEvent>["nativeEvent"] | null>(null);
  // onScrollToIndexFailed 的补偿重试定时器(纳入统一清理,防切歌后旧回调滚错位)
  const scrollRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleLineLayout = useCallback((index: number, height: number) => {
    if (height > 0) lineHeightsRef.current[index] = height;
  }, []);

  // 计算目标行居中所需的滚动偏移：
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

  // 滚动到目标行：
  //  - 相邻行（diff==1）→ 平滑滚动（原生动画，按动态行高精确计算偏移）
  //  - 跨行/seek/首次 → scrollToIndex viewPosition 0.42（立即定位，不播动画）
  const handleScrollToActive = useCallback(
    (index: number, adjacent = false) => {
      if (index < 0 || !listRef.current || !activeRef.current) return;
      // 相邻行且已有滚动信息 → 平滑滚动（按动态行高精确计算偏移）
      if (adjacent && scrollInfoRef.current) {
        const info = scrollInfoRef.current;
        const maxOffset = Math.max(0, info.contentSize.height - info.layoutMeasurement.height);
        const offset = Math.max(0, Math.min(maxOffset, computeTargetOffset(index)));
        listRef.current.scrollToOffset({ offset, animated: true });
        return;
      }
      // 跨行/首次 → scrollToIndex 立即定位
      try {
        listRef.current.scrollToIndex({ index, animated: false, viewPosition: 0.42 });
      } catch (error) {
        logger.warn("[LyricView] 歌词定位失败", error);
      }
    },
    [computeTargetOffset]
  );

  // 每次换行直接更新原生滚动目标，短行连续切换不会被延迟计时器饿死。
  const prevTargetRef = useRef(targetIndex);
  // 最新目标行号 ref：供延迟回调/恢复回调读取，避免闭包捕获过期行号
  const targetIndexRef = useRef(targetIndex);
  targetIndexRef.current = targetIndex;

  // 用户滚动后暂停自动跟唱（松手后 3s 恢复）
  const isPauseScrollRef = useRef(false);
  const scrollResumeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pauseAutoScroll = useCallback(() => {
    isPauseScrollRef.current = true;
    if (scrollResumeTimeoutRef.current) clearTimeout(scrollResumeTimeoutRef.current);
    if (scrollRetryTimeoutRef.current) clearTimeout(scrollRetryTimeoutRef.current);
    scrollResumeTimeoutRef.current = null;
    scrollRetryTimeoutRef.current = null;
  }, []);
  const scheduleScrollResume = useCallback(() => {
    if (!isPauseScrollRef.current || !activeRef.current) return;
    if (scrollResumeTimeoutRef.current) clearTimeout(scrollResumeTimeoutRef.current);
    scrollResumeTimeoutRef.current = setTimeout(() => {
      scrollResumeTimeoutRef.current = null;
      isPauseScrollRef.current = false;
      const latest = targetIndexRef.current;
      prevTargetRef.current = latest;
      if (latest >= 0 && activeRef.current) handleScrollToActive(latest, false);
    }, 3000);
  }, [handleScrollToActive]);

  useEffect(() => {
    return () => {
      if (scrollResumeTimeoutRef.current) clearTimeout(scrollResumeTimeoutRef.current);
      if (scrollRetryTimeoutRef.current) clearTimeout(scrollRetryTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (active) return;
    isPauseScrollRef.current = false;
    prevTargetRef.current = -1;
    if (scrollResumeTimeoutRef.current) clearTimeout(scrollResumeTimeoutRef.current);
    if (scrollRetryTimeoutRef.current) clearTimeout(scrollRetryTimeoutRef.current);
    scrollResumeTimeoutRef.current = null;
    scrollRetryTimeoutRef.current = null;
  }, [active]);

  // 切歌/歌词更新时：重置滚动状态，立即滚回首行
  useEffect(() => {
    isPauseScrollRef.current = false;
    if (scrollResumeTimeoutRef.current) {
      clearTimeout(scrollResumeTimeoutRef.current);
      scrollResumeTimeoutRef.current = null;
    }
    lineHeightsRef.current = [];
    scrollInfoRef.current = null;
    if (scrollRetryTimeoutRef.current) {
      clearTimeout(scrollRetryTimeoutRef.current);
      scrollRetryTimeoutRef.current = null;
    }
    prevTargetRef.current = -1;
    if (listRef.current && activeRef.current) {
      try {
        listRef.current.scrollToOffset({ offset: 0, animated: false });
      } catch (error) {
        logger.warn("[LyricView] 切歌后滚回首行失败（忽略）", error);
      }
    }
  }, [lyrics]);

  // 字号/行距变化（捏合缩放、设置页修改）时：行高缓存失效，等待 onLayout 重新测量，
  // 避免用旧高度计算滚动偏移导致错位；行高重排完成后把当前行滚回 42% 锚点，
  // 否则缩放后高亮行会漂移，直到下一次换行才归位。
  useEffect(() => {
    lineHeightsRef.current = [];
    const timer = setTimeout(() => {
      if (isPauseScrollRef.current || !activeRef.current) return;
      const target = targetIndexRef.current;
      if (target >= 0) handleScrollToActive(target, false);
    }, 350);
    return () => clearTimeout(timer);
  }, [localFontSize, lineGap, fontFamily, fontWeight, showTranslation, textAlign, handleScrollToActive]);

  useEffect(() => {
    if (!active || targetIndex < 0 || data.length === 0) return;
    // 用户正在手动浏览歌词时不抢滚动（同时不推进 prevTargetRef，保持暂停前的相邻判定基线）
    if (isPauseScrollRef.current) return;

    const prev = prevTargetRef.current;
    prevTargetRef.current = targetIndex;
    const isAdjacent = targetIndex - prev === 1;

    handleScrollToActive(targetIndex, isAdjacent);
  }, [active, targetIndex, data, handleScrollToActive]);

  const handleScrollToIndexFailed = (info: { index: number; highestMeasuredFrameIndex: number; averageItemLength: number }) => {
    if (!activeRef.current || isPauseScrollRef.current) return;
    // 目标行未渲染时的补偿定位：先用平均行高估算偏移跳过去（触发目标区域的
    // 窗口渲染与 onLayout 测量），等待后再精确对位。只重试不先跳会原地失败
    // ——initialNumToRender 固定小窗口后，深行号首挂载必然走这里。
    try {
      listRef.current?.scrollToOffset({
        offset: info.averageItemLength * info.index,
        animated: false,
      });
    } catch (error) {
      logger.warn("[LyricView] 歌词补偿定位失败（忽略）", error);
    }
    if (scrollRetryTimeoutRef.current) clearTimeout(scrollRetryTimeoutRef.current);
    scrollRetryTimeoutRef.current = setTimeout(() => {
      scrollRetryTimeoutRef.current = null;
      if (!activeRef.current || isPauseScrollRef.current) return;
      // 用最新行数兜底:切歌后旧索引可能越界,按当前歌词行数钳制
      const maxIndex = data.length - 1;
      const target = Math.min(targetIndexRef.current, maxIndex);
      if (target >= 0) handleScrollToActive(target, false);
    }, 100);
  };

  const typography = useMemo(() => {
    const settings = {
      fontSize: localFontSize, lineGap, fontFamily,
      activeColor: activeColorSetting, inactiveColor: inactiveColorSetting,
      textAlign, fontWeight, textOpacity, palette,
    };
    return {
      active: buildLyricTypographyStyleModel({ ...settings, active: true }),
      inactive: buildLyricTypographyStyleModel({ ...settings, active: false }),
    };
  }, [localFontSize, lineGap, fontFamily, activeColorSetting, inactiveColorSetting,
    textAlign, fontWeight, textOpacity, palette]);

  const renderItem = useCallback(
    ({ item, index }: { item: LyricLine; index: number }) => {
      const isActive = index === targetIndexRef.current;
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
      // 罗马音与译文同属「副行」：跟随译文的显示开关，避免再加一个开关粒度
      const hasRoma = showTranslation && !!item.roma;
      // 高亮行只用颜色区分（active 纯色），不做逐字卡拉 OK 双层文本填充
      return (
        <AnimatedLyricLine
          index={index}
          onLayout={handleLineLayout}
          item={item}
          isActive={isActive}
          hasTranslation={hasTranslation}
          hasRoma={hasRoma}
          onSeek={canSeek ? seekToLine : undefined}
          typography={isActive ? typography.active : typography.inactive}
          animationModel={animationModel}
          chineseConversion={chineseConversion}
        />
      );
    },
    [
      showTranslation,
      typography,
      canSeek,
      seekToLine,
      animationModel,
      chineseConversion,
      handleLineLayout,
    ]
  );

  return (
    <View style={[styles.container, style]} {...panResponder.panHandlers}>
      {data.length === 0 ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyText, { color: palette.textMuted }]}>{emptyText}</Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={data}
          extraData={targetIndex}
          keyExtractor={(item, index) => `${index}-${item.time}`}
          renderItem={renderItem}
          onScrollToIndexFailed={handleScrollToIndexFailed}
          fadingEdgeLength={100}
          initialNumToRender={LYRIC_INITIAL_NUM_TO_RENDER}
          onScrollBeginDrag={pauseAutoScroll}
          onScrollEndDrag={scheduleScrollResume}
          onMomentumScrollBegin={() => {
            // 原生自动滚动也可能触发惯性事件，只有手动浏览才延长暂停。
            if (isPauseScrollRef.current) pauseAutoScroll();
          }}
          onMomentumScrollEnd={scheduleScrollResume}
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
}, (previous, next) => {
  // 隐藏页忽略播放时钟和父级回调引用变化；重新可见时一次读取最新属性。
  const hidden = previous.active === false && next.active === false;
  return Object.keys({ ...previous, ...next }).every(key => (hidden && (key === "currentLineIndex" || key === "onSeek"))
    || Object.is(previous[key as keyof LyricViewProps], next[key as keyof LyricViewProps]));
});

interface AnimatedLyricLineProps {
  index: number;
  onLayout: (index: number, height: number) => void;
  item: LyricLine;
  isActive: boolean;
  hasTranslation: boolean;
  hasRoma: boolean;
  onSeek?: (time: number) => void;
  typography: ReturnType<typeof buildLyricTypographyStyleModel>;
  animationModel: ReturnType<typeof buildLyricAnimationModel>;
  /** 简繁转换模式：off / t2s / s2t，作用于歌词与译文文本 */
  chineseConversion: ChineseConversionMode;
}

const AnimatedLyricLine = React.memo(function AnimatedLyricLine({
  index,
  onLayout,
  item,
  isActive,
  hasTranslation,
  hasRoma,
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

  const animatedStyle = useMemo(() => ({
    transform: [
      {
        scale: progress.interpolate({
          inputRange: [0, 1],
          outputRange: [animationModel.inactiveScale, animationModel.activeScale],
        }),
      },
    ],
  }), [progress, animationModel.inactiveScale, animationModel.activeScale]);

  return (
    <AnimatedView style={animatedStyle} onLayout={(event: { nativeEvent: { layout: { height: number } } }) => onLayout(index, event.nativeEvent.layout.height)}>
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
        {hasRoma && (
          <Text numberOfLines={1} style={[styles.translation, typography.translationStyle as TextStyle]}>
            {item.roma!}
          </Text>
        )}
      </Pressable>
    </AnimatedView>
  );
});

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
