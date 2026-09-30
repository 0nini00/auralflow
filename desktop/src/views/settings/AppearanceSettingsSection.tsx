import { Image as ImageIcon, Monitor, Moon, RotateCcw, Sun } from "lucide-react";
import { APPEARANCE_DEFAULTS, APPEARANCE_LIMITS, type Theme } from "@/stores/themeStore";
import type { AppearanceSettingsModel } from "../useSettingsViewModel";
import { IMMERSIVE_LYRIC_FONT_OPTIONS } from "../useSettingsViewModel";
import { SettingRow } from "./SettingRow";

const THEME_OPTIONS: Array<{ value: Theme; label: string; Icon: typeof Sun }> = [
  { value: "light", label: "浅色", Icon: Sun },
  { value: "dark", label: "深色", Icon: Moon },
  { value: "auto", label: "跟随系统", Icon: Monitor },
];

/** 预设色板（第一个是默认强调色）。任意取色与 hex 输入不受色板限制。 */
const ACCENT_PRESETS = [
  { label: "极光绿（默认）", value: "#3bd877" },
  { label: "天空蓝", value: "#3b82f6" },
  { label: "青碧", value: "#14b8a6" },
  { label: "紫罗兰", value: "#8b5cf6" },
  { label: "樱粉", value: "#ec4899" },
  { label: "暖橙", value: "#f59e0b" },
  { label: "珊瑚红", value: "#ef4444" },
  { label: "石墨", value: "#64748b" },
];

const DEFAULT_LYRIC_FONT_FAMILY = IMMERSIVE_LYRIC_FONT_OPTIONS[0].value;

/** 单项「恢复默认」：外观 section 每一行右侧的统一形态。 */
function AppearanceResetButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="af-settings-small-button af-appearance-reset"
      onClick={onClick}
      disabled={disabled}
      aria-label={`恢复默认：${label}`}
    >
      <RotateCcw size={13} />
      恢复默认
    </button>
  );
}

