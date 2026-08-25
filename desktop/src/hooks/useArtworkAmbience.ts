import { useEffect } from 'react';
import { usePlayerStore } from '@/stores/playerStore';
import { applyArtworkPalette, extractArtworkPalette, type ArtworkPalette } from '@/services/artworkColor';
import { toCoverSrc } from '@/utils/imageReferrerPolicy';

/**
 * 供沉浸页 @property 注册的逐通道变量（"r, g, b" 拆开写入）。
 * 渐变/颜色要平滑过渡必须走可插值的数值通道，整串 triplet 无法 transition。
 */
const ARTWORK_CHANNEL_VARS = ['--af-artwork-r', '--af-artwork-g', '--af-artwork-b'] as const;

/** 把 palette.rgb 拆成 R/G/B 三个通道变量；palette 为 null 时移除，让 CSS 回退到主题强调色。 */
function applyArtworkChannels(palette: ArtworkPalette | null): void {
  const root = document.documentElement;
  const channels = palette?.rgb.split(',').map((part) => part.trim());
  const valid = channels !== undefined && channels.length === 3 && channels.every(Boolean);
  ARTWORK_CHANNEL_VARS.forEach((name, index) => {
    if (valid) root.style.setProperty(name, channels![index]);
    else root.style.removeProperty(name);
  });
}

/**
 * 当前播放封面的主色 -> CSS 变量 `--af-artwork-rgb`（triplet）
 * 以及 `--af-artwork-r/g/b`（逐通道，供 @property 过渡用）。
 *
 * 取色失败（跨源封面、无封面）时移除变量，CSS 侧的 fallback 会回到主题强调色，
 * 所以这里不需要任何错误提示。
 */
export function useArtworkAmbience(): void {
  const current = usePlayerStore((state) => state.current);
  const coverUrl = current ? toCoverSrc(current.img || current.picUrl || '') : '';

  useEffect(() => {
    if (!coverUrl) {
      applyArtworkPalette(null);
      applyArtworkChannels(null);
      return;
    }

    let cancelled = false;
    void extractArtworkPalette(coverUrl).then((palette) => {
      if (cancelled) return;
      applyArtworkPalette(palette);
      applyArtworkChannels(palette);
    });

    return () => {
      cancelled = true;
    };
  }, [coverUrl]);
}
