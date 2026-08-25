import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import {
  clearSongCache,
  getSongCacheStats,
  patchSettings,
  loadSettings,
  libraryReset,
  type SongCacheStats,
} from "@lx/tauri-bridge";
import { useThemeStore } from "@/stores/themeStore";
import { useHistoryStore } from "@/stores/historyStore";
import { useCustomSourceStore } from "@/stores/customSourceStore";
import { useBiliAccountStore } from "@/stores/biliAccountStore";
import { broadcastLyricSettings } from "@/stores/lyricSettingsSync";
import {
  assertBiliCookieShape,
  getBiliCookie,
  setBiliCookie,
} from "@/services/biliAccountService";
import { playerEngine } from "@/services/playerEngine";
import { normalizePauseOnExternalPlayback } from "@/services/mediaInterruptionPolicy";
import { clearPersistentCache } from "@/services/persistentCache";
import { clearPlaybackPrefetchCache } from "@/services/playback/prefetchService";
import { notifyAppBackgroundChanged, toAppBackgroundImageUrl } from "@/services/appBackground";

const DEFAULT_IMMERSIVE_LYRIC_FONT_FAMILY = "\"Inter\", \"Noto Sans CJK SC\", \"PingFang SC\", \"Microsoft YaHei\", sans-serif";
const HEX_COLOR_PATTERN = /^#?[0-9a-fA-F]{6}$/;
const BYTE_UNITS = ["B", "KB", "MB", "GB"] as const;

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

