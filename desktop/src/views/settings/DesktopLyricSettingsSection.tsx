import { useEffect, useState } from "react";
import { AlignCenter, AlignLeft, AlignRight, Mic2, RotateCcw, Type } from "lucide-react";
import {
  isLyricWindowOpen,
  loadSettings,
  patchSettings,
  setLyricWindowPinned,
} from "@lx/tauri-bridge";
import { broadcastLyricSettings, subscribeLyricSettings } from "@/stores/lyricSettingsSync";
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

export function DesktopLyricSettingsSection() {
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
  const [manualOffsetMs, setManualOffsetMs] = useState(0);
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
        setManualOffsetMs(typeof s.lyricManualOffsetMs === "number" ? s.lyricManualOffsetMs : 0);
      })
      .catch((error) => {
        setStatus(`读取桌面歌词设置失败：${error instanceof Error ? error.message : String(error)}`);
      });
    isLyricWindowOpen().then(setWindowOpen).catch((error) => {
      setStatus(`读取桌面歌词窗口状态失败：${error instanceof Error ? error.message : String(error)}`);
    });
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

  const handleManualOffsetChange = async (nextValue: number) => {
    const next = Math.max(-2000, Math.min(2000, Math.round(nextValue)));
    setManualOffsetMs(next);
    await patchLyricSetting({ lyricManualOffsetMs: next });
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

        <div className="af-settings-card">
          <SettingRow label="始终置顶" hint="歌词窗口始终悬浮在其他窗口上方">
            <input
              type="checkbox"
              className="af-switch"
              role="switch"
              checked={pinned}
              onChange={(e) => handlePinnedChange(e.target.checked)}
            />
          </SettingRow>
          <SettingRow label="暂停时隐藏" hint="暂停播放时自动隐藏歌词窗口">
            <input
              type="checkbox"
              className="af-switch"
              role="switch"
              checked={pauseHide}
              onChange={(e) => handlePauseHideChange(e.target.checked)}
            />
          </SettingRow>
          <SettingRow label="显示下一行" hint="预览即将演唱的歌词行">
            <input
              type="checkbox"
              className="af-switch"
              role="switch"
              checked={showNextLine}
              onChange={(e) => handleShowNextLineChange(e.target.checked)}
            />
          </SettingRow>
          <SettingRow label="单行模式" hint="只显示当前一行歌词">
            <input
              type="checkbox"
              className="af-switch"
              role="switch"
              checked={singleLine}
              onChange={(e) => handleSingleLineChange(e.target.checked)}
            />
          </SettingRow>
          <SettingRow label="显示译文" hint="歌词下方显示翻译（有译文数据时）">
            <input
              type="checkbox"
              className="af-switch"
              role="switch"
              checked={showTranslation}
              onChange={(e) => handleShowTranslationChange(e.target.checked)}
            />
          </SettingRow>
          <SettingRow label="悬停隐藏" hint="鼠标不在歌词窗口上时淡化隐藏">
            <input
              type="checkbox"
              className="af-switch"
              role="switch"
              checked={hoverHide}
              onChange={(e) => handleHoverHideChange(e.target.checked)}
            />
          </SettingRow>
          <SettingRow label="切换动画" hint="歌词行切换时的过渡动效">
            <input
              type="checkbox"
              className="af-switch"
              role="switch"
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
            <span className="af-sfx-eq-freq">偏移校准</span>
            <input
              type="range"
              min={-2000}
              max={2000}
              step={50}
              value={manualOffsetMs}
              onChange={(e) => handleManualOffsetChange(parseInt(e.target.value, 10))}
              className="af-sfx-range"
            />
            <span className="af-sfx-eq-value">{manualOffsetMs > 0 ? `+${manualOffsetMs}` : manualOffsetMs}ms</span>
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

/** 统一设置行：左侧标签(+说明)，右侧控件 */
