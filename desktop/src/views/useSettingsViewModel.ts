import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  clearMediaCache,
  getMediaCacheStats,
  patchSettings,
  loadSettings,
  libraryReset,
  type MediaCacheStats,
} from "@lx/tauri-bridge";
import { useThemeStore } from "@/stores/themeStore";
import { useHistoryStore } from "@/stores/historyStore";
import { useCustomSourceStore } from "@/stores/customSourceStore";
import { broadcastLyricSettings } from "@/stores/lyricSettingsSync";
import { playerEngine } from "@/services/playerEngine";
import { normalizePauseOnExternalPlayback } from "@/services/mediaInterruptionPolicy";
import {
  clearCachedLyrics,
  clearCachedPlaybackUrls,
  getPersistentCacheSummary,
  invalidateCachedLocalMedia,
  type PersistentCacheSummary,
} from "@/services/persistentCache";
import { clearLyricsMemoryCache } from "@/services/lyricsService";
import { formatBytes } from "@/utils/formatBytes";
import { setPlaybackFailedAutoNext as applyPlaybackFailedAutoNext } from "@/stores/playerStore";
import { clearPlaybackPrefetchCache } from "@/services/playback/prefetchService";
import { notifyAppBackgroundChanged, toAppBackgroundImageUrl } from "@/services/appBackground";

const DEFAULT_IMMERSIVE_LYRIC_FONT_FAMILY = "\"Inter\", \"Noto Sans CJK SC\", \"PingFang SC\", \"Microsoft YaHei\", sans-serif";
const HEX_COLOR_PATTERN = /^#?[0-9a-fA-F]{6}$/;
export const IMMERSIVE_LYRIC_FONT_OPTIONS = [
  {
    label: "系统默认",
    value: DEFAULT_IMMERSIVE_LYRIC_FONT_FAMILY,
  },
  {
    label: "霞鹜文楷",
    value: "\"LXGW WenKai Screen\", \"LXGW WenKai\", \"霞鹜文楷 屏幕阅读版\", \"霞鹜文楷\", \"KaiTi\", \"STKaiti\", serif",
  },
  {
    label: "思源宋体",
    value: "\"Source Han Serif SC\", \"Noto Serif CJK SC\", \"思源宋体\", \"Songti SC\", \"STSong\", serif",
  },
  {
    label: "HarmonyOS Sans",
    value: "\"HarmonyOS Sans SC\", \"HarmonyOS Sans\", \"PingFang SC\", \"Microsoft YaHei\", sans-serif",
  },
  {
    label: "獅尾四季春加糖SC",
    value: "\"獅尾四季春加糖SC\", \"Noto Serif CJK SC\", \"Source Han Serif SC\", \"Songti SC\", \"STSong\", serif",
  },
];

