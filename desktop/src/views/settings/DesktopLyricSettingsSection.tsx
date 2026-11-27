import { useEffect, useId, useState } from "react";
import { AlignCenter, AlignLeft, AlignRight, Mic2, RotateCcw, Type } from "lucide-react";
import { isLyricWindowOpen, setLyricWindowPinned, type RustAppSettings } from "@lx/tauri-bridge";
import {
  resetSettingsToDefault,
  updateSettings,
  useLoadedSettings,
  type SettingsPatch,
} from "@/stores/settingsStore";
import { toggleDesktopLyricFromPlayer } from "@/utils/desktopLyricToggle";
import {
  normalizeLyricAnimationIntensity,
  type LyricAnimationIntensity,
} from "@/services/lyrics/animationIntensity";
import { SettingRow } from "./SettingRow";

type LyricSettingsTab = "basic" | "typography" | "color";

const LYRIC_SETTINGS_TABS: Array<{ id: LyricSettingsTab; label: string }> = [
  { id: "basic", label: "基础" },
  { id: "typography", label: "排版" },
  { id: "color", label: "颜色与背景" },
];

/** 「恢复默认样式」覆盖的字段。只列字段名：默认值由 Rust 的 AppSettings::default() 决定。 */
const LYRIC_STYLE_KEYS = [
  "lyricFontSize",
  "lyricShowNextLine",
  "lyricSingleLine",
  "lyricMaxLineNum",
  "lyricShowTranslation",
  "lyricShowRomanization",
  "lyricShowRuby",
  "lyricAlign",
  "lyricLineGap",
  "lyricFontWeight",
  "lyricActiveColor",
  "lyricNextColor",
  "lyricShadowColor",
  "lyricTextOpacity",
  "lyricBackgroundOpacity",
  "lyricTextPositionX",
  "lyricTextPositionY",
  "lyricHoverHide",
  "lyricEnableAnimation",
  "lyricAnimationIntensity",
] as const satisfies ReadonlyArray<keyof RustAppSettings>;