/** 强度滑块行：范围 / 步进 / 数值格式 / 还原按钮在这一处统一。 */
function AppearanceSliderRow({
  label,
  hint,
  value,
  limit,
  disabled,
  isDefault,
  formatValue,
  onChange,
  onReset,
}: {
  label: string;
  hint: string;
  value: number;
  limit: { min: number; max: number; step: number };
  disabled?: boolean;
  isDefault: boolean;
  formatValue: (value: number) => string;
  onChange: (value: number) => void;
  onReset: () => void;
}) {
  return (
    <SettingRow label={label} hint={hint}>
      <input
        type="range"
        className="af-sfx-range af-appearance-range"
        min={limit.min}
        max={limit.max}
        step={limit.step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={label}
      />
      <span className="af-appearance-value">{formatValue(value)}</span>
      <AppearanceResetButton label={label} disabled={isDefault} onClick={onReset} />
    </SettingRow>
  );
}

export function AppearanceSettingsSection({ model }: { model: AppearanceSettingsModel }) {
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
    accentColorInput,
    isAccentColorInputValid,
    isAccentColorInputDirty,
    appBackgroundImagePath,
    appBackgroundStatus,
    appBackgroundPreviewUrl,
    handleAccentColorTextChange,
    handleAccentColorTextCommit,
    handleAccentColorTextCancel,
    handleSelectAppBackground,
    handleClearAppBackground,
    immersiveLyricFontFamily,
    handleImmersiveLyricFontFamilyChange,
  } = model;

  const accentColorIsDefault = accentColor === APPEARANCE_DEFAULTS.accentColor;
  const lyricFontIsDefault = immersiveLyricFontFamily === DEFAULT_LYRIC_FONT_FAMILY;
  const appearanceIsDefault =
    theme === APPEARANCE_DEFAULTS.theme &&
    accentColorIsDefault &&
    artworkAmbienceEnabled === APPEARANCE_DEFAULTS.artworkAmbienceEnabled &&
    artworkAmbienceIntensity === APPEARANCE_DEFAULTS.artworkAmbienceIntensity &&
    artworkAmbienceScope === APPEARANCE_DEFAULTS.artworkAmbienceScope &&
    backgroundBlur === APPEARANCE_DEFAULTS.backgroundBlur &&
    backgroundBrightness === APPEARANCE_DEFAULTS.backgroundBrightness &&
    backgroundMaskOpacity === APPEARANCE_DEFAULTS.backgroundMaskOpacity &&
    gradientBackgroundEnabled === APPEARANCE_DEFAULTS.gradientBackgroundEnabled &&
    gradientBackgroundFollowArtwork === APPEARANCE_DEFAULTS.gradientBackgroundFollowArtwork &&
    lyricFontIsDefault;

  const restoreAllAppearance = () => {
    resetAppearance();
    if (!lyricFontIsDefault) handleImmersiveLyricFontFamilyChange(DEFAULT_LYRIC_FONT_FAMILY);
  };

  return (
<section className="af-settings-section af-appearance-section" id="appearance">
  <h2 className="af-settings-section-title">外观</h2>

  <div className="af-settings-group">
    <label className="af-settings-label">主题</label>
    <div className="af-settings-card">
      <SettingRow label="主题模式" hint="浅色 / 深色 / 跟随系统，切换后立即生效">
        <div className="af-segment">
          {THEME_OPTIONS.map(({ value, label, Icon }) => (
            <button
              key={value}
              type="button"
              className={`af-segment-btn ${theme === value ? "af-active" : ""}`}
              onClick={() => setTheme(value)}
              aria-pressed={theme === value}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>
        <AppearanceResetButton
          label="主题模式"
          disabled={theme === APPEARANCE_DEFAULTS.theme}
          onClick={() => setTheme(APPEARANCE_DEFAULTS.theme)}
        />
      </SettingRow>
    </div>
  </div>

  <div className="af-settings-group">
    <label className="af-settings-label">颜色</label>
    <div className="af-settings-card">
      <SettingRow label="强调色" hint="按钮、选中态与高亮共用的主色，改动即时预览">
        <AppearanceResetButton label="强调色" disabled={accentColorIsDefault} onClick={resetAccentColor} />
      </SettingRow>
      <div className="af-appearance-accent-editor">
        <div className="af-appearance-preset-list" role="group" aria-label="强调色预设">
          {ACCENT_PRESETS.map((preset) => (
            <button
              key={preset.value}
              type="button"
              className={`af-appearance-preset ${accentColor === preset.value ? "af-active" : ""}`}
              style={{ backgroundColor: preset.value }}
              onClick={() => setAccentColor(preset.value)}
              aria-label={`强调色预设：${preset.label}`}
              aria-pressed={accentColor === preset.value}
              title={preset.label}
            />
          ))}
        </div>
        <div className="af-appearance-accent-inputs">
          <label className="af-appearance-color-picker">
            <span
              className="af-appearance-color-swatch"
              style={{ backgroundColor: accentColor }}
              aria-hidden="true"
            />
            任意取色
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
            onBlur={handleAccentColorTextCommit}
            onKeyDown={(event) => {
              if (event.key === "Enter") handleAccentColorTextCommit();
              if (event.key === "Escape") handleAccentColorTextCancel();
            }}
            aria-label="输入强调色 Hex 值"
            aria-invalid={!isAccentColorInputValid}
            spellCheck={false}
            inputMode="text"
            placeholder="#3BD877"
          />
          {/* 挡住失焦：否则输入框的 blur 提交会先落盘，取消就回滚不掉 */}
          <button
            type="button"
            className="af-settings-small-button af-appearance-cancel"
            onClick={handleAccentColorTextCancel}
            onMouseDown={(event) => event.preventDefault()}
            disabled={!isAccentColorInputDirty}
          >
            取消
          </button>
        </div>
        <div className="af-appearance-accent-preview" aria-hidden="true">
          <span className="af-appearance-preview-pill">强调色预览</span>
          <span className="af-appearance-preview-note">文字自动取黑/白，浅色强调色也可读</span>
        </div>
      </div>
      <p className="af-settings-hint af-appearance-note">
        Hex 输入时实时预览，回车或失焦应用，Esc 取消并回滚到已保存的强调色。
      </p>
    </div>
  </div>

  <div className="af-settings-group">
    <label className="af-settings-label">氛围光</label>
    <div className="af-settings-card">
      <SettingRow label="从封面取色" hint="用当前封面主色驱动氛围光；不参与也不覆盖你手选的强调色">
        <input
          type="checkbox"
          className="af-switch"
          role="switch"
          checked={artworkAmbienceEnabled}
          onChange={(event) => patchAppearance({ artworkAmbienceEnabled: event.target.checked })}
          aria-label="从封面取色"
        />
        <AppearanceResetButton
          label="从封面取色"
          disabled={artworkAmbienceEnabled === APPEARANCE_DEFAULTS.artworkAmbienceEnabled}
          onClick={() =>
            patchAppearance({ artworkAmbienceEnabled: APPEARANCE_DEFAULTS.artworkAmbienceEnabled })
          }
        />
      </SettingRow>
      <AppearanceSliderRow
        label="氛围光强度"
        hint="播放条封面氛围光的浓度，0% 时该层完全透明"
        value={artworkAmbienceIntensity}
        limit={APPEARANCE_LIMITS.artworkAmbienceIntensity}
        disabled={!artworkAmbienceEnabled}
        isDefault={artworkAmbienceIntensity === APPEARANCE_DEFAULTS.artworkAmbienceIntensity}
        formatValue={(value) => `${value}%`}
        onChange={(value) => patchAppearance({ artworkAmbienceIntensity: value })}
        onReset={() =>
          patchAppearance({ artworkAmbienceIntensity: APPEARANCE_DEFAULTS.artworkAmbienceIntensity })
        }
      />
      <SettingRow label="作用范围" hint="关掉「从封面取色」或选「仅播放条」时，被排除的区域改用主题强调色">
        <div className="af-segment">
          <button
            type="button"
            className={`af-segment-btn ${artworkAmbienceScope === "player" ? "af-active" : ""}`}
            onClick={() => patchAppearance({ artworkAmbienceScope: "player" })}
            aria-pressed={artworkAmbienceScope === "player"}
            disabled={!artworkAmbienceEnabled}
          >
            仅播放条
          </button>
          <button
            type="button"
            className={`af-segment-btn ${artworkAmbienceScope === "player-immersive" ? "af-active" : ""}`}
            onClick={() => patchAppearance({ artworkAmbienceScope: "player-immersive" })}
            aria-pressed={artworkAmbienceScope === "player-immersive"}
            disabled={!artworkAmbienceEnabled}
          >
            播放条与沉浸歌词页
          </button>
        </div>
        <AppearanceResetButton
          label="作用范围"
          disabled={artworkAmbienceScope === APPEARANCE_DEFAULTS.artworkAmbienceScope}
          onClick={() => patchAppearance({ artworkAmbienceScope: APPEARANCE_DEFAULTS.artworkAmbienceScope })}
        />
      </SettingRow>
    </div>
  </div>

  <div className="af-settings-group">
    <label className="af-settings-label">背景</label>
    <p className="af-settings-hint">下面三个强度项只在设置了背景图片后生效。</p>
    <div className="af-settings-card">
      <SettingRow label="背景图片" hint={appBackgroundImagePath || "未设置，界面使用主题纯色背景"}>
        <span
          className={`af-appearance-background-thumb ${appBackgroundPreviewUrl ? "af-has-image" : ""}`}
          style={appBackgroundPreviewUrl ? { backgroundImage: `url("${appBackgroundPreviewUrl}")` } : undefined}
          aria-hidden="true"
        >
          {!appBackgroundPreviewUrl && <ImageIcon size={16} />}
        </span>
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
      </SettingRow>
      <AppearanceSliderRow
        label="背景模糊"
        hint="面板毛玻璃的模糊半径"
        value={backgroundBlur}
        limit={APPEARANCE_LIMITS.backgroundBlur}
        isDefault={backgroundBlur === APPEARANCE_DEFAULTS.backgroundBlur}
        formatValue={(value) => `${value}px`}
        onChange={(value) => patchAppearance({ backgroundBlur: value })}
        onReset={() => patchAppearance({ backgroundBlur: APPEARANCE_DEFAULTS.backgroundBlur })}
      />
      <AppearanceSliderRow
        label="背景亮度"
        hint="乘在主题预设亮度上，1.00 为预设值"
        value={backgroundBrightness}
        limit={APPEARANCE_LIMITS.backgroundBrightness}
        isDefault={backgroundBrightness === APPEARANCE_DEFAULTS.backgroundBrightness}
        formatValue={(value) => `${value.toFixed(2)}×`}
        onChange={(value) => patchAppearance({ backgroundBrightness: value })}
        onReset={() => patchAppearance({ backgroundBrightness: APPEARANCE_DEFAULTS.backgroundBrightness })}
      />
      <AppearanceSliderRow
        label="蒙层不透明度"
        hint="面板遮罩厚度，0% 时背景图完全透出"
        value={backgroundMaskOpacity}
        limit={APPEARANCE_LIMITS.backgroundMaskOpacity}
        isDefault={backgroundMaskOpacity === APPEARANCE_DEFAULTS.backgroundMaskOpacity}
        formatValue={(value) => `${value}%`}
        onChange={(value) => patchAppearance({ backgroundMaskOpacity: value })}
        onReset={() => patchAppearance({ backgroundMaskOpacity: APPEARANCE_DEFAULTS.backgroundMaskOpacity })}
      />
      {appBackgroundStatus && <p className="af-settings-hint af-appearance-note">{appBackgroundStatus}</p>}
    </div>
  </div>

  <div className="af-settings-group">
    <label className="af-settings-label">效果</label>
    <div className="af-settings-card">
      <SettingRow label="渐变动态背景" hint="整窗 CSS 渐变缓慢流动，纯渐变绘制，不引额外依赖">
        <input
          type="checkbox"
          className="af-switch"
          role="switch"
          checked={gradientBackgroundEnabled}
          onChange={(event) => patchAppearance({ gradientBackgroundEnabled: event.target.checked })}
          aria-label="渐变动态背景"
        />
        <AppearanceResetButton
          label="渐变动态背景"
          disabled={gradientBackgroundEnabled === APPEARANCE_DEFAULTS.gradientBackgroundEnabled}
          onClick={() =>
            patchAppearance({ gradientBackgroundEnabled: APPEARANCE_DEFAULTS.gradientBackgroundEnabled })
          }
        />
      </SettingRow>
      <SettingRow label="跟随封面色" hint="用当前封面主色作为渐变主色；取不到封面色时用强调色">
        <input
          type="checkbox"
          className="af-switch"
          role="switch"
          checked={gradientBackgroundFollowArtwork}
          onChange={(event) => patchAppearance({ gradientBackgroundFollowArtwork: event.target.checked })}
          disabled={!gradientBackgroundEnabled}
          aria-label="渐变背景跟随封面色"
        />
        <AppearanceResetButton
          label="跟随封面色"
          disabled={gradientBackgroundFollowArtwork === APPEARANCE_DEFAULTS.gradientBackgroundFollowArtwork}
          onClick={() =>
            patchAppearance({ gradientBackgroundFollowArtwork: APPEARANCE_DEFAULTS.gradientBackgroundFollowArtwork })
          }
        />
      </SettingRow>
      <p className="af-settings-hint af-appearance-note">
        与「背景图片」同时开启时，图片会盖住渐变背景；系统开启「减少动态效果」时渐变不再流动。
      </p>
    </div>
  </div>

  <div className="af-settings-group">
    <label className="af-settings-label">沉浸式歌词</label>
    <div className="af-settings-card">
      <SettingRow label="歌词字体" hint="只作用于沉浸式歌词页，主界面字体不可配置">
        <select
          className="af-settings-select af-appearance-select"
          value={immersiveLyricFontFamily}
          onChange={(event) => handleImmersiveLyricFontFamilyChange(event.target.value)}
          aria-label="歌词字体"
        >
          {IMMERSIVE_LYRIC_FONT_OPTIONS.map((option) => (
            <option key={option.label} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <AppearanceResetButton
          label="歌词字体"
          disabled={lyricFontIsDefault}
          onClick={() => handleImmersiveLyricFontFamilyChange(DEFAULT_LYRIC_FONT_FAMILY)}
        />
      </SettingRow>
      <div
        className="af-immersive-lyric-style-preview"
        style={{
          fontFamily: immersiveLyricFontFamily,
        }}
      >
        像是色彩浮游在水流中
      </div>
    </div>
  </div>

  <div className="af-appearance-footer">
    <button type="button" className="af-settings-button" onClick={restoreAllAppearance} disabled={appearanceIsDefault}>
      <RotateCcw size={14} />
      全部恢复默认
    </button>
    <p className="af-settings-hint af-appearance-note">
      恢复外观的全部设置；背景图片文件本身不删除，用「背景图片」行的按钮单独清除。
    </p>
  </div>
</section>
  );
}
