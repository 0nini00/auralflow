import { Image as ImageIcon, Monitor, Moon, RotateCcw, Sun } from "lucide-react";
import type { AppearanceSettingsModel } from "../useSettingsViewModel";
import { IMMERSIVE_LYRIC_FONT_OPTIONS } from "../useSettingsViewModel";

export function AppearanceSettingsSection({ model }: { model: AppearanceSettingsModel }) {
  const {
    theme,
    accentColor,
    setTheme,
    setAccentColor,
    resetAccentColor,
    accentColorInput,
    isAccentColorInputValid,
    appBackgroundImagePath,
    appBackgroundStatus,
    appBackgroundPreviewUrl,
    immersiveLyricFontFamily,
    handleAccentColorTextChange,
    handleSelectAppBackground,
    handleClearAppBackground,
    handleImmersiveLyricFontFamilyChange,
  } = model;

  return (
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
    <label className="af-settings-label">主界面背景</label>
    <div className="af-app-background-picker">
      <div
        className={`af-app-background-preview ${appBackgroundPreviewUrl ? "af-has-image" : ""}`}
        style={appBackgroundPreviewUrl ? { backgroundImage: `url("${appBackgroundPreviewUrl}")` } : undefined}
        aria-hidden="true"
      >
        {!appBackgroundPreviewUrl && <ImageIcon size={22} />}
      </div>
      <div className="af-app-background-meta">
        <div className="af-app-background-actions">
          <button type="button" className="af-settings-small-button" onClick={() => { void handleSelectAppBackground(); }}>
            <ImageIcon size={14} />
            选择图片
          </button>
          <button
            type="button"
            className="af-settings-small-button"
            onClick={() => { void handleClearAppBackground(); }}
            disabled={!appBackgroundImagePath}
          >
            <RotateCcw size={14} />
            恢复默认
          </button>
        </div>
        <div className="af-app-background-path" title={appBackgroundImagePath || "未设置"}>
          {appBackgroundImagePath || "未设置背景图片"}
        </div>
        <p className="af-settings-hint">图片会直接显示在整个窗口最底层，不做模糊处理。</p>
        {appBackgroundStatus && <p className="af-settings-hint">{appBackgroundStatus}</p>}
      </div>
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
    </div>
    <div
      className="af-immersive-lyric-style-preview"
      style={{
        fontFamily: immersiveLyricFontFamily,
      }}
    >
      像是色彩浮游在水流中
    </div>
  </div>
</section>
  );
}
