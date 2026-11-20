import React, { useEffect, useRef, useState } from "react";
import { View, StyleSheet, type StyleProp } from "react-native";
import FastImage, { type ResizeMode, type ImageStyle } from "@d11/react-native-fast-image";
import { COVER_SIZE_THUMB, resizeCoverUrl } from "@lx/core";
import { getCachedCover } from "@/services/cacheService";
import { logger } from "@/services/logger";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";

interface CachedImageProps {
  uri: string;
  style?: StyleProp<ImageStyle>;
  resizeMode?: ResizeMode;
  fallback?: React.ReactNode;
  nativeID?: string;
  /**
   * 目标边长（px），用于向图床索取缩略图。列表默认 200；
   * 播放器等大图位置显式传 COVER_SIZE_LARGE。
   */
  size?: number;
}

/** 网易云等图床统一浏览器 UA，避免部分图床 403。 */
const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Safari/537.36",
};

/**
 * 带缓存的图片组件（FastImage/Glide 原生内存+磁盘双层缓存 + UA 请求头 + 失败重试）。
 *
 * 列表显示交给原生图片缓存；加载失败时才查播放器已保存的离线封面。
 *
 * 渲染内核为 @d11/react-native-fast-image：
 * - Glide 原生内存缓存：列表滚动重复渲染零异步开销（对比此前 RN Image + RNFS 异步查盘）
 * - cache: "immutable"：URL 不变则永不过期，URL 变化自然失效（替代 30 天过期）
 * - transition="fade"：加载完成淡入，消除闪烁
 */
export function CachedImage({ uri, style, resizeMode = "cover", fallback, nativeID, size = COVER_SIZE_THUMB }: CachedImageProps) {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  // 渲染层通过 ref 读取最新的 onError 处理器（每次 uri 变化都会重建）
  const onRemoteErrorRef = useRef<() => void>(() => {});

  useEffect(() => {
    let mounted = true;

    // 网易云等图床常返回 http:// 链接，Android 9+ 默认禁止明文 HTTP（usesCleartextTraffic=false），
    // 导致所有封面加载失败只剩占位图。统一升级为 https://（网易云/腾讯图床均支持 https）。
    // 同时按显示尺寸向图床索取缩略图：原图常有数 MB，列表拉原图是首屏与滚动卡顿的主因。
    const safeUri = resizeCoverUrl(uri.replace(/^http:\/\//, "https://"), size);
    if (!safeUri) {
      setLoading(false);
      setError(true);
      onRemoteErrorRef.current = () => {};
      return;
    }

    let checkedLocal = false;

    const applyLocal = (localPath: string | null) => {
      if (!mounted) return;
      if (localPath) {
        setImageUri(localPath);
        setError(false);
        setLoading(false);
      } else {
        setError(true);
        setLoading(false);
      }
    };

    onRemoteErrorRef.current = () => {
      if (!mounted) return;
      if (checkedLocal || !/^https?:\/\//.test(safeUri)) {
        setError(true);
        return;
      }
      checkedLocal = true;
      void getCachedCover(safeUri).then(applyLocal, (error: unknown) => {
        logger.warn("读取离线封面失败", error);
        applyLocal(null);
      });
    };

    // 远端 URL 立即显示（Glide 内存缓存让重复进入零异步开销），首帧不等待磁盘往返；
    // 本地缓存文件仅用于远端加载失败后的回退。
    setImageUri(safeUri);
    setLoading(false);
    setError(false);

    return () => {
      mounted = false;
    };
  }, [uri, size]);

  if (loading) {
    return (
      <View style={[styles.placeholder, { backgroundColor: palette.surfaceStrong }, style]}>
        {fallback || null}
      </View>
    );
  }

  if (error || !imageUri) {
    return (
      <View style={[styles.placeholder, { backgroundColor: palette.surfaceStrong }, style]}>
        {fallback || null}
      </View>
    );
  }

  return (
    <FastImage
      style={style}
      resizeMode={resizeMode}
      nativeID={nativeID}
      source={{
        uri: imageUri,
        // 仅对远端 URL 带 UA；本地 file:// 无需请求头（带 headers 会导致 Glide 按 key 混缓存）
        headers: imageUri.startsWith("file://") ? undefined : DEFAULT_HEADERS,
        cache: FastImage.cacheControl.immutable,
      }}
      transition={FastImage.transition.fade}
      onError={onRemoteErrorRef.current}
    />
  );
}

const styles = StyleSheet.create({
  placeholder: {
    justifyContent: "center",
    alignItems: "center",
  },
});