/** 把 hex 输入框的草稿归一成 `#rrggbb`；非法输入返回 null（用于回滚）。 */
function normalizeAccentInput(value: string): string | null {
  const trimmed = value.trim();
  if (!HEX_COLOR_PATTERN.test(trimmed)) return null;
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

export function formatByteSize(bytes: number | null): string {
  // 历史行为：无数据占位「计算中...」，0 与非法值显示「0 B」（与下载页的 '--' 不同）
  return formatBytes(bytes, "计算中...");
}

export function useSettingsViewModel() {
const {
  theme,
  accentColor,
  setTheme,
  setAccentColor,
  resetAccentColor,
  artworkAmbienceEnabled,
  artworkAmbienceIntensity,
  artworkAmbienceScope,
  backgroundBlur,
  backgroundBrightness,
  backgroundMaskOpacity,
  gradientBackgroundEnabled,
  gradientBackgroundFollowArtwork,
  patchAppearance,
  resetAppearance,
  previewAccentColor,
} = useThemeStore();
const [accentColorInput, setAccentColorInput] = useState(accentColor.toUpperCase());
const normalizedAccentInput = normalizeAccentInput(accentColorInput);
const isAccentColorInputValid = normalizedAccentInput !== null;
const isAccentColorInputDirty = normalizedAccentInput !== null && normalizedAccentInput.toLowerCase() !== accentColor;
const [appBackgroundImagePath, setAppBackgroundImagePath] = useState("");
const [appBackgroundStatus, setAppBackgroundStatus] = useState("");
const appBackgroundPreviewUrl = toAppBackgroundImageUrl(appBackgroundImagePath);

const normalizeQualityValue = (value: string) => {
  if (value === "high") return "320k";
  if (value === "medium") return "192k";
  if (value === "low") return "128k";
  return value || "320k";
};

// 播放设置
const [defaultQuality, setDefaultQuality] = useState("320k");
const [pauseOnExternalPlayback, setPauseOnExternalPlayback] = useState(true);
const [playbackFailedAutoNext, setPlaybackFailedAutoNext] = useState(false);
const [playbackSettingsStatus, setPlaybackSettingsStatus] = useState("");
const [appearanceStatus, setAppearanceStatus] = useState("");
const [customScriptText, setCustomScriptText] = useState("");
const [customSourceStatus, setCustomSourceStatus] = useState("");
const [customSourceFeaturePending, setCustomSourceFeaturePending] = useState(false);
const [customSourceFeatureError, setCustomSourceFeatureError] = useState("");
const [customSourceAutoCheck, setCustomSourceAutoCheck] = useState(true);
const [immersiveLyricFontFamily, setImmersiveLyricFontFamily] = useState(DEFAULT_IMMERSIVE_LYRIC_FONT_FAMILY);
const [mediaCacheStats, setMediaCacheStats] = useState<MediaCacheStats | null>(null);
const [persistentCacheSummary, setPersistentCacheSummary] = useState<PersistentCacheSummary | null>(null);
const [dataPending, setDataPending] = useState(false);
const [dataStatus, setDataStatus] = useState("");
const {
  sources: customSources,
  featureEnabled,
  featureReady,
  featureLoadError,
  setFeatureEnabled,
  importScript,
  importFromFile,
  removeSource,
  toggleSource,
  moveSource,
  testSource,
  checkSourceUpdate,
  checkAllUpdates,
  toggleUpdateAlert,
} = useCustomSourceStore();

const refreshCacheStats = async () => {
  const [stats, summary] = await Promise.all([getMediaCacheStats(), getPersistentCacheSummary()]);
  setMediaCacheStats(stats);
  setPersistentCacheSummary(summary);
  return stats;
};

// 初始化加载已保存设置
useEffect(() => {
  loadSettings().then(settings => {
    if (settings.defaultQuality) setDefaultQuality(normalizeQualityValue(settings.defaultQuality));
    const nextPauseOnExternalPlayback = normalizePauseOnExternalPlayback(settings.pauseOnExternalPlayback);
    setPauseOnExternalPlayback(nextPauseOnExternalPlayback);
    playerEngine.setPauseOnExternalPlayback(nextPauseOnExternalPlayback);
    const nextAutoNext = settings.playbackFailedAutoNext === true;
    setPlaybackFailedAutoNext(nextAutoNext);
    applyPlaybackFailedAutoNext(nextAutoNext);
    setCustomSourceAutoCheck(settings.customSourceAutoCheck !== false);
    setAppBackgroundImagePath(settings.appBackgroundImagePath ?? "");
    setImmersiveLyricFontFamily(settings.immersiveLyricFontFamily || DEFAULT_IMMERSIVE_LYRIC_FONT_FAMILY);
  }).catch((error) => {
    setDataStatus(`读取设置失败：${error instanceof Error ? error.message : String(error)}`);
  });
}, []);

useEffect(() => {
  refreshCacheStats().catch((error) => {
    setDataStatus(`读取缓存占用失败：${error instanceof Error ? error.message : String(error)}`);
  });
}, []);

useEffect(() => {
  setAccentColorInput(accentColor.toUpperCase());
}, [accentColor]);

// 组件卸载（例如切到别的设置分类）时，把还没提交的实时预览刷回存档值
useEffect(() => () => {
  previewAccentColor(useThemeStore.getState().accentColor);
}, [previewAccentColor]);

// 输入时只预览（不落盘）、回车或失焦提交、Esc 或非法输入回滚到存档值
const handleAccentColorTextChange = (nextValue: string) => {
  setAccentColorInput(nextValue);
  previewAccentColor(normalizeAccentInput(nextValue) ?? accentColor);
};

const handleAccentColorTextCommit = () => {
  if (normalizedAccentInput) setAccentColor(normalizedAccentInput);
  else handleAccentColorTextCancel();
};

const handleAccentColorTextCancel = () => {
  previewAccentColor(accentColor);
  setAccentColorInput(accentColor.toUpperCase());
};

const handleSelectAppBackground = async () => {
  setAppBackgroundStatus("");
  try {
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [
        {
          name: "图片",
          extensions: ["png", "jpg", "jpeg", "webp", "bmp"],
        },
      ],
    });
    if (typeof selected !== "string") return;
    await patchSettings({ appBackgroundImagePath: selected });
    setAppBackgroundImagePath(selected);
    notifyAppBackgroundChanged(selected);
    setAppBackgroundStatus("已应用主界面背景。");
  } catch (error) {
    setAppBackgroundStatus(`设置背景失败：${error instanceof Error ? error.message : String(error)}`);
  }
};

