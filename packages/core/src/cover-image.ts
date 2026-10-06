/**
 * 封面缩略图 URL —— 双端共用。
 *
 * 各图床返回的默认封面是原图（网易云常见 1000x1000 以上，实测有 4MB 的样本），
 * 列表里几十个 item 同时拉原图会明显拖慢首屏与滚动。这里按显示尺寸改写 URL，
 * 让图床直接返回缩略图。
 *
 * 只处理已知支持尺寸参数的图床；未知图床原样返回，不做猜测。
 */

/**
 * 移动端列表缩略图边长（px）。按 2-3x 屏下 60-80pt 的封面取值。
 *
 * 注意：`resizeCoverUrl` 会把它向上量化到 300 档，所以移动端列表实际取的是 300。
 * 保持 200 是为了不改变移动端调用方的入参语义（桌面端用 `coverTierForDisplay` 取档）。
 */
export const COVER_SIZE_THUMB = 200;
/** 移动端播放器 / 详情页大图边长（px），同样向上量化到 600 档。 */
export const COVER_SIZE_LARGE = 500;

const NETEASE_IMAGE_HOSTS = ["music.126.net", "126.net"];
/** 腾讯图床：文件名里带 `R{边长}x{边长}` 这个唯一的尺寸标记。 */
const TENCENT_IMAGE_HOSTS = ["gtimg.cn", "qq.com"];
/** QQ 图床不支持应用通用的 96/450/600 档，必须向上取可用尺寸。 */
const TENCENT_COVER_SIZES = [150, 300, 500, 800] as const;

/**
 * 可选档位（px）：按「滚动列表 / 卡片刻度 / 播放条 / 详情页 / 沉浸页 / 全屏」的
 * 显示尺寸分级，档位数刻意少 —— 档位就是取图的 URL 粒度，档位越多同屏不同用途
 * 越容易各拉一份。需要改分级时改这里一处。
 *
 * - 96：40-56px 的行内小图（列表行缩略图，2x 下 80-112 设备像素）
 * - 150：卡片刻度（约 150px 宽）
 * - 300：播放条等中等尺寸
 * - 450：详情页大图
 * - 600：沉浸播放页
 * - 800：整屏封面，上限
 */
export const COVER_TIERS = [96, 150, 300, 450, 600, 800] as const;


export const COVER_TIER_ROW = 96;
export const COVER_TIER_CARD = 150;
export const COVER_TIER_PLAYER = 300;
export const COVER_TIER_DETAIL = 450;
export const COVER_TIER_IMMERSIVE = 600;
export const COVER_TIER_FULLSCREEN = 800;

/** 档位上限：列表/详情都不该出现超过整屏封面的大图。 */
export const COVER_TIER_MAX = COVER_TIER_FULLSCREEN;

function matchesHost(host: string, suffixes: string[]): boolean {
  return suffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

/**
 * 把目标像素边长量化到档位：取**不小于**目标的第一个档位。
 *
 * - 目标小于最小档位时给最小档位（宁可略大也不给图床要一个它可能不支持的边长）；
 * - 目标超过最大档位时封顶（不按 4K 屏要 2000px 以上的图，代价是极大尺寸下略软）。
 *
 * 纯函数、不读环境：DPR 由调用方乘进来，桌面端与测试共用同一份量化规则。
 */
export function coverTierFor(targetPixels: number): number {
  if (!Number.isFinite(targetPixels) || targetPixels <= 0) return COVER_TIERS[0];
  const found = COVER_TIERS.find((tier) => tier >= targetPixels);
  return found ?? COVER_TIER_MAX;
}

/** 桌面端 `pointer: coarse` 过大的缩放系数只会烧带宽，在这里夹一道。 */
const MAX_DEVICE_PIXEL_RATIO = 3;

/** CSS 像素 × 设备像素比 → 实际需要的设备像素。DPR 缺失/异常时按 1 处理。 */
export function devicePixelSize(cssSize: number, devicePixelRatio: number): number {
  const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
    ? Math.min(devicePixelRatio, MAX_DEVICE_PIXEL_RATIO)
    : 1;
  return cssSize * ratio;
}

/**
 * 「某个用途该取哪一档」的纯计算：CSS 边长 × DPR 后量化到档位。
 *
 * 调用方负责读 `devicePixelRatio` 并传进来，这里不碰任何宿主环境 API，
 * 于是这套分级规则可以直接跑单测。
 */
export function coverTierForDisplay(cssSize: number, devicePixelRatio: number): number {
  return coverTierFor(devicePixelSize(cssSize, devicePixelRatio));
}

/** 按目标边长改写封面 URL。 */
export function resizeCoverUrl(rawUrl: string | null | undefined, size: number): string {
  const value = rawUrl?.trim() ?? "";
  const tier = coverTierFor(size);
  if (!value || size <= 0) return value;
  // 本地文件与 data URL 不做处理
  if (!/^https?:\/\//i.test(value)) return value;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return value;
  }

  const host = url.hostname.toLowerCase();

  if (matchesHost(host, NETEASE_IMAGE_HOSTS)) {
    return withNeteaseSize(value, tier);
  }

  if (matchesHost(host, TENCENT_IMAGE_HOSTS)) {
    return withTencentSize(value, tier);
  }

  return value;
}

/**
 * 网易图床：`?param=NxN` 是它唯一的尺寸指令。
 *
 * 已带 `param=` 时改写而不是保留原值：`param` 只有可能来自我们自己的显示层
 * （数据层的地址不带它），把它当用户显式覆盖会让所有档位都退化成同一个尺寸。
 */
function withNeteaseSize(value: string, size: number): string {
  const [beforeHash, ...hashParts] = value.split("#");
  const hash = hashParts.length ? `#${hashParts.join("#")}` : "";
  const replacement = `param=${size}y${size}`;

  if (/[?&]param=/.test(beforeHash)) {
    return `${beforeHash.replace(/([?&])param=[^&]*/, `$1${replacement}`)}${hash}`;
  }
  const separator = beforeHash.includes("?") ? "&" : "?";
  return `${beforeHash}${separator}${replacement}${hash}`;
}

/**
 * 腾讯图床：尺寸写死在文件名里（`T002R300x300M000{mid}.jpg`），没有 query 参数。
 * 只改 path/query 里的 `R{W}x{H}`，其他一律原样返回。
 */
function withTencentSize(value: string, size: number): string {
  const pattern = /R(\d{1,4})x(\d{1,4})(?=M|\?|&|#|$)/i;
  const [beforeHash, ...hashParts] = value.split("#");
  const hash = hashParts.length ? `#${hashParts.join("#")}` : "";
  // 没有尺寸标记就原样返回：猜一个位置替换可能改坏路径
  if (!pattern.test(beforeHash)) return value;
  const supportedSize = TENCENT_COVER_SIZES.find((candidate) => candidate >= size) ?? 800;
  return `${beforeHash.replace(pattern, `R${supportedSize}x${supportedSize}`)}${hash}`;
}
