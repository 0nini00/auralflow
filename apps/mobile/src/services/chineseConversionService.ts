/**
 * 歌词简繁转换服务。
 *
 * 使用 opencc-js 的 Locale 预设，按需构造转换器：
 * - "s2t": 简体 → 繁体（词典 ~1MB，按需加载）
 * - "t2s": 繁体 → 简体（词典 ~100KB）
 * - "off": 关闭，返回原文
 *
 * 转换器构造后缓存在模块级 Map 中，同 mode 复用同一实例。
 * OpenCC 的 Converter 是同步 API，可直接在渲染函数里调用；本地基准 ~1000 行歌词
 * 转换在 <5ms（RN 主线程可接受）。
 */
import { Converter } from "opencc-js";

export type ChineseConversionMode = "off" | "s2t" | "t2s";

export const CHINESE_CONVERSION_MODE_SEQUENCE: readonly ChineseConversionMode[] = [
  "off",
  "s2t",
  "t2s",
];

type ConverterFn = (text: string) => string;

const converterCache = new Map<ChineseConversionMode, ConverterFn>();

function buildConverter(mode: ChineseConversionMode): ConverterFn {
  if (mode === "s2t") {
    return Converter({ from: "cn", to: "tw" });
  }
  if (mode === "t2s") {
    return Converter({ from: "tw", to: "cn" });
  }
  return (text: string) => text;
}

/**
 * 获取指定模式的转换器函数（惰性构造 + 缓存）。
 * "off" 模式返回恒等函数，调用方无需分支判断。
 */
export function getChineseConverter(mode: ChineseConversionMode): ConverterFn {
  const cached = converterCache.get(mode);
  if (cached) return cached;
  const converter = buildConverter(mode);
  converterCache.set(mode, converter);
  return converter;
}

/** 单次转换。空文本、"off" 模式或纯 ASCII 快速返回原文，避免无谓开销。 */
export function convertChineseText(text: string, mode: ChineseConversionMode): string {
  if (mode === "off" || !text) return text;
  // 纯 ASCII 无需转换（含大量英文歌词的场景常见，规避词典查找）
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(text)) return text;
  return getChineseConverter(mode)(text);
}

/** 循环切换：off → s2t → t2s → off。 */
export function getNextChineseConversionMode(mode: ChineseConversionMode): ChineseConversionMode {
  const index = CHINESE_CONVERSION_MODE_SEQUENCE.indexOf(mode);
  if (index < 0) return CHINESE_CONVERSION_MODE_SEQUENCE[0];
  return CHINESE_CONVERSION_MODE_SEQUENCE[(index + 1) % CHINESE_CONVERSION_MODE_SEQUENCE.length];
}

const CHINESE_CONVERSION_LABELS: Record<ChineseConversionMode, string> = {
  off: "繁 关",
  s2t: "简→繁",
  t2s: "繁→简",
};

export function getChineseConversionLabel(mode: ChineseConversionMode): string {
  return CHINESE_CONVERSION_LABELS[mode];
}

export interface ImmersiveChineseConversionControlModel {
  label: string;
  active: boolean;
  nextMode: ChineseConversionMode;
}

/** 沉浸式播放页「繁」按钮模型，风格对齐 buildImmersiveTranslationControl。 */
export function buildImmersiveChineseConversionControl(
  mode: ChineseConversionMode,
): ImmersiveChineseConversionControlModel {
  return {
    label: getChineseConversionLabel(mode),
    active: mode !== "off",
    nextMode: getNextChineseConversionMode(mode),
  };
}