const handleClearAppBackground = async () => {
  setAppBackgroundStatus("");
  try {
    await patchSettings({ appBackgroundImagePath: null });
    setAppBackgroundImagePath("");
    notifyAppBackgroundChanged(null);
    setAppBackgroundStatus("已恢复默认背景。");
  } catch (error) {
    setAppBackgroundStatus(`清除背景失败：${error instanceof Error ? error.message : String(error)}`);
  }
};

const patchPlaybackSetting = async (patch: Record<string, unknown>): Promise<boolean> => {
  setPlaybackSettingsStatus("");
  try {
    await patchSettings(patch);
    return true;
  } catch (error) {
    setPlaybackSettingsStatus(`保存失败：${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
};

const handleDefaultQualityChange = async (quality: string) => {
  const previous = defaultQuality;
  setDefaultQuality(quality);
  if (!(await patchPlaybackSetting({ defaultQuality: quality }))) setDefaultQuality(previous);
};

const handlePauseOnExternalPlaybackChange = async (next: boolean) => {
  const previous = pauseOnExternalPlayback;
  setPauseOnExternalPlayback(next);
  playerEngine.setPauseOnExternalPlayback(next);
  if (!(await patchPlaybackSetting({ pauseOnExternalPlayback: next }))) {
    setPauseOnExternalPlayback(previous);
    playerEngine.setPauseOnExternalPlayback(previous);
  }
};

const handlePlaybackFailedAutoNextChange = async (enabled: boolean) => {
  const previous = playbackFailedAutoNext;
  setPlaybackFailedAutoNext(enabled);
  applyPlaybackFailedAutoNext(enabled);
  if (!(await patchPlaybackSetting({ playbackFailedAutoNext: enabled }))) {
    setPlaybackFailedAutoNext(previous);
    applyPlaybackFailedAutoNext(previous);
  }
};

const handleCustomSourceFeatureChange = async (enabled: boolean) => {
  setCustomSourceFeaturePending(true);
  setCustomSourceFeatureError("");
  try {
    await setFeatureEnabled(enabled);
  } catch (error) {
    setCustomSourceFeatureError(`保存 LX 自定义音源开关失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    setCustomSourceFeaturePending(false);
  }
};

const handleCustomSourceAutoCheckToggle = () => {
  const next = !customSourceAutoCheck;
  setCustomSourceAutoCheck(next);
  setCustomSourceStatus("");
  patchSettings({ customSourceAutoCheck: next }).catch((error) => {
    setCustomSourceAutoCheck(!next);
    setCustomSourceStatus(`保存自动检测开关失败：${error instanceof Error ? error.message : String(error)}`);
  });
};

const handleImmersiveLyricFontFamilyChange = async (next: string) => {
  const previous = immersiveLyricFontFamily;
  setImmersiveLyricFontFamily(next);
  setAppearanceStatus("");
  try {
    broadcastLyricSettings({ immersiveLyricFontFamily: next });
    await patchSettings({ immersiveLyricFontFamily: next });
  } catch (error) {
    setImmersiveLyricFontFamily(previous);
    broadcastLyricSettings({ immersiveLyricFontFamily: previous });
    setAppearanceStatus(`保存歌词字体失败：${error instanceof Error ? error.message : String(error)}`);
  }
};

const handleImportCustomSourceFile = async () => {
  setCustomSourceStatus("导入中...");
  try {
    const source = await importFromFile();
    // 取消不是一次操作：不写状态行，否则「已取消导入」会一直留在设置页
    setCustomSourceStatus(source ? `已导入：${source.name}` : "");
  } catch (error) {
    setCustomSourceStatus(error instanceof Error ? error.message : String(error));
  }
};

const handleImportCustomSourceText = async () => {
  setCustomSourceStatus("导入中...");
  try {
    if (!customScriptText.trim()) throw new Error("请先粘贴 LX Music 自定义音源脚本");
    const source = await importScript(customScriptText);
    setCustomScriptText("");
    setCustomSourceStatus(`已导入：${source.name}`);
  } catch (error) {
    setCustomSourceStatus(error instanceof Error ? error.message : String(error));
  }
};

const handleClearPlaybackHistory = async () => {
  if (!confirm('确定清空播放历史？\n\n不会删除收藏、歌单或缓存。')) return;
  setDataStatus("清理中...");
  setDataPending(true);
  try {
    await libraryReset("recent");
    useHistoryStore.getState().replaceAll([]);
    setDataStatus("已清空播放历史。");
  } catch (err) {
    setDataStatus(`清理失败：${err instanceof Error ? err.message : String(err)}`);
  } finally {
    setDataPending(false);
  }
};

const handleClearMediaCache = async () => {
  if (!confirm('确定清理资源缓存？\n\n歌曲音频与封面文件会被删除，播放地址和歌词缓存保留。')) return;
  setDataStatus("清理中...");
  setDataPending(true);
  try {
    clearPlaybackPrefetchCache();
    // 先作废持久化条目里的本地文件引用：URL 缓存的 TTL 是 365 天，
    // 文件删掉后条目仍是「有效」的本地地址，下一次播放会先命中死链再回退重解析。
    await invalidateCachedLocalMedia();
    await clearMediaCache();
    await refreshCacheStats();
    setDataStatus("已清理资源缓存。");
  } catch (err) {
    setDataStatus(`清理失败：${err instanceof Error ? err.message : String(err)}`);
  } finally {
    setDataPending(false);
  }
};

const handleClearPlaybackUrlCache = async () => {
  if (!confirm('确定清理歌曲 URL 缓存？\n\n下次播放会重新解析播放地址，歌词与音频/封面缓存保留。')) return;
  setDataStatus("清理中...");
  setDataPending(true);
  try {
    clearPlaybackPrefetchCache();
    await clearCachedPlaybackUrls();
    await refreshCacheStats();
    setDataStatus("已清理歌曲 URL 缓存。");
  } catch (err) {
    setDataStatus(`清理失败：${err instanceof Error ? err.message : String(err)}`);
  } finally {
    setDataPending(false);
  }
};

const handleClearLyricsCache = async () => {
  if (!confirm('确定清空歌词缓存？\n\n下次播放会重新获取歌词，不影响音频、封面和播放地址缓存。')) return;
  setDataStatus("清理中...");
  setDataPending(true);
  try {
    await clearCachedLyrics();
    clearLyricsMemoryCache();
    await refreshCacheStats();
    setDataStatus("已清空歌词缓存。");
  } catch (err) {
    setDataStatus(`清理失败：${err instanceof Error ? err.message : String(err)}`);
  } finally {
    setDataPending(false);
  }
};

const getUpdateStatusMessage = (source: typeof customSources[number]) => {
  if (source.updateStatus === "available") return source.updateLog || "自定义音源提示有新版本";
  if (source.updateStatus === "latest") return "";
  if (source.updateMessage) return source.updateMessage;
  return "";
};

const getTestStatusMessage = (source: typeof customSources[number]) => {
  if (source.testStatus === "failed" || source.testStatus === "testing") return source.testMessage;
  return "";
};

const getVersionLabel = (version?: string) => {
  if (!version) return "";
  return /^v/i.test(version) ? version : `v${version}`;
};

const getCapabilityTitle = (source: typeof customSources[number]) => {
  const entries = Object.entries(source.sources ?? {}) as Array<[string, NonNullable<typeof source.sources>[string]]>;
  if (entries.length === 0) return "未声明平台能力";
  return entries
    .map(([key, info]) => `${key.toUpperCase()} · ${info.qualitys.join("/") || "musicUrl"}`)
    .join("\n");
};
  return {
    theme,
    accentColor,
    setTheme,
    setAccentColor,
    resetAccentColor,
    artworkAmbienceEnabled,
    artworkAmbienceIntensity,
    artworkAmbienceScope,
    backgroundBlur,
    backgroundBrightness,
    backgroundMaskOpacity,
    gradientBackgroundEnabled,
    gradientBackgroundFollowArtwork,
    patchAppearance,
    resetAppearance,
    previewAccentColor,
    accentColorInput,
    isAccentColorInputValid,
    isAccentColorInputDirty,
    appBackgroundImagePath,
    setAppBackgroundImagePath,
    appBackgroundStatus,
    appBackgroundPreviewUrl,
    appearanceStatus,
    defaultQuality,
    setDefaultQuality,
    pauseOnExternalPlayback,
    setPauseOnExternalPlayback,
    playbackFailedAutoNext,
    playbackSettingsStatus,
    handleDefaultQualityChange,
    handlePlaybackFailedAutoNextChange,
    featureEnabled,
    featureReady,
    customSourceFeaturePending,
    customSourceFeatureError: customSourceFeatureError || featureLoadError || "",
    handleCustomSourceFeatureChange,
    customScriptText,
    setCustomScriptText,
    customSourceStatus,
    setCustomSourceStatus,
    customSourceAutoCheck,
    setCustomSourceAutoCheck,
    immersiveLyricFontFamily,
    setImmersiveLyricFontFamily,
    mediaCacheStats,
    setMediaCacheStats,
    persistentCacheSummary,
    dataPending,
    setDataPending,
    dataStatus,
    setDataStatus,
    customSources,
    importScript,
    importFromFile,
    removeSource,
    toggleSource,
    moveSource,
    testSource,
    checkSourceUpdate,
    checkAllUpdates,
    toggleUpdateAlert,
    handleAccentColorTextChange,
    handleAccentColorTextCommit,
    handleAccentColorTextCancel,
    handleSelectAppBackground,
    handleClearAppBackground,
    handlePauseOnExternalPlaybackChange,
    handleCustomSourceAutoCheckToggle,
    handleImmersiveLyricFontFamilyChange,
    handleImportCustomSourceFile,
    handleImportCustomSourceText,
    handleClearPlaybackHistory,
    handleClearMediaCache,
    handleClearPlaybackUrlCache,
    handleClearLyricsCache,
    getUpdateStatusMessage,
    getTestStatusMessage,
    getVersionLabel,
    getCapabilityTitle,
  };
}

