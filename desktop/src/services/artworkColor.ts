/**
 * 从封面提取氛围主色，注入 CSS 变量供界面着色。
 *
 * 走 canvas 采样而不是原生模块：桌面端在 WebView 里，纯前端即可完成，无需新依赖。
 *
 * 已知边界：canvas 读像素受同源策略约束。网易图床（p1.music.126.net）返回
 * `Access-Control-Allow-Origin: *`，可直接取色；QQ 图床（y.gtimg.cn）等不返回
 * CORS 头，crossOrigin="anonymous" 的图片会直接加载失败，canvas 路径走不通。
 * 这类封面改走 Rust 出站代理拉回字节转 data URL 再采样（下载服务同款方案），
 * 仍失败则静默回退主题强调色。本地缓存封面（asset 协议）不受影响。
 */

const SAMPLE_SIZE = 24;
/** 过滤接近纯黑/纯白的像素，避免主色被背景压成灰。 */
const MIN_LUMINANCE = 24;
const MAX_LUMINANCE = 232;
/** 低饱和像素对氛围没有贡献，同样跳过。 */
const MIN_SATURATION = 18;

export interface ArtworkPalette {
  /** `r, g, b` 形式，方便在 CSS 里用 rgb(var(--x) / alpha) */
  rgb: string;
}

function toPalette(r: number, g: number, b: number): ArtworkPalette {
  return { rgb: `${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}` };
}

/** 控件可读性的最低亮度（0-255 加权亮度公式）。 */
const MIN_PALETTE_LUMA = 96;
/** 低饱和阈值：max-min 低于此值时做拉伸补偿。 */
const MIN_PALETTE_SPREAD = 24;

const clamp255 = (value: number) => Math.min(255, Math.max(0, value));

/**
 * 提亮至最低明度：提取色可能太暗/太灰，直接拿来画控件会看不清。
 * 先等比提亮（保色调，亮度不够时最多 ×1.35），再做饱和度拉伸
 * （向远离均值灰的方向放大差异），返回值仅影响控件与背景共用变量。
 */
function ensureVisibleLuma(r: number, g: number, b: number): [number, number, number] {
  let nr = r;
  let ng = g;
  let nb = b;

  const luma = 0.2126 * nr + 0.7152 * ng + 0.0722 * nb;
  if (luma < MIN_PALETTE_LUMA) {
    const gain = Math.min(1.35, MIN_PALETTE_LUMA / luma);
    nr *= gain;
    ng *= gain;
    nb *= gain;
  }

  const max = Math.max(nr, ng, nb);
  const min = Math.min(nr, ng, nb);
  if (max - min < MIN_PALETTE_SPREAD) {
    const avg = (nr + ng + nb) / 3;
    nr = avg + (nr - avg) * 1.3;
    ng = avg + (ng - avg) * 1.3;
    nb = avg + (nb - avg) * 1.3;
  }

  return [clamp255(nr), clamp255(ng), clamp255(nb)];
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('封面加载失败'));
    image.src = url;
  });
}

/** 无 CORS 头的图床（如 QQ y.gtimg.cn）：走 Rust 代理拉回字节转 data URL。 */
async function loadImageViaProxy(url: string): Promise<HTMLImageElement> {
  const { outboundRequest } = await import('@/services/outboundHttp');
  const response = await outboundRequest(url, { method: 'GET', responseType: 'base64' });
  if (!response.ok) throw new Error('代理拉取封面失败');
  const contentType = (response.headers['content-type'] ?? '').split(';')[0]?.trim() || 'image/jpeg';
  if (!/^image\//i.test(contentType)) throw new Error('非图片响应');
  return loadImage(`data:${contentType};base64,${response.base64()}`);
}

export async function extractArtworkPalette(imageUrl: string): Promise<ArtworkPalette | null> {
  if (!imageUrl) return null;

  let pixels: Uint8ClampedArray;
  try {
    // 远程 URL 先试直连（带 CORS 的图床如网易可直接过）；失败再走 Rust 代理
    const isRemote = /^https?:\/\//i.test(imageUrl);
    const image = await loadImage(imageUrl).catch((error) =>
      isRemote ? loadImageViaProxy(imageUrl) : Promise.reject(error),
    );
    const canvas = document.createElement('canvas');
    canvas.width = SAMPLE_SIZE;
    canvas.height = SAMPLE_SIZE;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    // 跨源图片会污染 canvas，getImageData 抛 SecurityError
    pixels = context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
  } catch {
    return null;
  }

  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let count = 0;
  // 全部像素都被过滤时的兜底均值
  let fallbackR = 0;
  let fallbackG = 0;
  let fallbackB = 0;
  let fallbackCount = 0;

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const alpha = pixels[i + 3];
    if (alpha < 128) continue;

    fallbackR += r;
    fallbackG += g;
    fallbackB += b;
    fallbackCount += 1;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    if (luminance < MIN_LUMINANCE || luminance > MAX_LUMINANCE) continue;
    if (max - min < MIN_SATURATION) continue;

    sumR += r;
    sumG += g;
    sumB += b;
    count += 1;
  }

  const finalize = (r: number, g: number, b: number) => {
    const [vr, vg, vb] = ensureVisibleLuma(r, g, b);
    return toPalette(vr, vg, vb);
  };

  if (count > 0) return finalize(sumR / count, sumG / count, sumB / count);
  if (fallbackCount > 0) {
    return finalize(fallbackR / fallbackCount, fallbackG / fallbackCount, fallbackB / fallbackCount);
  }
  return null;
}

const ARTWORK_RGB_VAR = '--af-artwork-rgb';

/** 写入 / 清除封面主色变量。传 null 时移除，CSS 侧自动回退到强调色。 */
export function applyArtworkPalette(palette: ArtworkPalette | null): void {
  const root = document.documentElement;
  if (palette) {
    root.style.setProperty(ARTWORK_RGB_VAR, palette.rgb);
  } else {
    root.style.removeProperty(ARTWORK_RGB_VAR);
  }
}
