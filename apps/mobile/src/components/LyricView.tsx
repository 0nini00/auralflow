import React, { useEffect, useRef, useMemo, useCallback, useState } from "react";
import {
  Animated,
  FlatList,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
  type TextStyle,
  type StyleProp,
} from "react-native";
import type { LyricLine } from "@lx/core";
import type { ThemePalette } from "@/stores/themeStore";
import { useLyricSettingsStore } from "@/stores/lyricSettingsStore";
import {
  buildLyricAnimationModel,
  buildLyricTypographyStyleModel,
} from "@/services/lyricSettingsModel";

export interface LyricViewProps {
  lyrics: LyricLine[];
  /** 当前高亮行索引，-1 表示无 */
  currentLineIndex: number;
  /** 是否显示译文 */
  showTranslation: boolean;
  /** 主题色板 */
  palette: ThemePalette;
  /** 点击某行时 seek 到该行时间（秒） */
  onSeek?: (time: number) => void;
  /** 自定义容器样式 */
  style?: StyleProp<ViewStyle>;
}

// 固定行高，便于 FlatList getItemLayout / scrollToIndex
const ITEM_HEIGHT = 68;
// 顶部/底部填充占位行数，让当前行可以居中
const SPACING_ROWS = 4;
const AnimatedView = Animated.createAnimatedComponent(View);

