import React, { useState, useEffect } from "react";
import { Image, ImageProps, View, StyleSheet } from "react-native";
import { getCachedCover, cacheCover } from "@/services/cacheService";
import { isBiliImageUrl } from "@/services/biliService";

interface CachedImageProps extends Omit<ImageProps, "source"> {
  uri: string;
  fallback?: React.ReactNode;
}

/**
 * 带缓存的图片组件
 * 优先使用缓存，缓存不存在时从网络加载并缓存
 */
export function CachedImage({ uri, fallback, style, ...props }: CachedImageProps) {
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let mounted = true;

    const loadImage = async () => {
      if (!uri) {
        setLoading(false);
        setError(true);
        return;
      }

      try {
        setLoading(true);
        setError(false);

        // 1. 尝试从缓存加载
        const cached = await getCachedCover(uri);
        if (cached && mounted) {
          setImageUri(cached);
          setLoading(false);
          return;
        }

        // B站图片有防盗链限制：RN Image 组件直接加载远程 URL 时会携带
        // Referer，导致 403。因此对 B站图片必须先通过 RNFS 下载到本地
        // （不带 Referer），再从本地文件显示。
        const biliImage = isBiliImageUrl(uri);
        if (biliImage) {
          const localPath = await cacheCover(uri);
          if (mounted) {
            if (localPath) {
              setImageUri(localPath);
            } else {
              setError(true);
            }
            setLoading(false);
          }
          return;
        }

        // 非 B站图片：使用原始 URI（触发下载）
        setImageUri(uri);
        setLoading(false);

        // 3. 异步缓存
        cacheCover(uri).catch((err) => {
          console.error("Cache image error:", err);
        });
      } catch (err) {
        console.error("Load image error:", err);
        if (mounted) {
          setError(true);
          setLoading(false);
        }
      }
    };

    void loadImage();

    return () => {
      mounted = false;
    };
  }, [uri]);

  if (loading) {
    return (
      <View style={[styles.placeholder, style]}>
        {fallback || null}
      </View>
    );
  }

  if (error || !imageUri) {
    return (
      <View style={[styles.placeholder, style]}>
        {fallback || null}
      </View>
    );
  }

  return (
    <Image
      {...props}
      source={{ uri: imageUri }}
      style={style}
      onError={() => setError(true)}
    />
  );
}

const styles = StyleSheet.create({
  placeholder: {
    backgroundColor: "#1a3a31",
    justifyContent: "center",
    alignItems: "center",
  },
});