export function formatByteSize(bytes: number | null): string {
  if (bytes == null) return "计算中...";
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";

  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const fractionDigits = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(fractionDigits)} ${BYTE_UNITS[unitIndex]}`;
}

export function useSettingsViewModel() {
const {
  theme,
  accentColor,
  setTheme,
  setAccentColor,
  resetAccentColor,
} = useThemeStore();
const [accentColorInput, setAccentColorInput] = useState(accentColor.toUpperCase());
const isAccentColorInputValid = HEX_COLOR_PATTERN.test(accentColorInput.trim());
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
const [customScriptText, setCustomScriptText] = useState("");
const [customSourceStatus, setCustomSourceStatus] = useState("");
const [customSourceAutoCheck, setCustomSourceAutoCheck] = useState(true);
const [biliCookieText, setBiliCookieText] = useState("");
const [biliCookieStatus, setBiliCookieStatus] = useState("");
const [biliCookiePending, setBiliCookiePending] = useState(false);
const [immersiveLyricFontFamily, setImmersiveLyricFontFamily] = useState(DEFAULT_IMMERSIVE_LYRIC_FONT_FAMILY);
const [songCacheStats, setSongCacheStats] = useState<SongCacheStats | null>(null);
const [dataPending, setDataPending] = useState(false);
const [dataStatus, setDataStatus] = useState("");
const {
  sources: customSources,
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
const biliAccount = useBiliAccountStore((s) => s.account);
const biliLoad = useBiliAccountStore((s) => s.load);
const biliLogout = useBiliAccountStore((s) => s.logout);

const refreshSongCacheStats = async () => {
  const stats = await getSongCacheStats();
  setSongCacheStats(stats);
  return stats;
};

// 初始化加载已保存设置
useEffect(() => {
  loadSettings().then(settings => {
    if (settings.defaultQuality) setDefaultQuality(normalizeQualityValue(settings.defaultQuality));
    const nextPauseOnExternalPlayback = normalizePauseOnExternalPlayback(settings.pauseOnExternalPlayback);
    setPauseOnExternalPlayback(nextPauseOnExternalPlayback);
    playerEngine.setPauseOnExternalPlayback(nextPauseOnExternalPlayback);
    setCustomSourceAutoCheck(settings.customSourceAutoCheck !== false);
    setAppBackgroundImagePath(settings.appBackgroundImagePath ?? "");
    setBiliCookieText(settings.biliCookie ?? "");
    setImmersiveLyricFontFamily(settings.immersiveLyricFontFamily || DEFAULT_IMMERSIVE_LYRIC_FONT_FAMILY);
  }).catch((error) => {
    setDataStatus(`读取设置失败：${error instanceof Error ? error.message : String(error)}`);
  });
}, []);

useEffect(() => {
  refreshSongCacheStats().catch((error) => {
    setDataStatus(`读取缓存大小失败：${error instanceof Error ? error.message : String(error)}`);
  });
}, []);

useEffect(() => {
  setAccentColorInput(accentColor.toUpperCase());
}, [accentColor]);

const handleAccentColorTextChange = (nextValue: string) => {
  setAccentColorInput(nextValue);
  const trimmed = nextValue.trim();
  if (!HEX_COLOR_PATTERN.test(trimmed)) return;
  const normalized = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  setAccentColor(normalized);
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

const patchPlaybackSetting = (patch: Record<string, unknown>) => {
  patchSettings(patch).catch((error) => {
    console.error("保存播放设置失败", error);
  });
};

const handlePauseOnExternalPlaybackChange = async (next: boolean) => {
  const previous = pauseOnExternalPlayback;
  setPauseOnExternalPlayback(next);
  playerEngine.setPauseOnExternalPlayback(next);
  try {
    await patchSettings({ pauseOnExternalPlayback: next });
  } catch (error) {
    setPauseOnExternalPlayback(previous);
    playerEngine.setPauseOnExternalPlayback(previous);
  }
};

const handleCustomSourceAutoCheckToggle = () => {
  const next = !customSourceAutoCheck;
  setCustomSourceAutoCheck(next);
  patchSettings({ customSourceAutoCheck: next }).catch(() => {
    setCustomSourceAutoCheck(!next);
  });
};

const openBilibiliWeb = () => {
  void openUrl("https://www.bilibili.com").catch(() => {
    setBiliCookieStatus("无法打开浏览器，请手动访问 www.bilibili.com");
  });
};

const handleSaveBiliCookie = async () => {
  const raw = biliCookieText.trim();
  if (!raw) {
    setBiliCookieStatus("请先粘贴 B站 Cookie");
    return;
  }

  try {
    assertBiliCookieShape(raw);
  } catch (error) {
    setBiliCookieStatus(error instanceof Error ? error.message : String(error));
    return;
  }

  const previousCookie = await getBiliCookie();
  const previousState = {
    account: useBiliAccountStore.getState().account,
    playlists: useBiliAccountStore.getState().playlists,
    isLoading: false,
    isLoaded: useBiliAccountStore.getState().isLoaded,
    error: useBiliAccountStore.getState().error,
  };
  setBiliCookiePending(true);
  setBiliCookieStatus("验证中...");
  try {
    const normalized = setBiliCookie(raw);
    await patchSettings({ biliCookie: normalized });
    await biliLoad(normalized);
    const latest = useBiliAccountStore.getState();
    if (!latest.account) throw new Error(latest.error || "B站 Cookie 验证失败");
    setBiliCookieText(normalized);
    setBiliCookieStatus(`已同步：${latest.account.nickname}`);
  } catch (error) {
    setBiliCookie(previousCookie);
    useBiliAccountStore.setState(previousState);
    await patchSettings({ biliCookie: previousCookie || null });
    setBiliCookieStatus(error instanceof Error ? error.message : String(error));
  } finally {
    setBiliCookiePending(false);
  }
};

const handleClearBiliCookie = async () => {
  setBiliCookiePending(true);
  setBiliCookieStatus("");
  try {
    await biliLogout();
    setBiliCookieText("");
    setBiliCookieStatus("已退出 B站账号");
  } catch (error) {
    setBiliCookieStatus(error instanceof Error ? error.message : String(error));
  } finally {
    setBiliCookiePending(false);
  }
};

const patchImmersiveLyricStyle = (patch: {
  immersiveLyricFontFamily?: string;
}) => {
  broadcastLyricSettings(patch);
  patchSettings(patch).catch((error) => {
    console.error("保存沉浸式歌词设置失败", error);
  });
};

const handleImmersiveLyricFontFamilyChange = (next: string) => {
  setImmersiveLyricFontFamily(next);
  patchImmersiveLyricStyle({ immersiveLyricFontFamily: next });
};

const handleImportCustomSourceFile = async () => {
  setCustomSourceStatus("导入中...");
  try {
    const source = await importFromFile();
    setCustomSourceStatus(source ? `已导入：${source.name}` : "已取消导入");
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

const handleClearHistoryAndCache = async () => {
  if (!confirm('确定清空播放历史与缓存？\n\n清空历史、播放链接、歌词、音频和封面。')) return;
  setDataStatus("清理中...");
  setDataPending(true);
  try {
    await libraryReset("recent");
    useHistoryStore.getState().replaceAll([]);
    await clearPersistentCache();
    clearPlaybackPrefetchCache();
    const stats = await clearSongCache();
    setSongCacheStats(stats);
    setDataStatus("已清空播放历史与缓存。");
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
    accentColorInput,
    setAccentColorInput,
    isAccentColorInputValid,
    appBackgroundImagePath,
    setAppBackgroundImagePath,
    appBackgroundStatus,
    appBackgroundPreviewUrl,
    defaultQuality,
    setDefaultQuality,
    pauseOnExternalPlayback,
    setPauseOnExternalPlayback,
    customScriptText,
    setCustomScriptText,
    customSourceStatus,
    setCustomSourceStatus,
    customSourceAutoCheck,
    setCustomSourceAutoCheck,
    biliCookieText,
    setBiliCookieText,
    biliCookieStatus,
    setBiliCookieStatus,
    biliCookiePending,
    setBiliCookiePending,
    immersiveLyricFontFamily,
    setImmersiveLyricFontFamily,
    songCacheStats,
    setSongCacheStats,
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
    biliAccount,
    biliLoad,
    biliLogout,
    handleAccentColorTextChange,
    handleSelectAppBackground,
    handleClearAppBackground,
    patchPlaybackSetting,
    handlePauseOnExternalPlaybackChange,
    handleCustomSourceAutoCheckToggle,
    openBilibiliWeb,
    handleSaveBiliCookie,
    handleClearBiliCookie,
    patchImmersiveLyricStyle,
    handleImmersiveLyricFontFamilyChange,
    handleImportCustomSourceFile,
    handleImportCustomSourceText,
    handleClearHistoryAndCache,
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
  | "accentColorInput"
  | "setAccentColorInput"
  | "isAccentColorInputValid"
  | "appBackgroundImagePath"
  | "appBackgroundStatus"
  | "appBackgroundPreviewUrl"
  | "handleAccentColorTextChange"
  | "handleSelectAppBackground"
  | "handleClearAppBackground"
  | "immersiveLyricFontFamily"
  | "handleImmersiveLyricFontFamilyChange"
>;

export type PlaybackSettingsModel = Pick<SettingsViewModel,
  | "defaultQuality"
  | "setDefaultQuality"
  | "pauseOnExternalPlayback"
  | "patchPlaybackSetting"
  | "handlePauseOnExternalPlaybackChange"
>;

export type SourcesSettingsModel = Pick<SettingsViewModel,
  | "customScriptText"
  | "setCustomScriptText"
  | "customSourceStatus"
  | "customSourceAutoCheck"
  | "biliCookieText"
  | "setBiliCookieText"
  | "biliCookieStatus"
  | "biliCookiePending"
  | "customSources"
  | "removeSource"
  | "toggleSource"
  | "moveSource"
  | "testSource"
  | "checkSourceUpdate"
  | "checkAllUpdates"
  | "toggleUpdateAlert"
  | "biliAccount"
  | "handleCustomSourceAutoCheckToggle"
  | "openBilibiliWeb"
  | "handleSaveBiliCookie"
  | "handleClearBiliCookie"
  | "handleImportCustomSourceFile"
  | "handleImportCustomSourceText"
  | "getUpdateStatusMessage"
  | "getTestStatusMessage"
  | "getVersionLabel"
  | "getCapabilityTitle"
>;

export type DataSettingsModel = Pick<SettingsViewModel,
  | "songCacheStats"
  | "dataPending"
  | "dataStatus"
  | "handleClearHistoryAndCache"
>;
