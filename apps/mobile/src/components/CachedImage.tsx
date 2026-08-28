import React, { useEffect, useRef, useState } from "react";
import { View, StyleSheet, type StyleProp } from "react-native";
import FastImage, { type ResizeMode, type ImageStyle } from "@d11/react-native-fast-image";
import { COVER_SIZE_THUMB, resizeCoverUrl } from "@lx/core";
import { cacheCover } from "@/services/cacheService";
import { isBiliImageUrl } from "@/services/biliService";
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

/** 网易云等图床统一浏览器 UA，避免部分图床 403（对齐 lx defaultHeaders）。 */
const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Safari/537.36",
};

/**
 * 带缓存的图片组件（对齐 lx：FastImage/Glide 原生内存+磁盘双层缓存 + UA 请求头 + 失败重试）。
 *
 * 远端 URL 即时展示（首帧零磁盘往返），同时后台下载到本地缓存；
 * B站图床因防盗链限制必须先下载到本地再显示；
 * 远端加载失败时自动重试，重试后仍失败则回退到已下载的本地文件。
 *
 * 渲染内核为 @d11/react-native-fast-image：
 * - Glide 原生内存缓存：列表滚动重复渲染零异步开销（对比此前 RN Image + RNFS 异步查盘）
 * - cache: "immutable"：URL 不变则永不过期，URL 变化自然失效（对齐 lx，替代 30 天过期）
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
    // 导致所有封面加载失败只剩占位图。统一升级为 https://（网易云/B站/腾讯图床均支持 https）。
    // 同时按显示尺寸向图床索取缩略图：原图常有数 MB，列表拉原图是首屏与滚动卡顿的主因。
    const safeUri = resizeCoverUrl(uri.replace(/^http:\/\//, "https://"), size);
    if (!safeUri) {
      setLoading(false);
      setError(true);
      onRemoteErrorRef.current = () => {};
      return;
    }

    let retries = 0;
    // 后台下载/命中本地缓存（cacheCover 自带先查盘再下载，带 UA header）：
    // 非 B站不阻塞显示，仅用于离线回退与下次的本地命中
    const localFilePromise = cacheCover(safeUri).catch(() => null);

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
      if (retries < 2) {
        retries += 1;
        // 改 URL 强制 FastImage 重新请求（避免复用失败结果），query 不影响缓存 key
        setImageUri(`${safeUri}${safeUri.includes("?") ? "&" : "?"}r=${retries}`);
        setError(false);
      } else {
        // 重试失败 → 回退到本地缓存文件（离线时这是唯一可用的图）
        void localFilePromise.then(applyLocal);
      }
    };

    // B站图床有防盗链：FastImage 直接加载远程 URL 会携带 Referer 导致 403，
    // 必须等 RNFS 下载到本地（不带 Referer）后显示 file:// 路径。
    // 其他图床立即显示远端 URL（Glide 内存缓存让重复进入零异步开销），
    // 首帧不再等待任何磁盘 stat 往返。
    if (isBiliImageUrl(safeUri)) {
      setLoading(true);
      setError(false);
      void localFilePromise.then((localPath) => {
        if (!mounted) return;
        applyLocal(localPath);
      });
    } else {
      setImageUri(safeUri);
      setLoading(false);
      setError(false);
    }

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