export function LyricView({
  lyrics,
  currentLineIndex,
  showTranslation: showTranslationProp,
  palette,
  onSeek,
  style,
}: LyricViewProps) {
  const listRef = useRef<FlatList<LyricLine>>(null);

  // 从歌词样式 store 读取样式参数
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
  const setStoreFontSize = useLyricSettingsStore((s) => s.setFontSize);

  // 本地字号状态：手势期间实时更新，结束后持久化到 store
  const [localFontSize, setLocalFontSize] = useState(fontSize);
  const localFontSizeRef = useRef(fontSize);

  // store 外部更新时同步到本地状态
  useEffect(() => {
    setLocalFontSize(fontSize);
    localFontSizeRef.current = fontSize;
  }, [fontSize]);

  // 双指缩放：字号范围 12–32
  const FONT_SIZE_MIN = 12;
  const FONT_SIZE_MAX = 32;

  // PanResponder：双指捏合缩放歌词字号
  const pinchStartDistRef = useRef(0);
  const pinchStartFontSizeRef = useRef(16);
  const isPinchingRef = useRef(false);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        // 仅对双指手势拦截（单指保持 FlatList 滚动）
        return gestureState.numberActiveTouches === 2;
      },
      onPanResponderGrant: () => {
        // 双指触摸开始时记录初始状态（由 onPanResponderMove 中首次检测触发）
      },
      onPanResponderMove: (evt, gestureState) => {
        if (gestureState.numberActiveTouches < 2) return;

        // 计算两指间距（通过 nativeEvent.touches 获取多指坐标）
        const touches = evt.nativeEvent.touches;
        if (touches.length < 2) return;

        const dx = touches[0].pageX - touches[1].pageX;
        const dy = touches[0].pageY - touches[1].pageY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // 首次检测到双指：记录初始距离和字号
        if (!isPinchingRef.current) {
          isPinchingRef.current = true;
          pinchStartDistRef.current = dist;
          pinchStartFontSizeRef.current = localFontSizeRef.current;
          return;
        }

        const scale = dist / pinchStartDistRef.current;
        const newSize = Math.round(pinchStartFontSizeRef.current * scale);
        const clamped = Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, newSize));
        setLocalFontSize(clamped);
        localFontSizeRef.current = clamped;
      },
      onPanResponderRelease: () => {
        if (isPinchingRef.current) {
          // 手势结束，持久化最终字号到 store
          setStoreFontSize(localFontSizeRef.current);
          isPinchingRef.current = false;
        }
      },
      onPanResponderTerminate: () => {
        isPinchingRef.current = false;
      },
    })
  ).current;

  // 译文开关：组件 prop 优先（运行时临时切换），否则使用持久化设置
  const showTranslation = showTranslationProp && storeShowTranslation;

  // 在歌词前后加入占位行，使首尾行也能滚动到视口中部
  const data = useMemo<LyricLine[]>(() => {
    if (lyrics.length === 0) return [];
    const spacer: LyricLine = { time: -1, text: "" };
    return [...Array(SPACING_ROWS).fill(spacer), ...lyrics, ...Array(SPACING_ROWS).fill(spacer)];
  }, [lyrics]);

  // 占位行偏移：真实索引 -> 列表索引
  const targetIndex = currentLineIndex >= 0 ? currentLineIndex + SPACING_ROWS : -1;
  const animationModel = useMemo(
    () => buildLyricAnimationModel({ enabled: enableAnimation, intensity: animationIntensity }),
    [enableAnimation, animationIntensity]
  );

  // 用户手动滚动后暂停自动跟唱 3 秒（对齐桌面端 USER_SCROLL_RESUME_DELAY_MS）
  const userScrolledRef = useRef(false);
  const userScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (userScrollTimerRef.current) clearTimeout(userScrollTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (targetIndex < 0 || data.length === 0) return;
    // 用户手动滚动期间暂停自动跟唱
    if (userScrolledRef.current) return;
    const t = setTimeout(() => {
      try {
        listRef.current?.scrollToIndex({
          index: targetIndex,
          animated: animationModel.scrollAnimated,
          viewPosition: 0.5,
        });
      } catch {
        // 忽略
      }
    }, 60);
    return () => clearTimeout(t);
  }, [targetIndex, data.length, animationModel.scrollAnimated]);

  const handleScrollToIndexFailed = (info: { index: number; highestMeasuredFrameIndex: number; averageItemLength: number }) => {
    try {
      listRef.current?.scrollToOffset({
        offset: info.index * ITEM_HEIGHT,
        animated: true,
      });
    } catch {
      // 忽略
    }
  };

  if (lyrics.length === 0) {
    return (
      <View style={[styles.container, styles.empty, style]}>
        <Text style={[styles.emptyText, { color: palette.textMuted }]}>
          暂无歌词
        </Text>
      </View>
    );
  }

  const renderItem = useCallback(
    ({ item, index }: { item: LyricLine; index: number }) => {
      const isActive = index === targetIndex;
      const isSpacer = item.time < 0;

      if (isSpacer) {
        return <View style={{ height: ITEM_HEIGHT }} />;
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

      return (
        <AnimatedLyricLine
          item={item}
          isActive={isActive}
          hasTranslation={hasTranslation}
          onSeek={onSeek}
          typography={typography}
          animationModel={animationModel}
        />
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
    ]
  );

  return (
    <View style={[styles.container, style]} {...panResponder.panHandlers}>
      <FlatList
        ref={listRef}
        data={data}
        keyExtractor={(item, index) => `${index}-${item.time}`}
        renderItem={renderItem}
        getItemLayout={(_, index) => ({
          length: ITEM_HEIGHT,
          offset: index * ITEM_HEIGHT,
          index,
        })}
        onScrollToIndexFailed={handleScrollToIndexFailed}
        onScrollBeginDrag={() => {
          userScrolledRef.current = true;
          if (userScrollTimerRef.current) clearTimeout(userScrollTimerRef.current);
          userScrollTimerRef.current = setTimeout(() => {
            userScrolledRef.current = false;
            userScrollTimerRef.current = null;
            // 恢复后立即滚动到当前行
            const idx = currentLineIndex >= 0 ? currentLineIndex + SPACING_ROWS : -1;
            if (idx >= 0) {
              try { listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.5 }); } catch {}
            }
          }, 3000);
        }}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        contentContainerStyle={styles.listContent}
      />
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
}

function AnimatedLyricLine({
  item,
  isActive,
  hasTranslation,
  onSeek,
  typography,
  animationModel,
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
          {item.text}
        </Text>
        {hasTranslation && (
          <Text numberOfLines={1} style={[styles.translation, typography.translationStyle as TextStyle]}>
            {item.tr}
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
    height: ITEM_HEIGHT,
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
