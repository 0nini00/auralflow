import React, { useEffect, useRef, useCallback } from "react";
import { View, Animated, Easing, Pressable } from "react-native";
import { Music2 } from "lucide-react-native";
import { COVER_SIZE_LARGE } from "@lx/core";
import type { ThemePalette } from "@/stores/themeStore";
import type { ImmersiveFlyRect } from "@/screens/immersive/immersiveFlySource";
import { CachedImage } from "@/components/CachedImage";
import { useLyricSettingsStore } from "@/stores/lyricSettingsStore";
import { styles } from "@/screens/immersive/immersiveStyles";

export interface ImmersiveCoverPageProps {
  artwork?: string;
  coverSize: number;
  bottomSpace: number;
  isPlaying: boolean;
  palette: ThemePalette;
  onLongPress?: () => void;
  /** 封面框布局完成时上报其在窗口中的位置（播放页封面飞入转场的终点） */
  onCoverMeasured?: (rect: ImmersiveFlyRect) => void;
}

export function ImmersiveCoverPage({
  artwork,
  coverSize,
  bottomSpace,
  isPlaying,
  palette,
  onLongPress,
  onCoverMeasured,
}: ImmersiveCoverPageProps) {
  const coverFrameRef = useRef<View>(null);
  const spinValue = useRef(new Animated.Value(0)).current;
  const animationRef = useRef<Animated.CompositeAnimation | null>(null);
  const isAnimating = useRef(false);
  const coverSpin = useLyricSettingsStore((s) => s.coverSpin);

  const createAnimation = useCallback((value: number) => {
    return Animated.timing(spinValue, {
      toValue: 1,
      duration: 25000 * (1 - value), // 25s per rotation
      easing: Easing.linear,
      useNativeDriver: true,
    });
  }, [spinValue]);

  const startAnimation = useCallback(() => {
    if (isAnimating.current || !isPlaying) return;
    isAnimating.current = true;
    spinValue.stopAnimation(value => {
      animationRef.current = createAnimation(value);
      animationRef.current.start(({ finished }) => {
        if (finished && isAnimating.current) {
          spinValue.setValue(0);
          isAnimating.current = false;
          startAnimation();
        }
      });
    });
  }, [spinValue, createAnimation, isPlaying]);

  const stopAnimation = useCallback(() => {
    if (!isAnimating.current) return;
    isAnimating.current = false;
    animationRef.current?.stop();
    animationRef.current = null;
    spinValue.stopAnimation();
  }, [spinValue]);

  useEffect(() => {
    if (!coverSpin) {
      stopAnimation();
      spinValue.setValue(0);
      return;
    }
    if (isPlaying) {
      startAnimation();
    } else {
      stopAnimation();
    }
  }, [isPlaying, startAnimation, stopAnimation, coverSpin, spinValue]);

  const spin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  const coverBorderRadius = coverSpin ? coverSize / 2 : 8;

  const measureCover = useCallback(() => {
    if (!onCoverMeasured) return;
    coverFrameRef.current?.measureInWindow((x, y, width, height) => {
      if (width > 0 && height > 0) onCoverMeasured({ x, y, width, height });
    });
  }, [onCoverMeasured]);

  useEffect(() => {
    // 父级高度和安全区变化也会移动封面，不能只依赖封面自身尺寸变化。
    const frame = requestAnimationFrame(measureCover);
    return () => cancelAnimationFrame(frame);
  }, [measureCover, coverSize, bottomSpace]);

  return (
    <View style={[styles.coverPageContainer, { paddingBottom: bottomSpace }]} onLayout={measureCover}>
      <Pressable onLongPress={onLongPress} onLayout={measureCover}>
        <View
          ref={coverFrameRef}
          onLayout={measureCover}
          style={[
            styles.coverFrame,
            {
              width: coverSize,
              height: coverSize,
              borderRadius: coverBorderRadius,
            },
          ]}
        >
          <Animated.View
            style={{ width: "100%", height: "100%", transform: [{ rotate: spin }] }}
          >
            {artwork ? (
              <CachedImage
                uri={artwork}
                size={COVER_SIZE_LARGE}
                style={[
                  styles.coverImage,
                  { borderRadius: coverBorderRadius },
                ]}
                fallback={
                  <View
                    style={[
                      styles.coverImage,
                      styles.coverPlaceholder,
                      { backgroundColor: palette.surfaceStrong, borderRadius: coverBorderRadius },
                    ]}
                  >
                    <Music2 size={48} color={palette.primary} />
                  </View>
                }
              />
            ) : (
              <View
                style={[
                  styles.coverImage,
                  styles.coverPlaceholder,
                  { backgroundColor: palette.primary, borderRadius: coverBorderRadius },
                ]}
              >
                <Music2 size={48} color={palette.primaryText} />
              </View>
            )}
          </Animated.View>
        </View>
      </Pressable>
    </View>
  );
}