export type SettingsViewModel = ReturnType<typeof useSettingsViewModel>;

export type AppearanceSettingsModel = Pick<SettingsViewModel,
  | "theme"
  | "accentColor"
  | "setTheme"
  | "setAccentColor"
  | "resetAccentColor"
  | "artworkAmbienceEnabled"
  | "artworkAmbienceIntensity"
  | "artworkAmbienceScope"
  | "backgroundBlur"
  | "backgroundBrightness"
  | "backgroundMaskOpacity"
  | "gradientBackgroundEnabled"
  | "gradientBackgroundFollowArtwork"
  | "patchAppearance"
  | "resetAppearance"
  | "accentColorInput"
  | "isAccentColorInputValid"
  | "isAccentColorInputDirty"
  | "appBackgroundImagePath"
  | "appBackgroundStatus"
  | "appBackgroundPreviewUrl"
  | "appearanceStatus"
  | "handleAccentColorTextChange"
  | "handleAccentColorTextCommit"
  | "handleAccentColorTextCancel"
  | "handleSelectAppBackground"
  | "handleClearAppBackground"
  | "immersiveLyricFontFamily"
  | "handleImmersiveLyricFontFamilyChange"
>;

export type PlaybackSettingsModel = Pick<SettingsViewModel,
  | "defaultQuality"
  | "handleDefaultQualityChange"
  | "pauseOnExternalPlayback"
  | "handlePauseOnExternalPlaybackChange"
  | "playbackFailedAutoNext"
  | "handlePlaybackFailedAutoNextChange"
  | "playbackSettingsStatus"
>;

export type SourcesSettingsModel = Pick<SettingsViewModel,
  | "featureEnabled"
  | "featureReady"
  | "customSourceFeaturePending"
  | "customSourceFeatureError"
  | "handleCustomSourceFeatureChange"
  | "customScriptText"
  | "setCustomScriptText"
  | "customSourceStatus"
  | "customSourceAutoCheck"
  | "customSources"
  | "removeSource"
  | "toggleSource"
  | "moveSource"
  | "testSource"
  | "checkSourceUpdate"
  | "checkAllUpdates"
  | "toggleUpdateAlert"
  | "handleCustomSourceAutoCheckToggle"
  | "handleImportCustomSourceFile"
  | "handleImportCustomSourceText"
  | "getUpdateStatusMessage"
  | "getTestStatusMessage"
  | "getVersionLabel"
  | "getCapabilityTitle"
>;

export type DataSettingsModel = Pick<SettingsViewModel,
  | "mediaCacheStats"
  | "persistentCacheSummary"
  | "dataPending"
  | "dataStatus"
  | "handleClearPlaybackHistory"
  | "handleClearMediaCache"
  | "handleClearPlaybackUrlCache"
  | "handleClearLyricsCache"
>;
