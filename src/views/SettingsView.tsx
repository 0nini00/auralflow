import { useState, useEffect } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowUp,
  Bell,
  BellOff,
  Cloud,
  Database,
  Eye,
  EyeOff,
  ExternalLink,
  FlaskConical,
  Info,
  Mic2,
  Music2,
  Moon,
  Pause,
  Palette,
  Pin,
  PinOff,
  RefreshCw,
  RotateCcw,
  Settings2,
  Sun,
  Monitor,
  Trash2,
  Type,
  Volume2,
} from "lucide-react";
import { useThemeStore } from "@/stores/themeStore";
import { useHistoryStore } from "@/stores/historyStore";
import {
  clearSongCache,
  getSongCacheStats,
  patchSettings,
  loadSettings,
  libraryReset,
  isLyricWindowOpen,
  setLyricWindowPinned,
} from "@lx/tauri-bridge";
import { useCustomSourceStore } from "@/stores/customSourceStore";
import { useBiliAccountStore } from "@/stores/biliAccountStore";
import { getBiliCookie, setBiliCookie } from "@/services/biliAccountService";
import { broadcastLyricSettings, subscribeLyricSettings } from "@/stores/lyricSettingsSync";
import { toggleDesktopLyricFromPlayer } from "@/utils/desktopLyricToggle";
import { logAsyncError, warnAsyncError } from "@/utils/logAsyncError";
import { openCustomSourceUpdateModal } from "@/components/CustomSourceUpdateModal";
import { playerEngine } from "@/services/playerEngine";
import { normalizePauseOnExternalPlayback } from "@/services/mediaInterruptionPolicy";
import { clearPersistentCache } from "@/services/persistentCache";
import { clearPlaybackPrefetchCache } from "@/services/playback/prefetchService";
import {
  normalizeLyricAnimationIntensity,
  type LyricAnimationIntensity,
} from "@/services/lyrics/animationIntensity";
import logoImg from "@/assets/logo.png";

type SettingsSectionId =
  | "appearance"
  | "playback"
  | "sources"
  | "desktop-lyric"
  | "data"
  | "sync"
  | "misc"
  | "about";

const SETTINGS_NAV = [
  { id: "appearance", label: "外观", icon: Palette },
  { id: "playback", label: "播放", icon: Music2 },
  { id: "sources", label: "音源", icon: Settings2 },
  { id: "desktop-lyric", label: "桌面歌词", icon: Mic2 },
  { id: "data", label: "数据", icon: Database },
  { id: "sync", label: "同步", icon: Cloud },
  { id: "misc", label: "其他", icon: Settings2 },
  { id: "about", label: "关于", icon: Info },
];

type LyricSettingsTab = "basic" | "typography" | "color";

const LYRIC_SETTINGS_TABS: Array<{ id: LyricSettingsTab; label: string }> = [
  { id: "basic", label: "基础" },
  { id: "typography", label: "排版" },
  { id: "color", label: "颜色与背景" },
];

const DEFAULT_IMMERSIVE_LYRIC_FONT_SIZE = 36;
const DEFAULT_IMMERSIVE_LYRIC_FONT_FAMILY = "\"Inter\", \"Noto Sans CJK SC\", \"PingFang SC\", \"Microsoft YaHei\", sans-serif";
const HEX_COLOR_PATTERN = /^#?[0-9a-fA-F]{6}$/;
const BYTE_UNITS = ["B", "KB", "MB", "GB"] as const;

