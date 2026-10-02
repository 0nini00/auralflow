import { useEffect } from 'react';
import { usePlayerStore } from '@/stores/playerStore';
import { useThemeStore } from '@/stores/themeStore';
import { applyArtworkPalette, extractArtworkPalette } from '@/services/artworkColor';
import { CARD_COVER_CSS_SIZE, coverSrc } from '@/utils/imageReferrerPolicy';

/**
 * 当前播放封面的主色 -> 氛围光变量：
 * - `--af-ambience-rgb`：播放条氛围光，以及渐变动态背景「跟随封面色」的取色来源
 * - `--af-artwork-rgb`：沉浸歌词页的环境色
 * - `--af-artwork-on-color`：沉浸页实心播放键上的前景色
 *
 * 强调色只由 themeStore 里的手选值决定，这里不写任何 accent 变量，
 * 所以动态取色永远不会覆盖用户选的颜色。
 * 「从封面取色」关闭、作用范围排除该区域、取色失败（跨源封面 / 无封面）时移除变量，
 * CSS 侧的 fallback 回到主题强调色，观感退化而不是失效，因此这里不需要错误提示。
 */
export function useArtworkAmbience(): void {
  const current = usePlayerStore((state) => state.current);
  const artworkAmbienceEnabled = useThemeStore((state) => state.artworkAmbienceEnabled);
  const artworkAmbienceScope = useThemeStore((state) => state.artworkAmbienceScope);
  // 刻意与列表卡片刻度取同一档：同一张封面在列表与取色之间共用一次加载，
  // 单独为取色降一档反而会多出一次下载，切歌时更慢。
  const coverUrl = current ? coverSrc(current.img || current.picUrl || '', CARD_COVER_CSS_SIZE) : '';

  useEffect(() => {
    const targets = {
      ambience: artworkAmbienceEnabled,
      immersive: artworkAmbienceEnabled && artworkAmbienceScope === 'player-immersive',
    };

    if (!coverUrl || !artworkAmbienceEnabled) {
      applyArtworkPalette(null, targets);
      return;
    }

    let cancelled = false;
    void extractArtworkPalette(coverUrl).then((palette) => {
      if (cancelled) return;
      applyArtworkPalette(palette, targets);
    });

    return () => {
      cancelled = true;
    };
  }, [coverUrl, artworkAmbienceEnabled, artworkAmbienceScope]);
}