export function DesktopLyricSettingsSection() {
  const controlId = useId();
  const [activeLyricTab, setActiveLyricTab] = useState<LyricSettingsTab>("basic");
  const pinned = useLoadedSettings((s) => s.lyricPinned);
  const pauseHide = useLoadedSettings((s) => s.lyricPauseHide);
  const fontSize = useLoadedSettings((s) => s.lyricFontSize);
  const showNextLine = useLoadedSettings((s) => s.lyricShowNextLine);
  const singleLine = useLoadedSettings((s) => s.lyricSingleLine);
  const maxLineNum = useLoadedSettings((s) => s.lyricMaxLineNum);
  const showTranslation = useLoadedSettings((s) => s.lyricShowTranslation);
  const showRomanization = useLoadedSettings((s) => s.lyricShowRomanization);
  const showRuby = useLoadedSettings((s) => s.lyricShowRuby);
  const align = useLoadedSettings((s) => s.lyricAlign);
  const lineGap = useLoadedSettings((s) => s.lyricLineGap);
  const fontWeight = useLoadedSettings((s) => s.lyricFontWeight);
  const activeColor = useLoadedSettings((s) => s.lyricActiveColor);
  const nextColor = useLoadedSettings((s) => s.lyricNextColor);
  const shadowColor = useLoadedSettings((s) => s.lyricShadowColor);
  const textOpacity = useLoadedSettings((s) => s.lyricTextOpacity);
  const backgroundOpacity = useLoadedSettings((s) => s.lyricBackgroundOpacity);
  const textPositionX = useLoadedSettings((s) => s.lyricTextPositionX);
  const textPositionY = useLoadedSettings((s) => s.lyricTextPositionY);
  const hoverHide = useLoadedSettings((s) => s.lyricHoverHide);
  const enableAnimation = useLoadedSettings((s) => s.lyricEnableAnimation);
  const animationIntensity = useLoadedSettings((s) => normalizeLyricAnimationIntensity(s.lyricAnimationIntensity));
  const manualOffsetMs = useLoadedSettings((s) => s.lyricManualOffsetMs);
  const [windowOpen, setWindowOpen] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    isLyricWindowOpen().then(setWindowOpen).catch((error) => {
      setStatus(`读取桌面歌词窗口状态失败：${error instanceof Error ? error.message : String(error)}`);
    });
  }, []);

  /** 写入歌词设置；失败时界面由 store 回到真实值，这里只负责把原因告诉用户。 */
  const patchLyricSetting = async (patch: SettingsPatch, errorPrefix = "") => {
    setStatus("");
    try {
      await updateSettings(patch);
    } catch (error) {
      setStatus(`${errorPrefix}${error instanceof Error ? error.message : String(error)}`);
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
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  // 置顶由 Rust 落到窗口上并写回设置，界面等 settings-changed 刷新，不自己先改。
  const handlePinnedChange = async (next: boolean) => {
    setStatus("");
    try {
      await setLyricWindowPinned(next);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const handlePauseHideChange = (next: boolean) => patchLyricSetting({ lyricPauseHide: next });

  const handleFontSizeChange = (nextValue: number) =>
    patchLyricSetting({ lyricFontSize: Math.max(16, Math.min(52, nextValue)) });

  const handleShowNextLineChange = (next: boolean) => patchLyricSetting({ lyricShowNextLine: next });

  const handleSingleLineChange = (next: boolean) => patchLyricSetting({ lyricSingleLine: next });

  const handleMaxLineNumChange = (nextValue: number) =>
    patchLyricSetting({ lyricMaxLineNum: Math.max(1, Math.min(4, nextValue)) });

  const handleShowTranslationChange = (next: boolean) => patchLyricSetting({ lyricShowTranslation: next });

  const handleReadingChange = (key: "lyricShowRomanization" | "lyricShowRuby", value: boolean) =>
    patchLyricSetting({ [key]: value }, "保存读音设置失败：");

  const handleAlignChange = (next: string) => patchLyricSetting({ lyricAlign: next });

  const handleLineGapChange = (nextValue: number) =>
    patchLyricSetting({ lyricLineGap: Math.max(0, Math.min(28, nextValue)) });

  const handleFontWeightChange = (next: number) => patchLyricSetting({ lyricFontWeight: next });

  const handleManualOffsetChange = (nextValue: number) =>
    patchLyricSetting({ lyricManualOffsetMs: Math.max(-2000, Math.min(2000, Math.round(nextValue))) });

  const handleColorChange = (key: "lyricActiveColor" | "lyricNextColor" | "lyricShadowColor", value: string) =>
    patchLyricSetting({ [key]: value });

  const handleBackgroundOpacityChange = (nextValue: number) =>
    patchLyricSetting({ lyricBackgroundOpacity: Math.max(0.15, Math.min(0.95, nextValue)) });

  const handleTextOpacityChange = (nextValue: number) =>
    patchLyricSetting({ lyricTextOpacity: Math.max(0.1, Math.min(1, nextValue)) });

  const handleTextPositionXChange = (nextValue: number) =>
    patchLyricSetting({ lyricTextPositionX: Math.max(-40, Math.min(40, nextValue)) });

  const handleTextPositionYChange = (nextValue: number) =>
    patchLyricSetting({ lyricTextPositionY: Math.max(-40, Math.min(40, nextValue)) });

  const handleHoverHideChange = (next: boolean) => patchLyricSetting({ lyricHoverHide: next });

  const handleAnimationChange = (next: boolean) => patchLyricSetting({ lyricEnableAnimation: next });

  const handleAnimationIntensityChange = (next: LyricAnimationIntensity) =>
    patchLyricSetting({ lyricAnimationIntensity: next });

  const handleResetStyle = async () => {
    setStatus("");
    try {
      await resetSettingsToDefault(LYRIC_STYLE_KEYS);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const handleResetWindow = async () => {
    setStatus("正在重置窗口位置...");
    try {
      await updateSettings({
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
  const valueText = {
    fontSize: `${fontSize}px`,
    manualOffset: `${manualOffsetMs > 0 ? "+" : ""}${manualOffsetMs}ms`,
    lineGap: `${lineGap}px`,
    lineCount: `${singleLine ? 1 : maxLineNum}行`,
    textOpacity: `${Math.round(textOpacity * 100)}%`,
    positionX: `${textPositionX}%`,
    positionY: `${textPositionY}%`,
    backgroundOpacity: `${Math.round(backgroundOpacity * 100)}%`,
  };

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

        <div className="af-settings-card">
          <SettingRow label="始终置顶" hint="歌词窗口始终悬浮在其他窗口上方">
            <input
              type="checkbox"
              className="af-switch"
              role="switch"
              aria-label="始终置顶"
              checked={pinned}
              onChange={(e) => handlePinnedChange(e.target.checked)}
            />
          </SettingRow>
          <SettingRow label="暂停时隐藏" hint="暂停播放时自动隐藏歌词窗口">
            <input
              type="checkbox"
              className="af-switch"
              role="switch"
              aria-label="暂停时隐藏"
              checked={pauseHide}
              onChange={(e) => handlePauseHideChange(e.target.checked)}
            />
          </SettingRow>
          <SettingRow label="显示下一行" hint="预览即将演唱的歌词行">
            <input
              type="checkbox"
              className="af-switch"
              role="switch"
              aria-label="显示下一行"
              checked={showNextLine}
              onChange={(e) => handleShowNextLineChange(e.target.checked)}
            />
          </SettingRow>
          <SettingRow label="单行模式" hint="只显示当前一行歌词">
            <input
              type="checkbox"
              className="af-switch"
              role="switch"
              aria-label="单行模式"
              checked={singleLine}
              onChange={(e) => handleSingleLineChange(e.target.checked)}
            />
          </SettingRow>
          <SettingRow label="显示译文" hint="歌词下方显示翻译（有译文数据时）">
            <input
              type="checkbox"
              className="af-switch"
              role="switch"
              aria-label="显示译文"
              checked={showTranslation}
              onChange={(e) => handleShowTranslationChange(e.target.checked)}
            />
          </SettingRow>
          <SettingRow label="显示罗马音" hint="同时影响沉浸式及桌面歌词；仅显示歌词源已有罗马音，不自动生成">
            <input type="checkbox" className="af-switch" role="switch" aria-label="显示罗马音"
              checked={showRomanization} onChange={(e) => handleReadingChange("lyricShowRomanization", e.target.checked)} />
          </SettingRow>
          <SettingRow label="显示注音" hint="同时影响沉浸式及桌面歌词；仅显示明确 ruby/rt 注音，不自动生成">
            <input type="checkbox" className="af-switch" role="switch" aria-label="显示注音"
              checked={showRuby} onChange={(e) => handleReadingChange("lyricShowRuby", e.target.checked)} />
          </SettingRow>
          <SettingRow label="悬停隐藏" hint="鼠标不在歌词窗口上时淡化隐藏">
            <input
              type="checkbox"
              className="af-switch"
              role="switch"
              aria-label="悬停隐藏"
              checked={hoverHide}
              onChange={(e) => handleHoverHideChange(e.target.checked)}
            />
          </SettingRow>
          <SettingRow label="切换动画" hint="歌词行切换时的过渡动效">
            <input
              type="checkbox"
              className="af-switch"
              role="switch"
              aria-label="切换动画"
              checked={enableAnimation}
              onChange={(e) => handleAnimationChange(e.target.checked)}
            />
          </SettingRow>
          <SettingRow label="动效强度" hint="切换动画的幅度">
            <div className="af-segment">
              <button
                type="button"
                className={`af-segment-btn ${animationIntensity === "reduced" ? "af-active" : ""}`}
                onClick={() => handleAnimationIntensityChange("reduced")}
              >
                柔和
              </button>
              <button
                type="button"
                className={`af-segment-btn ${animationIntensity === "normal" ? "af-active" : ""}`}
                onClick={() => handleAnimationIntensityChange("normal")}
              >
                标准
              </button>
              <button
                type="button"
                className={`af-segment-btn ${animationIntensity === "enhanced" ? "af-active" : ""}`}
                onClick={() => handleAnimationIntensityChange("enhanced")}
              >
                增强
              </button>
            </div>
          </SettingRow>
        </div>
      </div>
      )}

      {renderLyricSettingsTab("typography") && (
      <div className="af-lyric-settings-card">
        <div className="af-lyric-settings-title">排版</div>
        <div className="af-sfx-eq af-lyric-settings-sliders">
          <div className="af-sfx-eq-row af-lyric-setting-row">
            <label className="af-sfx-eq-freq" htmlFor={`${controlId}-font-size`}>
              <Type size={14} />
              字号
            </label>
            <input
              id={`${controlId}-font-size`}
              type="range"
              min={16}
              max={52}
              step={1}
              value={fontSize}
              aria-valuetext={valueText.fontSize}
              onChange={(e) => handleFontSizeChange(parseInt(e.target.value, 10))}
              className="af-sfx-range"
            />
            <span className="af-sfx-eq-value">{valueText.fontSize}</span>
          </div>
          <div className="af-sfx-eq-row af-lyric-setting-row">
            <label className="af-sfx-eq-freq" htmlFor={`${controlId}-offset`}>偏移校准</label>
            <input
              id={`${controlId}-offset`}
              type="range"
              min={-2000}
              max={2000}
              step={50}
              value={manualOffsetMs}
              aria-valuetext={valueText.manualOffset}
              onChange={(e) => handleManualOffsetChange(parseInt(e.target.value, 10))}
              className="af-sfx-range"
            />
            <span className="af-sfx-eq-value">{valueText.manualOffset}</span>
          </div>
          <div className="af-sfx-eq-row af-lyric-setting-row">
            <label className="af-sfx-eq-freq" htmlFor={`${controlId}-line-gap`}>行距</label>
            <input
              id={`${controlId}-line-gap`}
              type="range"
              min={0}
              max={28}
              step={1}
              value={lineGap}
              aria-valuetext={valueText.lineGap}
              onChange={(e) => handleLineGapChange(parseInt(e.target.value, 10))}
              className="af-sfx-range"
            />
            <span className="af-sfx-eq-value">{valueText.lineGap}</span>
          </div>
          <div className="af-sfx-eq-row af-lyric-setting-row">
            <label className="af-sfx-eq-freq" htmlFor={`${controlId}-line-count`}>行数</label>
            <input
              id={`${controlId}-line-count`}
              type="range"
              min={1}
              max={4}
              step={1}
              value={maxLineNum}
              aria-valuetext={valueText.lineCount}
              onChange={(e) => handleMaxLineNumChange(parseInt(e.target.value, 10))}
              className="af-sfx-range"
              disabled={singleLine}
            />
            <span className="af-sfx-eq-value">{valueText.lineCount}</span>
          </div>
          <div className="af-sfx-eq-row af-lyric-setting-row">
            <label className="af-sfx-eq-freq" htmlFor={`${controlId}-text-opacity`}>透明</label>
            <input
              id={`${controlId}-text-opacity`}
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={textOpacity}
              aria-valuetext={valueText.textOpacity}
              onChange={(e) => handleTextOpacityChange(parseFloat(e.target.value))}
              className="af-sfx-range"
            />
            <span className="af-sfx-eq-value">{valueText.textOpacity}</span>
          </div>
          <div className="af-sfx-eq-row af-lyric-setting-row">
            <label className="af-sfx-eq-freq" htmlFor={`${controlId}-position-x`}>横向</label>
            <input
              id={`${controlId}-position-x`}
              type="range"
              min={-40}
              max={40}
              step={1}
              value={textPositionX}
              aria-valuetext={valueText.positionX}
              onChange={(e) => handleTextPositionXChange(parseInt(e.target.value, 10))}
              className="af-sfx-range"
            />
            <span className="af-sfx-eq-value">{valueText.positionX}</span>
          </div>
          <div className="af-sfx-eq-row af-lyric-setting-row">
            <label className="af-sfx-eq-freq" htmlFor={`${controlId}-position-y`}>纵向</label>
            <input
              id={`${controlId}-position-y`}
              type="range"
              min={-40}
              max={40}
              step={1}
              value={textPositionY}
              aria-valuetext={valueText.positionY}
              onChange={(e) => handleTextPositionYChange(parseInt(e.target.value, 10))}
              className="af-sfx-range"
            />
            <span className="af-sfx-eq-value">{valueText.positionY}</span>
          </div>
        </div>

        <div className="af-settings-card">
          <SettingRow label="对齐" hint="歌词文本的水平对齐方式">
            <div className="af-segment">
              <button
                type="button"
                className={`af-segment-btn ${align === "left" ? "af-active" : ""}`}
                onClick={() => handleAlignChange("left")}
                title="左对齐"
                aria-label="左对齐"
              >
                <AlignLeft size={14} />
              </button>
              <button
                type="button"
                className={`af-segment-btn ${align === "center" ? "af-active" : ""}`}
                onClick={() => handleAlignChange("center")}
                title="居中"
                aria-label="居中对齐"
              >
                <AlignCenter size={14} />
              </button>
              <button
                type="button"
                className={`af-segment-btn ${align === "right" ? "af-active" : ""}`}
                onClick={() => handleAlignChange("right")}
                title="右对齐"
                aria-label="右对齐"
              >
                <AlignRight size={14} />
              </button>
            </div>
          </SettingRow>
          <SettingRow label="字重" hint="歌词文字的粗细">
            <div className="af-segment">
              <button
                type="button"
                className={`af-segment-btn ${fontWeight === 500 ? "af-active" : ""}`}
                onClick={() => handleFontWeightChange(500)}
              >
                常规
              </button>
              <button
                type="button"
                className={`af-segment-btn ${fontWeight === 700 ? "af-active" : ""}`}
                onClick={() => handleFontWeightChange(700)}
              >
                加粗
              </button>
              <button
                type="button"
                className={`af-segment-btn ${fontWeight === 800 ? "af-active" : ""}`}
                onClick={() => handleFontWeightChange(800)}
              >
                强调
              </button>
            </div>
          </SettingRow>
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
            <label className="af-sfx-eq-freq" htmlFor={`${controlId}-background-opacity`}>背景</label>
            <input
              id={`${controlId}-background-opacity`}
              type="range"
              min={0.15}
              max={0.95}
              step={0.05}
              value={backgroundOpacity}
              aria-valuetext={valueText.backgroundOpacity}
              onChange={(e) => handleBackgroundOpacityChange(parseFloat(e.target.value))}
              className="af-sfx-range"
            />
            <span className="af-sfx-eq-value">{valueText.backgroundOpacity}</span>
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

/** 统一设置行：左侧标签(+说明)，右侧控件 */