const IMMERSIVE_LYRIC_FONT_OPTIONS = [
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

function formatByteSize(bytes: number | null): string {
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

export function SettingsView() {
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("appearance");
  const {
    theme,
    accentColor,
    setTheme,
    setAccentColor,
    resetAccentColor,
  } = useThemeStore();
  const [accentColorInput, setAccentColorInput] = useState(accentColor.toUpperCase());
  const isAccentColorInputValid = HEX_COLOR_PATTERN.test(accentColorInput.trim());

  const normalizeQualityValue = (value: string) => {
    if (value === "high") return "320k";
    if (value === "medium") return "192k";
    if (value === "low") return "128k";
    return value || "320k";
  };

  // 播放设置
  const [defaultQuality, setDefaultQuality] = useState("320k");
  const [pauseOnExternalPlayback, setPauseOnExternalPlayback] = useState(true);
  const [neteaseScrobbleSync, setNeteaseScrobbleSync] = useState(true);
  const [customScriptText, setCustomScriptText] = useState("");
  const [customSourceStatus, setCustomSourceStatus] = useState("");
  const [customSourceAutoCheck, setCustomSourceAutoCheck] = useState(true);
  const [biliCookieText, setBiliCookieText] = useState("");
  const [biliCookieStatus, setBiliCookieStatus] = useState("");
  const [biliCookiePending, setBiliCookiePending] = useState(false);
  const [immersiveLyricFontSize, setImmersiveLyricFontSize] = useState(DEFAULT_IMMERSIVE_LYRIC_FONT_SIZE);
  const [immersiveLyricFontFamily, setImmersiveLyricFontFamily] = useState(DEFAULT_IMMERSIVE_LYRIC_FONT_FAMILY);
  const [songCacheSize, setSongCacheSize] = useState<number | null>(null);
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
    setSongCacheSize(stats.totalSize);
    return stats;
  };

  // 初始化加载已保存设置
  useEffect(() => {
    loadSettings().then(settings => {
      if (settings.defaultQuality) setDefaultQuality(normalizeQualityValue(settings.defaultQuality));
      const nextPauseOnExternalPlayback = normalizePauseOnExternalPlayback(settings.pauseOnExternalPlayback);
      setPauseOnExternalPlayback(nextPauseOnExternalPlayback);
      playerEngine.setPauseOnExternalPlayback(nextPauseOnExternalPlayback);
      setNeteaseScrobbleSync(settings.neteaseScrobbleSync !== false);
      setCustomSourceAutoCheck(settings.customSourceAutoCheck !== false);
      setBiliCookieText(settings.biliCookie ?? "");
      setImmersiveLyricFontSize(settings.immersiveLyricFontSize || DEFAULT_IMMERSIVE_LYRIC_FONT_SIZE);
      setImmersiveLyricFontFamily(settings.immersiveLyricFontFamily || DEFAULT_IMMERSIVE_LYRIC_FONT_FAMILY);
    }).catch(logAsyncError("settings:load-playback"));
  }, []);

  useEffect(() => {
    refreshSongCacheStats().catch((error) => {
      setDataStatus(`读取歌曲缓存大小失败：${error instanceof Error ? error.message : String(error)}`);
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

  const patchPlaybackSetting = (patch: Record<string, unknown>) => {
    patchSettings(patch).catch(logAsyncError("settings:patch-playback"));
  };

  const handlePauseOnExternalPlaybackChange = async (next: boolean) => {
    const previous = pauseOnExternalPlayback;
    setPauseOnExternalPlayback(next);
    playerEngine.setPauseOnExternalPlayback(next);
    try {
      await patchSettings({ pauseOnExternalPlayback: next });
    } catch (error) {
      warnAsyncError("settings:patch-pause-on-external-playback", error);
      setPauseOnExternalPlayback(previous);
      playerEngine.setPauseOnExternalPlayback(previous);
    }
  };

  const handleNeteaseScrobbleSyncChange = async (next: boolean) => {
    const previous = neteaseScrobbleSync;
    setNeteaseScrobbleSync(next);
    try {
      await patchSettings({ neteaseScrobbleSync: next });
    } catch (error) {
      warnAsyncError("settings:patch-netease-scrobble-sync", error);
      setNeteaseScrobbleSync(previous);
    }
  };

  const handleCustomSourceAutoCheckToggle = () => {
    const next = !customSourceAutoCheck;
    setCustomSourceAutoCheck(next);
    patchSettings({ customSourceAutoCheck: next }).catch((error) => {
      warnAsyncError("settings:patch-custom-source-auto-check", error);
      setCustomSourceAutoCheck(!next);
    });
  };

  const handleSaveBiliCookie = async () => {
    const raw = biliCookieText.trim();
    if (!raw) {
      setBiliCookieStatus("请先粘贴 B站 Cookie");
      return;
    }

    const previousCookie = await getBiliCookie();
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
    immersiveLyricFontSize?: number;
    immersiveLyricFontFamily?: string;
  }) => {
    broadcastLyricSettings(patch);
    patchSettings(patch).catch(logAsyncError("settings:patch-immersive-lyric-style"));
  };

  const handleImmersiveLyricFontSizeChange = (nextValue: number) => {
    const next = Math.max(24, Math.min(56, nextValue));
    setImmersiveLyricFontSize(next);
    patchImmersiveLyricStyle({ immersiveLyricFontSize: next });
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
    if (!confirm('确定清空播放历史与歌曲缓存？\n\n仅清空播放历史与歌曲缓存，其他数据保留。')) return;
    setDataStatus("清理中...");
    setDataPending(true);
    try {
      await libraryReset("recent");
      useHistoryStore.getState().replaceAll([]);
      await clearPersistentCache();
      clearPlaybackPrefetchCache();
      const stats = await clearSongCache();
      setSongCacheSize(stats.totalSize);
      setDataStatus("已清空播放历史与歌曲缓存。");
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

  const getActiveSettingsSection = (id: SettingsSectionId) => activeSection === id;

  return (
    <div className="af-settings-view af-animate-slide-in">
      <div className="af-settings-page-head">
        <div>
          <h1 className="af-settings-title">设置</h1>
          <p className="af-settings-subtitle">管理播放、音源、桌面歌词和数据同步。</p>
        </div>
      </div>

      <div className="af-settings-shell">
        <nav className="af-settings-nav" aria-label="设置分类">
          {SETTINGS_NAV.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className={`af-settings-nav-link ${activeSection === id ? "af-active" : ""}`}
              onClick={() => setActiveSection(id as SettingsSectionId)}
              aria-current={activeSection === id ? "page" : undefined}
            >
              <Icon size={16} />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="af-settings-content">
          <div className="af-settings-panel">

      {/* Theme Section */}
      {getActiveSettingsSection("appearance") && (
      <section className="af-settings-section" id="appearance">
        <h2 className="af-settings-section-title">外观</h2>

        <div className="af-settings-group">
          <label className="af-settings-label">主题</label>
          <div className="af-settings-radio-group">
            <button
              type="button"
              className={`af-settings-radio-option ${theme === "light" ? "af-settings-radio-active" : ""}`}
              onClick={() => setTheme("light")}
            >
              <Sun size={20} />
              <span>浅色</span>
            </button>
            <button
              type="button"
              className={`af-settings-radio-option ${theme === "dark" ? "af-settings-radio-active" : ""}`}
              onClick={() => setTheme("dark")}
            >
              <Moon size={20} />
              <span>深色</span>
            </button>
            <button
              type="button"
              className={`af-settings-radio-option ${theme === "auto" ? "af-settings-radio-active" : ""}`}
              onClick={() => setTheme("auto")}
            >
              <Monitor size={20} />
              <span>跟随系统</span>
            </button>
          </div>
        </div>

        <div className="af-settings-group">
          <label className="af-settings-label">自定义强调色</label>
          <div className="af-appearance-row">
            <label className="af-appearance-color-picker">
              <span
                className="af-appearance-color-swatch"
                style={{ backgroundColor: accentColor }}
                aria-hidden="true"
              />
              <input
                type="color"
                value={accentColor}
                onChange={(event) => setAccentColor(event.target.value)}
                aria-label="选择强调色"
              />
            </label>
            <input
              type="text"
              className={`af-appearance-color-hex ${isAccentColorInputValid ? "" : "af-invalid"}`}
              value={accentColorInput}
              onChange={(event) => handleAccentColorTextChange(event.target.value)}
              aria-label="输入强调色 Hex 值"
              aria-invalid={!isAccentColorInputValid}
              spellCheck={false}
              inputMode="text"
              placeholder="#3BD877"
            />
            <button type="button" className="af-settings-small-button" onClick={resetAccentColor}>
              <RotateCcw size={14} />
              恢复默认
            </button>
          </div>
        </div>

        <div className="af-settings-group">
          <label className="af-settings-label">沉浸式歌词样式</label>
          <div className="af-immersive-lyric-style-grid">
            <label className="af-immersive-lyric-style-control">
              <span>字体</span>
              <select
                className="af-settings-select"
                value={immersiveLyricFontFamily}
                onChange={(event) => handleImmersiveLyricFontFamilyChange(event.target.value)}
              >
                {IMMERSIVE_LYRIC_FONT_OPTIONS.map((option) => (
                  <option key={option.label} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="af-immersive-lyric-style-control">
              <span>字号</span>
              <div className="af-immersive-lyric-size-row">
                <input
                  type="range"
                  min={24}
                  max={56}
                  step={1}
                  value={immersiveLyricFontSize}
                  onChange={(event) => handleImmersiveLyricFontSizeChange(parseInt(event.target.value, 10))}
                  className="af-sfx-range"
                />
                <strong>{immersiveLyricFontSize}px</strong>
              </div>
            </label>
          </div>
          <div
            className="af-immersive-lyric-style-preview"
            style={{
              fontFamily: immersiveLyricFontFamily,
              fontSize: `${immersiveLyricFontSize}px`,
            }}
          >
            像是色彩浮游在水流中
          </div>
        </div>
      </section>
      )}

      {/* Playback Section */}
      {getActiveSettingsSection("playback") && (
      <section className="af-settings-section" id="playback">
        <h2 className="af-settings-section-title">播放</h2>

        <div className="af-settings-group">
          <label className="af-settings-label">音质偏好</label>
          <select
            className="af-settings-select"
            value={defaultQuality}
            onChange={(e) => {
              const quality = e.target.value;
              setDefaultQuality(quality);
              patchPlaybackSetting({ defaultQuality: quality });
            }}
          >
            <option value="128k">标准 128K</option>
            <option value="192k">较高 192K</option>
            <option value="320k">高品质 320K</option>
            <option value="flac">无损 FLAC</option>
            <option value="flac24bit">Hi-Res</option>
          </select>
        </div>

        <div className="af-settings-group">
          <label className="af-settings-label">其他媒体播放时</label>
          <div className="af-sfx-toggle">
            <button
              type="button"
              className={`af-sfx-toggle-btn ${pauseOnExternalPlayback ? "af-active" : ""}`}
              onClick={() => { void handlePauseOnExternalPlaybackChange(true); }}
              aria-pressed={pauseOnExternalPlayback}
              title="自动暂停"
            >
              <Pause size={14} />
              自动暂停
            </button>
            <button
              type="button"
              className={`af-sfx-toggle-btn ${!pauseOnExternalPlayback ? "af-active" : ""}`}
              onClick={() => { void handlePauseOnExternalPlaybackChange(false); }}
              aria-pressed={!pauseOnExternalPlayback}
              title="继续播放"
            >
              <Volume2 size={14} />
              继续播放
            </button>
          </div>
        </div>

        <div className="af-settings-group">
          <label className="af-settings-label">网易云听歌记录</label>
          <div className="af-sfx-toggle">
            <button
              type="button"
              className={`af-sfx-toggle-btn ${neteaseScrobbleSync ? "af-active" : ""}`}
              onClick={() => { void handleNeteaseScrobbleSyncChange(true); }}
              aria-pressed={neteaseScrobbleSync}
              title="同步"
            >
              <Cloud size={14} />
              同步
            </button>
            <button
              type="button"
              className={`af-sfx-toggle-btn ${!neteaseScrobbleSync ? "af-active" : ""}`}
              onClick={() => { void handleNeteaseScrobbleSyncChange(false); }}
              aria-pressed={!neteaseScrobbleSync}
              title="不同步"
            >
              <Cloud size={14} />
              不同步
            </button>
          </div>
          <p className="af-settings-hint">仅同步网易云源歌曲，播放达到阈值后写入网易云听歌统计；失败会自动重试。</p>
        </div>

      </section>
      )}

      {getActiveSettingsSection("sources") && (
      <section className="af-settings-section" id="sources">
        <h2 className="af-settings-section-title">音源</h2>
        <div className="af-settings-group">
          <label className="af-settings-label">B站收藏合集</label>
          <textarea
            className="af-settings-textarea af-custom-source-textarea"
            value={biliCookieText}
            onChange={(event) => setBiliCookieText(event.target.value)}
            placeholder="SESSDATA=...; DedeUserID=...; bili_jct=...; buvid3=..."
            spellCheck={false}
          />
          <div className="af-custom-source-toolbar">
            <button
              type="button"
              className="af-settings-small-button"
              onClick={() => { void handleSaveBiliCookie(); }}
              disabled={biliCookiePending || !biliCookieText.trim()}
            >
              保存并验证 B站 Cookie
            </button>
            <button
              type="button"
              className="af-settings-small-button af-settings-danger-button"
              onClick={() => { void handleClearBiliCookie(); }}
              disabled={biliCookiePending}
            >
              退出 B站
            </button>
          </div>
          {biliAccount && (
            <p className="af-settings-hint">当前 B站账号：{biliAccount.nickname}</p>
          )}
          {biliCookieStatus && <p className="af-settings-hint">{biliCookieStatus}</p>}
        </div>

        <div className="af-settings-group">
          <label className="af-settings-label">自定义音源</label>
          <div className="af-settings-input-group">
            <button type="button" className="af-settings-button" onClick={handleImportCustomSourceFile}>
              导入 LX 音源文件
            </button>
            <button
              type="button"
              className="af-settings-button af-settings-button-secondary"
              onClick={handleImportCustomSourceText}
            >
              导入粘贴内容
            </button>
          </div>
          {customSources.length > 0 && (
            <div className="af-custom-source-toolbar">
              <button
                type="button"
                className="af-settings-small-button"
                onClick={() => { void checkAllUpdates(); }}
                disabled={customSources.some((source) => source.updateStatus === "checking")}
              >
                <RefreshCw size={14} />
                检查全部更新
              </button>
              <button
                type="button"
                className={`af-settings-small-button af-custom-source-auto-check ${customSourceAutoCheck ? "af-active" : ""}`}
                onClick={handleCustomSourceAutoCheckToggle}
                aria-pressed={customSourceAutoCheck}
                title={customSourceAutoCheck ? "关闭启动自动检测" : "开启启动自动检测"}
              >
                自动检测：{customSourceAutoCheck ? "开" : "关"}
              </button>
            </div>
          )}
          <textarea
            className="af-settings-textarea af-custom-source-textarea"
            value={customScriptText}
            onChange={(e) => setCustomScriptText(e.target.value)}
          />
          {customSourceStatus && <p className="af-settings-hint">{customSourceStatus}</p>}
        </div>

        <div className="af-settings-group">
          {customSources.length === 0 ? (
            <p className="af-settings-hint">尚未导入自定义音源。</p>
          ) : (
            <div className="af-custom-source-list">
              {customSources.map((source, index) => {
                const capabilityCount = Object.keys(source.sources ?? {}).length;
                const updateMessage = getUpdateStatusMessage(source);
                const testMessage = getTestStatusMessage(source);

                return (
                  <div className="af-custom-source-card" key={source.id}>
                    <div className="af-custom-source-main">
                      <label
                        className="af-custom-source-enable"
                        title={source.enabled ? "停用音源" : "启用音源"}
                        aria-label={source.enabled ? "停用音源" : "启用音源"}
                      >
                        <input
                          type="checkbox"
                          className="af-settings-checkbox"
                          checked={source.enabled}
                          onChange={(e) => toggleSource(source.id, e.target.checked)}
                        />
                      </label>
                      <div className="af-custom-source-info">
                        <div className="af-custom-source-title-row">
                          <div className="af-custom-source-name" title={source.name}>{source.name}</div>
                          {source.version && <span className="af-custom-source-chip">{getVersionLabel(source.version)}</span>}
                          {source.author && <span className="af-custom-source-chip" title={source.author}>{source.author}</span>}
                          <span className="af-custom-source-chip" title={getCapabilityTitle(source)}>
                            {capabilityCount > 0 ? `${capabilityCount} 个平台` : "无平台"}
                          </span>
                        </div>
                        <div className="af-custom-source-desc" title={source.description || "无描述"}>
                          {source.description || "无描述"}
                        </div>
                        {(updateMessage || testMessage) && (
                          <details className="af-custom-source-details">
                            <summary>状态详情</summary>
                            <div className="af-custom-source-message-row">
                              {updateMessage && (
                                <span className={`af-custom-source-status af-custom-source-status-${source.updateStatus ?? "idle"}`}>
                                  {updateMessage}
                                </span>
                              )}
                              {testMessage && (
                                <span className={`af-custom-source-status af-custom-source-status-${source.testStatus}`}>
                                  {testMessage}
                                </span>
                              )}
                            </div>
                          </details>
                        )}
                      </div>
                    </div>
                    <div className="af-custom-source-actions">
                      <button
                        type="button"
                        className={`af-custom-source-icon-button ${source.allowShowUpdateAlert ? "af-active" : ""}`}
                        onClick={() => toggleUpdateAlert(source.id, !source.allowShowUpdateAlert)}
                        title={source.allowShowUpdateAlert ? "关闭更新提醒" : "开启更新提醒"}
                        aria-label={source.allowShowUpdateAlert ? "关闭更新提醒" : "开启更新提醒"}
                        aria-pressed={source.allowShowUpdateAlert}
                      >
                        {source.allowShowUpdateAlert ? <Bell size={14} /> : <BellOff size={14} />}
                      </button>
                      <button
                        type="button"
                        className="af-custom-source-icon-button"
                        onClick={() => { void checkSourceUpdate(source.id); }}
                        disabled={source.updateStatus === "checking"}
                        title={source.updateStatus === "checking" ? "检测中" : "检查更新"}
                        aria-label={source.updateStatus === "checking" ? "检测中" : "检查更新"}
                      >
                        <RefreshCw size={14} />
                      </button>
                      {source.updateStatus === "available" && (
                        <button
                          type="button"
                          className="af-custom-source-icon-button"
                          onClick={() => openCustomSourceUpdateModal(source.id)}
                          title="查看更新弹窗"
                          aria-label="查看更新弹窗"
                        >
                          <ExternalLink size={14} />
                        </button>
                      )}
                      <button
                        type="button"
                        className="af-custom-source-icon-button"
                        onClick={() => testSource(source.id)}
                        disabled={source.testStatus === "testing"}
                        title={source.testStatus === "testing" ? "测试中" : "测试音源"}
                        aria-label={source.testStatus === "testing" ? "测试中" : "测试音源"}
                      >
                        <FlaskConical size={14} />
                      </button>
                      <button
                        type="button"
                        className="af-custom-source-icon-button"
                        onClick={() => moveSource(source.id, "up")}
                        disabled={index === 0}
                        title="上移"
                        aria-label="上移"
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        type="button"
                        className="af-custom-source-icon-button"
                        onClick={() => moveSource(source.id, "down")}
                        disabled={index === customSources.length - 1}
                        title="下移"
                        aria-label="下移"
                      >
                        <ArrowDown size={14} />
                      </button>
                      <button
                        type="button"
                        className="af-custom-source-icon-button af-settings-danger-button"
                        onClick={() => removeSource(source.id)}
                        title="删除"
                        aria-label="删除"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
                </div>
              )}
            </div>
      </section>
      )}

      {/* Desktop Lyric Section */}
      {getActiveSettingsSection("desktop-lyric") && <DesktopLyricSection />}

      {/* Data Section */}
      {getActiveSettingsSection("data") && (
      <section className="af-settings-section" id="data">
        <h2 className="af-settings-section-title">数据管理</h2>
        <div className="af-settings-row">
          <div>
            <label className="af-settings-label">播放历史与歌曲缓存</label>
            <p className="af-settings-hint">
              仅清空播放历史与歌曲缓存，其他数据保留。
            </p>
            <div className="af-data-cache-size" aria-label="歌曲缓存大小">
              <span>歌曲缓存</span>
              <strong>{formatByteSize(songCacheSize)}</strong>
            </div>
          </div>
          <button
            type="button"
            className="af-settings-small-button af-settings-danger-button"
            onClick={() => { void handleClearHistoryAndCache(); }}
            disabled={dataPending}
          >
            {dataPending ? "清理中..." : "清空历史和缓存"}
          </button>
        </div>
        {dataStatus && <p className="af-settings-hint">{dataStatus}</p>}
      </section>
      )}

      {/* Sync Section */}
      {getActiveSettingsSection("sync") && <SyncSection />}

      {/* Misc Section */}
      {getActiveSettingsSection("misc") && <MiscSection />}

      {/* About Section */}
      {getActiveSettingsSection("about") && (
      <section className="af-settings-section" id="about">
        <h2 className="af-settings-section-title">关于</h2>

        <div className="af-settings-about">
          <div className="af-settings-about-logo">
            <img src={logoImg} alt="AuralFlow" />
          </div>
          <h3 className="af-settings-about-title">AuralFlow</h3>
          <p className="af-settings-about-version">版本 0.1.0</p>
          <p className="af-settings-about-description">
            现代化的跨平台音乐播放器，基于 Tauri + React 构建。
          </p>
        </div>
      </section>
      )}
          </div>
        </div>
      </div>
    </div>
  );
}

function DesktopLyricSection() {
  const [activeLyricTab, setActiveLyricTab] = useState<LyricSettingsTab>("basic");
  const [pinned, setPinned] = useState(true);
  const [pauseHide, setPauseHide] = useState(false);
  const [fontSize, setFontSize] = useState(28);
  const [showNextLine, setShowNextLine] = useState(true);
  const [singleLine, setSingleLine] = useState(false);
  const [maxLineNum, setMaxLineNum] = useState(2);
  const [showTranslation, setShowTranslation] = useState(true);
  const [align, setAlign] = useState("center");
  const [lineGap, setLineGap] = useState(8);
  const [fontWeight, setFontWeight] = useState(700);
  const [activeColor, setActiveColor] = useState("#ffffff");
  const [nextColor, setNextColor] = useState("#d1d5db");
  const [shadowColor, setShadowColor] = useState("#000000");
  const [textOpacity, setTextOpacity] = useState(0.95);
  const [backgroundOpacity, setBackgroundOpacity] = useState(0.55);
  const [textPositionX, setTextPositionX] = useState(0);
  const [textPositionY, setTextPositionY] = useState(0);
  const [hoverHide, setHoverHide] = useState(false);
  const [enableAnimation, setEnableAnimation] = useState(true);
  const [animationIntensity, setAnimationIntensity] = useState<LyricAnimationIntensity>("normal");
  const [windowOpen, setWindowOpen] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    loadSettings()
      .then((s) => {
        setPinned(s.lyricPinned);
        setPauseHide(s.lyricPauseHide);
        setFontSize(s.lyricFontSize || 28);
        setShowNextLine(s.lyricShowNextLine);
        setSingleLine(s.lyricSingleLine);
        setMaxLineNum(s.lyricMaxLineNum || 2);
        setShowTranslation(s.lyricShowTranslation);
        setAlign(s.lyricAlign || "center");
        setLineGap(s.lyricLineGap ?? 8);
        setFontWeight(s.lyricFontWeight ?? 700);
        setActiveColor(s.lyricActiveColor || "#ffffff");
        setNextColor(s.lyricNextColor || "#d1d5db");
        setShadowColor(s.lyricShadowColor || "#000000");
        setTextOpacity(typeof s.lyricTextOpacity === "number" ? s.lyricTextOpacity : 0.95);
        setBackgroundOpacity(typeof s.lyricBackgroundOpacity === "number" ? s.lyricBackgroundOpacity : 0.55);
        setTextPositionX(typeof s.lyricTextPositionX === "number" ? s.lyricTextPositionX : 0);
        setTextPositionY(typeof s.lyricTextPositionY === "number" ? s.lyricTextPositionY : 0);
        setHoverHide(s.lyricHoverHide);
        setEnableAnimation(s.lyricEnableAnimation);
        setAnimationIntensity(normalizeLyricAnimationIntensity(s.lyricAnimationIntensity));
      })
      .catch(logAsyncError("settings:load-lyric"));
    isLyricWindowOpen().then(setWindowOpen).catch(logAsyncError("settings:query-lyric-open"));
  }, []);

  useEffect(() => subscribeLyricSettings((patch) => {
    if (typeof patch.lyricPinned === "boolean") setPinned(patch.lyricPinned);
    if (typeof patch.lyricShowTranslation === "boolean") setShowTranslation(patch.lyricShowTranslation);
    if (typeof patch.lyricAnimationIntensity === "string") {
      setAnimationIntensity(normalizeLyricAnimationIntensity(patch.lyricAnimationIntensity));
    }
  }), []);

  const patchLyricSetting = async (patch: Record<string, unknown>) => {
    setStatus("");
    broadcastLyricSettings(patch);
    try {
      await patchSettings(patch);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const handleToggleWindow = async () => {
    setStatus("正在切换桌面歌词...");
    try {
      const result = await toggleDesktopLyricFromPlayer(undefined, {
        knownOpen: windowOpen,
      });
      setWindowOpen(result.open);
      setStatus(result.message);
    } catch (error) {
      console.error("[desktop lyric] toggle failed", error);
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const handlePinnedChange = async (next: boolean) => {
    setPinned(next);
    setStatus("");
    try {
      await setLyricWindowPinned(next);
      broadcastLyricSettings({ lyricPinned: next });
    } catch (error) {
      setPinned(!next);
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const handlePauseHideChange = async (next: boolean) => {
    setPauseHide(next);
    await patchLyricSetting({ lyricPauseHide: next });
  };

  const handleFontSizeChange = async (nextValue: number) => {
    const next = Math.max(16, Math.min(52, nextValue));
    setFontSize(next);
    await patchLyricSetting({ lyricFontSize: next });
  };

  const handleShowNextLineChange = async (next: boolean) => {
    setShowNextLine(next);
    await patchLyricSetting({ lyricShowNextLine: next });
  };

  const handleSingleLineChange = async (next: boolean) => {
    setSingleLine(next);
    await patchLyricSetting({ lyricSingleLine: next });
  };

  const handleMaxLineNumChange = async (nextValue: number) => {
    const next = Math.max(1, Math.min(4, nextValue));
    setMaxLineNum(next);
    await patchLyricSetting({ lyricMaxLineNum: next });
  };

  const handleShowTranslationChange = async (next: boolean) => {
    setShowTranslation(next);
    await patchLyricSetting({ lyricShowTranslation: next });
  };

  const handleAlignChange = async (next: string) => {
    setAlign(next);
    await patchLyricSetting({ lyricAlign: next });
  };

  const handleLineGapChange = async (nextValue: number) => {
    const next = Math.max(0, Math.min(28, nextValue));
    setLineGap(next);
    await patchLyricSetting({ lyricLineGap: next });
  };

  const handleFontWeightChange = async (next: number) => {
    setFontWeight(next);
    await patchLyricSetting({ lyricFontWeight: next });
  };

  const handleColorChange = async (key: "lyricActiveColor" | "lyricNextColor" | "lyricShadowColor", value: string) => {
    if (key === "lyricActiveColor") setActiveColor(value);
    if (key === "lyricNextColor") setNextColor(value);
    if (key === "lyricShadowColor") setShadowColor(value);
    await patchLyricSetting({ [key]: value });
  };

  const handleBackgroundOpacityChange = async (nextValue: number) => {
    const next = Math.max(0.15, Math.min(0.95, nextValue));
    setBackgroundOpacity(next);
    await patchLyricSetting({ lyricBackgroundOpacity: next });
  };

  const handleTextOpacityChange = async (nextValue: number) => {
    const next = Math.max(0.1, Math.min(1, nextValue));
    setTextOpacity(next);
    await patchLyricSetting({ lyricTextOpacity: next });
  };

  const handleTextPositionXChange = async (nextValue: number) => {
    const next = Math.max(-40, Math.min(40, nextValue));
    setTextPositionX(next);
    await patchLyricSetting({ lyricTextPositionX: next });
  };

  const handleTextPositionYChange = async (nextValue: number) => {
    const next = Math.max(-40, Math.min(40, nextValue));
    setTextPositionY(next);
    await patchLyricSetting({ lyricTextPositionY: next });
  };

  const handleHoverHideChange = async (next: boolean) => {
    setHoverHide(next);
    await patchLyricSetting({ lyricHoverHide: next });
  };

  const handleAnimationChange = async (next: boolean) => {
    setEnableAnimation(next);
    await patchLyricSetting({ lyricEnableAnimation: next });
  };

  const handleAnimationIntensityChange = async (next: LyricAnimationIntensity) => {
    setAnimationIntensity(next);
    await patchLyricSetting({ lyricAnimationIntensity: next });
  };

  const handleResetStyle = async () => {
    const patch = {
      lyricFontSize: 28,
      lyricShowNextLine: true,
      lyricSingleLine: false,
      lyricMaxLineNum: 2,
      lyricShowTranslation: true,
      lyricAlign: "center",
      lyricLineGap: 8,
      lyricFontWeight: 700,
      lyricActiveColor: "#ffffff",
      lyricNextColor: "#d1d5db",
      lyricShadowColor: "#000000",
      lyricTextOpacity: 0.95,
      lyricBackgroundOpacity: 0.55,
      lyricTextPositionX: 0,
      lyricTextPositionY: 0,
      lyricHoverHide: false,
      lyricEnableAnimation: true,
      lyricAnimationIntensity: "normal" as const,
    };
    setFontSize(patch.lyricFontSize);
    setShowNextLine(patch.lyricShowNextLine);
    setSingleLine(patch.lyricSingleLine);
    setMaxLineNum(patch.lyricMaxLineNum);
    setShowTranslation(patch.lyricShowTranslation);
    setAlign(patch.lyricAlign);
    setLineGap(patch.lyricLineGap);
    setFontWeight(patch.lyricFontWeight);
    setActiveColor(patch.lyricActiveColor);
    setNextColor(patch.lyricNextColor);
    setShadowColor(patch.lyricShadowColor);
    setTextOpacity(patch.lyricTextOpacity);
    setBackgroundOpacity(patch.lyricBackgroundOpacity);
    setTextPositionX(patch.lyricTextPositionX);
    setTextPositionY(patch.lyricTextPositionY);
    setHoverHide(patch.lyricHoverHide);
    setEnableAnimation(patch.lyricEnableAnimation);
    setAnimationIntensity(patch.lyricAnimationIntensity);
    await patchLyricSetting(patch);
  };

  const handleResetWindow = async () => {
    setStatus("正在重置窗口位置...");
    try {
      await patchSettings({
        lyricWindowX: null,
        lyricWindowY: null,
        lyricWindowWidth: null,
        lyricWindowHeight: null,
      });
      setStatus("已重置位置和尺寸，下次打开桌面歌词生效");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const renderLyricSettingsTab = (tab: LyricSettingsTab) => activeLyricTab === tab;

  return (
    <section className="af-settings-section" id="desktop-lyric">
      <h2 className="af-settings-section-title">桌面歌词</h2>

      <div className="af-lyric-settings-tabs" role="tablist" aria-label="桌面歌词设置分类">
        {LYRIC_SETTINGS_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            className={`af-lyric-settings-tab ${activeLyricTab === tab.id ? "af-active" : ""}`}
            aria-selected={activeLyricTab === tab.id}
            onClick={() => setActiveLyricTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {status && <p className="af-settings-hint af-lyric-status">{status}</p>}

      {renderLyricSettingsTab("basic") && (
      <div className="af-lyric-settings-card">
        <div className="af-lyric-settings-heading">
          <div>
            <div className="af-lyric-settings-title">基础</div>
            <p className="af-settings-hint">窗口显示、是否始终在其他窗口上方、锁定和隐藏行为。</p>
          </div>
          <button type="button" className="af-settings-small-button" onClick={handleToggleWindow}>
            <Mic2 size={14} />
            {windowOpen ? "关闭歌词" : "打开歌词"}
          </button>
        </div>

        <div className="af-lyric-settings-grid">
          <div className="af-lyric-setting-block">
            <label className="af-settings-label">始终显示在其他窗口上方</label>
            <div className="af-sfx-toggle">
              <button
                type="button"
                className={`af-sfx-toggle-btn ${pinned ? "af-active" : ""}`}
                onClick={() => handlePinnedChange(true)}
              >
                <Pin size={14} />
                开启
              </button>
              <button
                type="button"
                className={`af-sfx-toggle-btn ${!pinned ? "af-active" : ""}`}
                onClick={() => handlePinnedChange(false)}
              >
                <PinOff size={14} />
                关闭
              </button>
            </div>
          </div>

          <div className="af-lyric-setting-block">
            <label className="af-settings-label">暂停时隐藏</label>
            <div className="af-sfx-toggle">
              <button
                type="button"
                className={`af-sfx-toggle-btn ${pauseHide ? "af-active" : ""}`}
                onClick={() => handlePauseHideChange(true)}
              >
                <EyeOff size={14} />
                开启
              </button>
              <button
                type="button"
                className={`af-sfx-toggle-btn ${!pauseHide ? "af-active" : ""}`}
                onClick={() => handlePauseHideChange(false)}
              >
                <Eye size={14} />
                关闭
              </button>
            </div>
          </div>

          <div className="af-lyric-setting-block">
            <label className="af-settings-label">下一行歌词</label>
            <div className="af-sfx-toggle">
              <button
                type="button"
                className={`af-sfx-toggle-btn ${showNextLine ? "af-active" : ""}`}
                onClick={() => handleShowNextLineChange(true)}
              >
                <Eye size={14} />
                显示
              </button>
              <button
                type="button"
                className={`af-sfx-toggle-btn ${!showNextLine ? "af-active" : ""}`}
                onClick={() => handleShowNextLineChange(false)}
              >
                <EyeOff size={14} />
                隐藏
              </button>
            </div>
          </div>

          <div className="af-lyric-setting-block">
            <label className="af-settings-label">单行模式</label>
            <div className="af-sfx-toggle">
              <button
                type="button"
                className={`af-sfx-toggle-btn ${singleLine ? "af-active" : ""}`}
                onClick={() => handleSingleLineChange(true)}
              >
                开启
              </button>
              <button
                type="button"
                className={`af-sfx-toggle-btn ${!singleLine ? "af-active" : ""}`}
                onClick={() => handleSingleLineChange(false)}
              >
                关闭
              </button>
            </div>
          </div>

          <div className="af-lyric-setting-block">
            <label className="af-settings-label">显示译文</label>
            <div className="af-sfx-toggle">
              <button
                type="button"
                className={`af-sfx-toggle-btn ${showTranslation ? "af-active" : ""}`}
                onClick={() => handleShowTranslationChange(true)}
              >
                <Eye size={14} />
                显示
              </button>
              <button
                type="button"
                className={`af-sfx-toggle-btn ${!showTranslation ? "af-active" : ""}`}
                onClick={() => handleShowTranslationChange(false)}
              >
                <EyeOff size={14} />
                隐藏
              </button>
            </div>
          </div>

          <div className="af-lyric-setting-block">
            <label className="af-settings-label">悬停隐藏</label>
            <div className="af-sfx-toggle">
              <button
                type="button"
                className={`af-sfx-toggle-btn ${hoverHide ? "af-active" : ""}`}
                onClick={() => handleHoverHideChange(true)}
              >
                开启
              </button>
              <button
                type="button"
                className={`af-sfx-toggle-btn ${!hoverHide ? "af-active" : ""}`}
                onClick={() => handleHoverHideChange(false)}
              >
                关闭
              </button>
            </div>
          </div>

          <div className="af-lyric-setting-block">
            <label className="af-settings-label">切换动画</label>
            <div className="af-sfx-toggle">
              <button
                type="button"
                className={`af-sfx-toggle-btn ${enableAnimation ? "af-active" : ""}`}
                onClick={() => handleAnimationChange(true)}
              >
                开启
              </button>
              <button
                type="button"
                className={`af-sfx-toggle-btn ${!enableAnimation ? "af-active" : ""}`}
                onClick={() => handleAnimationChange(false)}
              >
                关闭
              </button>
            </div>
          </div>

          <div className="af-lyric-setting-block">
            <label className="af-settings-label">动效强度</label>
            <div className="af-sfx-toggle">
              <button
                type="button"
                className={`af-sfx-toggle-btn ${animationIntensity === "reduced" ? "af-active" : ""}`}
                onClick={() => handleAnimationIntensityChange("reduced")}
              >
                柔和
              </button>
              <button
                type="button"
                className={`af-sfx-toggle-btn ${animationIntensity === "normal" ? "af-active" : ""}`}
                onClick={() => handleAnimationIntensityChange("normal")}
              >
                标准
              </button>
              <button
                type="button"
                className={`af-sfx-toggle-btn ${animationIntensity === "enhanced" ? "af-active" : ""}`}
                onClick={() => handleAnimationIntensityChange("enhanced")}
              >
                增强
              </button>
            </div>
          </div>
        </div>
      </div>
      )}

      {renderLyricSettingsTab("typography") && (
      <div className="af-lyric-settings-card">
        <div className="af-lyric-settings-title">排版</div>
        <div className="af-sfx-eq af-lyric-settings-sliders">
          <div className="af-sfx-eq-row af-lyric-setting-row">
            <span className="af-sfx-eq-freq">
              <Type size={14} />
              字号
            </span>
            <input
              type="range"
              min={16}
              max={52}
              step={1}
              value={fontSize}
              onChange={(e) => handleFontSizeChange(parseInt(e.target.value, 10))}
              className="af-sfx-range"
            />
            <span className="af-sfx-eq-value">{fontSize}px</span>
          </div>
          <div className="af-sfx-eq-row af-lyric-setting-row">
            <span className="af-sfx-eq-freq">行距</span>
            <input
              type="range"
              min={0}
              max={28}
              step={1}
              value={lineGap}
              onChange={(e) => handleLineGapChange(parseInt(e.target.value, 10))}
              className="af-sfx-range"
            />
            <span className="af-sfx-eq-value">{lineGap}px</span>
          </div>
          <div className="af-sfx-eq-row af-lyric-setting-row">
            <span className="af-sfx-eq-freq">行数</span>
            <input
              type="range"
              min={1}
              max={4}
              step={1}
              value={maxLineNum}
              onChange={(e) => handleMaxLineNumChange(parseInt(e.target.value, 10))}
              className="af-sfx-range"
              disabled={singleLine}
            />
            <span className="af-sfx-eq-value">{singleLine ? "1行" : `${maxLineNum}行`}</span>
          </div>
          <div className="af-sfx-eq-row af-lyric-setting-row">
            <span className="af-sfx-eq-freq">透明</span>
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={textOpacity}
              onChange={(e) => handleTextOpacityChange(parseFloat(e.target.value))}
              className="af-sfx-range"
            />
            <span className="af-sfx-eq-value">{Math.round(textOpacity * 100)}%</span>
          </div>
          <div className="af-sfx-eq-row af-lyric-setting-row">
            <span className="af-sfx-eq-freq">横向</span>
            <input
              type="range"
              min={-40}
              max={40}
              step={1}
              value={textPositionX}
              onChange={(e) => handleTextPositionXChange(parseInt(e.target.value, 10))}
              className="af-sfx-range"
            />
            <span className="af-sfx-eq-value">{textPositionX}%</span>
          </div>
          <div className="af-sfx-eq-row af-lyric-setting-row">
            <span className="af-sfx-eq-freq">纵向</span>
            <input
              type="range"
              min={-40}
              max={40}
              step={1}
              value={textPositionY}
              onChange={(e) => handleTextPositionYChange(parseInt(e.target.value, 10))}
              className="af-sfx-range"
            />
            <span className="af-sfx-eq-value">{textPositionY}%</span>
          </div>
        </div>

        <div className="af-lyric-settings-grid">
          <div className="af-lyric-setting-block">
            <label className="af-settings-label">对齐</label>
            <div className="af-sfx-toggle">
              <button
                type="button"
                className={`af-sfx-toggle-btn ${align === "left" ? "af-active" : ""}`}
                onClick={() => handleAlignChange("left")}
                title="左对齐"
              >
                <AlignLeft size={14} />
              </button>
              <button
                type="button"
                className={`af-sfx-toggle-btn ${align === "center" ? "af-active" : ""}`}
                onClick={() => handleAlignChange("center")}
                title="居中"
              >
                <AlignCenter size={14} />
              </button>
              <button
                type="button"
                className={`af-sfx-toggle-btn ${align === "right" ? "af-active" : ""}`}
                onClick={() => handleAlignChange("right")}
                title="右对齐"
              >
                <AlignRight size={14} />
              </button>
            </div>
          </div>

          <div className="af-lyric-setting-block">
            <label className="af-settings-label">字重</label>
            <div className="af-sfx-toggle">
              <button
                type="button"
                className={`af-sfx-toggle-btn ${fontWeight === 500 ? "af-active" : ""}`}
                onClick={() => handleFontWeightChange(500)}
              >
                常规
              </button>
              <button
                type="button"
                className={`af-sfx-toggle-btn ${fontWeight === 700 ? "af-active" : ""}`}
                onClick={() => handleFontWeightChange(700)}
              >
                加粗
              </button>
              <button
                type="button"
                className={`af-sfx-toggle-btn ${fontWeight === 800 ? "af-active" : ""}`}
                onClick={() => handleFontWeightChange(800)}
              >
                强调
              </button>
            </div>
          </div>
        </div>
      </div>
      )}

      {renderLyricSettingsTab("color") && (
      <div className="af-lyric-settings-card">
        <div className="af-lyric-settings-title">颜色与背景</div>
        <div className="af-lyric-color-grid">
          <label className="af-lyric-color-control">
            <span>当前行</span>
            <input
              type="color"
              value={activeColor}
              onChange={(e) => handleColorChange("lyricActiveColor", e.target.value)}
            />
          </label>
          <label className="af-lyric-color-control">
            <span>下一行</span>
            <input
              type="color"
              value={nextColor}
              onChange={(e) => handleColorChange("lyricNextColor", e.target.value)}
            />
          </label>
          <label className="af-lyric-color-control">
            <span>阴影</span>
            <input
              type="color"
              value={shadowColor}
              onChange={(e) => handleColorChange("lyricShadowColor", e.target.value)}
            />
          </label>
        </div>
        <div className="af-sfx-eq af-lyric-settings-sliders">
          <div className="af-sfx-eq-row af-lyric-setting-row">
            <span className="af-sfx-eq-freq">背景</span>
            <input
              type="range"
              min={0.15}
              max={0.95}
              step={0.05}
              value={backgroundOpacity}
              onChange={(e) => handleBackgroundOpacityChange(parseFloat(e.target.value))}
              className="af-sfx-range"
            />
            <span className="af-sfx-eq-value">{Math.round(backgroundOpacity * 100)}%</span>
          </div>
        </div>
      </div>
      )}

      <div className="af-lyric-settings-actions">
        <button type="button" className="af-settings-small-button" onClick={handleResetStyle}>
          <RotateCcw size={14} />
          恢复默认样式
        </button>
        <button type="button" className="af-settings-small-button" onClick={handleResetWindow}>
          <RotateCcw size={14} />
          重置位置和尺寸
        </button>
      </div>
    </section>
  );
}

function MiscSection() {
  const [cursorEffect, setCursorEffect] = useState<"off" | "trail">("off");
  const [updateStatus, setUpdateStatus] = useState("");

  useEffect(() => {
    loadSettings()
      .then((s) => setCursorEffect(s.cursorEffect === "trail" ? "trail" : "off"))
      .catch(logAsyncError("settings:load-cursor-effect"));
  }, []);

  const handleCursorChange = async (mode: "off" | "trail") => {
    setCursorEffect(mode);
    try {
      await patchSettings({ cursorEffect: mode });
    } catch (error) {
      warnAsyncError("settings:patch-cursor-effect", error);
    }
    // 触发 App 重新读取：通过 storage 事件不可靠，直接 reload 页面片段最简
    window.dispatchEvent(new Event("af-cursor-change"));
  };

  const handleCheckUpdate = async () => {
    setUpdateStatus("检查中...");
    try {
      const { checkForUpdates } = await import("@/services/updateService");
      const info = await checkForUpdates();
      setUpdateStatus(info ? `发现新版本 ${info.latestVersion}（当前 ${info.currentVersion}）` : "已是最新版本");
    } catch (e) {
      setUpdateStatus(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section className="af-settings-section" id="misc">
      <h2 className="af-settings-section-title">其他</h2>

      <div className="af-settings-group">
        <label className="af-settings-label">鼠标特效</label>
        <div className="af-sfx-toggle">
          <button
            type="button"
            className={`af-sfx-toggle-btn ${cursorEffect === "off" ? "af-active" : ""}`}
            onClick={() => handleCursorChange("off")}
          >
            关闭
          </button>
          <button
            type="button"
            className={`af-sfx-toggle-btn ${cursorEffect === "trail" ? "af-active" : ""}`}
            onClick={() => handleCursorChange("trail")}
          >
            拖尾
          </button>
        </div>
        <p className="af-settings-hint">跟随鼠标的衰减圆点特效，纯装饰。</p>
      </div>

      <div className="af-settings-group">
        <label className="af-settings-label">软件更新</label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="af-settings-small-button" onClick={handleCheckUpdate}>检查更新</button>
        </div>
        {updateStatus && <p className="af-settings-hint">{updateStatus}</p>}
      </div>
    </section>
  );
}

function SyncSection() {
  const [webdavUrl, setWebdavUrl] = useState("");
  const [webdavUser, setWebdavUser] = useState("");
  const [webdavPass, setWebdavPass] = useState("");
  const [syncStatus, setSyncStatus] = useState("");

  useEffect(() => {
    loadSettings().then((s) => {
      setWebdavUrl(s.webdavUrl ?? "");
      setWebdavUser(s.webdavUsername ?? "");
      setWebdavPass(s.webdavPassword ?? "");
    }).catch(logAsyncError("settings:load-webdav"));
  }, []);

  const saveWebdavConfig = async () => {
    await patchSettings({
      webdavUrl: webdavUrl.trim(),
      webdavUsername: webdavUser.trim(),
      webdavPassword: webdavPass,
    });
  };

  const handleTest = async () => {
    setSyncStatus("测试中...");
    try {
      await saveWebdavConfig();
      const { testSync } = await import("@/services/webdavSyncService");
      setSyncStatus(await testSync());
    } catch (e) {
      setSyncStatus(e instanceof Error ? e.message : String(e));
    }
  };

  const handleUploadSources = async () => {
    setSyncStatus("上传音源中...");
    try {
      await saveWebdavConfig();
      const { uploadSourcesSync } = await import("@/services/webdavSyncService");
      await uploadSourcesSync();
      setSyncStatus("已上传音源到 WebDAV");
    } catch (e) {
      setSyncStatus(e instanceof Error ? e.message : String(e));
    }
  };

  const handleDownloadSources = async () => {
    if (!confirm("从 WebDAV 下载音源将覆盖本地自定义音源，确定继续？")) return;
    setSyncStatus("下载音源中...");
    try {
      await saveWebdavConfig();
      const { downloadSourcesSync } = await import("@/services/webdavSyncService");
      await downloadSourcesSync();
      setSyncStatus("已从 WebDAV 下载音源");
    } catch (e) {
      setSyncStatus(e instanceof Error ? e.message : String(e));
    }
  };

  const handleUploadPlaylists = async () => {
    setSyncStatus("上传歌单历史中...");
    try {
      await saveWebdavConfig();
      const { uploadPlaylistsSync } = await import("@/services/webdavSyncService");
      await uploadPlaylistsSync();
      setSyncStatus("已上传歌单和历史到 WebDAV");
    } catch (e) {
      setSyncStatus(e instanceof Error ? e.message : String(e));
    }
  };

  const handleDownloadPlaylists = async () => {
    if (!confirm("从 WebDAV 下载歌单和历史将覆盖本地收藏、本地歌单和播放历史，确定继续？")) return;
    setSyncStatus("下载歌单历史中...");
    try {
      await saveWebdavConfig();
      const { downloadPlaylistsSync } = await import("@/services/webdavSyncService");
      await downloadPlaylistsSync();
      setSyncStatus("已从 WebDAV 下载歌单和历史");
    } catch (e) {
      setSyncStatus(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section className="af-settings-section" id="sync">
      <h2 className="af-settings-section-title">备份与同步</h2>

      <div className="af-settings-group">
        <label className="af-settings-label">WebDAV 地址</label>
        <input
          className="af-settings-input"
          type="text"
          value={webdavUrl}
          onChange={(e) => setWebdavUrl(e.target.value)}
          placeholder="https://dav.example.com/dav"
        />
      </div>

      <div className="af-settings-group">
        <label className="af-settings-label">用户名</label>
        <input
          className="af-settings-input"
          type="text"
          value={webdavUser}
          onChange={(e) => setWebdavUser(e.target.value)}
          autoComplete="off"
        />
      </div>

      <div className="af-settings-group">
        <label className="af-settings-label">密码</label>
        <input
          className="af-settings-input"
          type="password"
          value={webdavPass}
          onChange={(e) => setWebdavPass(e.target.value)}
          autoComplete="off"
        />
      </div>

      <div className="af-settings-group">
        <div className="af-input-group" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="af-settings-small-button" onClick={handleTest}>测试连接</button>
          <button type="button" className="af-settings-small-button" onClick={handleUploadSources}>上传音源</button>
          <button type="button" className="af-settings-small-button" onClick={handleDownloadSources}>下载音源</button>
          <button type="button" className="af-settings-small-button" onClick={handleUploadPlaylists}>上传歌单历史</button>
          <button type="button" className="af-settings-small-button" onClick={handleDownloadPlaylists}>下载歌单历史</button>
        </div>
        {syncStatus && <p className="af-settings-hint">{syncStatus}</p>}
      </div>
    </section>
  );
}
