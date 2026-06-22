import { EQ_FREQS, EQ_PRESETS, useSoundEffectStore } from "@/stores/soundEffectStore";

export function SoundEffectPanel() {
  const {
    enabled,
    gains,
    pan,
    reverbMix,
    presetId,
    pitch,
    setEnabled,
    setGain,
    setPan,
    setReverbMix,
    setPitch,
    applyPreset,
    reset,
  } = useSoundEffectStore();

  return (
    <div className="af-sound-panel" role="dialog" aria-label="音效设置">
      <div className="af-sound-panel-header">
        <span className="af-sound-panel-title">音效</span>
        <button type="button" className="af-settings-small-button" onClick={reset}>
          恢复默认
        </button>
      </div>

      <div className="af-sound-panel-group">
        <label className="af-settings-label">启用音效</label>
        <div className="af-sfx-toggle">
          <button
            type="button"
            className={`af-sfx-toggle-btn ${enabled ? "af-active" : ""}`}
            onClick={() => setEnabled(true)}
          >
            开启
          </button>
          <button
            type="button"
            className={`af-sfx-toggle-btn ${!enabled ? "af-active" : ""}`}
            onClick={() => setEnabled(false)}
          >
            关闭
          </button>
        </div>
      </div>

      <div className="af-sound-panel-group">
        <label className="af-settings-label">均衡器预设</label>
        <div className="af-sfx-presets">
          {EQ_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`af-sfx-pill ${presetId === preset.id ? "af-active" : ""}`}
              onClick={() => {
                applyPreset(preset.id);
                if (!enabled) setEnabled(true);
              }}
            >
              {preset.name}
            </button>
          ))}
          <button
            type="button"
            className={`af-sfx-pill ${presetId === "custom" ? "af-active" : ""}`}
            onClick={() => {
              if (!enabled) setEnabled(true);
            }}
          >
            自定义
          </button>
        </div>
      </div>

      <div className="af-sound-panel-group">
        <label className="af-settings-label">均衡器</label>
        <div className="af-sfx-eq" aria-disabled={!enabled}>
          {gains.map((gain, index) => (
            <div key={EQ_FREQS[index]} className="af-sfx-eq-row">
              <span className="af-sfx-eq-freq">{EQ_FREQS[index]} Hz</span>
              <input
                type="range"
                min={-12}
                max={12}
                step={1}
                value={gain}
                onChange={(event) => {
                  setGain(index, parseInt(event.target.value, 10));
                  if (!enabled) setEnabled(true);
                }}
                className="af-sfx-range"
                disabled={!enabled}
              />
              <span className="af-sfx-eq-value">{gain > 0 ? `+${gain}` : gain}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="af-sound-panel-group">
        <div className="af-sfx-eq-row">
          <span className="af-sfx-eq-freq">声像</span>
          <input
            type="range"
            min={-1}
            max={1}
            step={0.05}
            value={pan}
            onChange={(event) => {
              setPan(parseFloat(event.target.value));
              if (!enabled) setEnabled(true);
            }}
            className="af-sfx-range"
            disabled={!enabled}
          />
          <span className="af-sfx-eq-value">{pan.toFixed(2)}</span>
        </div>
      </div>

      <div className="af-sound-panel-group">
        <div className="af-sfx-eq-row">
          <span className="af-sfx-eq-freq">混响</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={reverbMix}
            onChange={(event) => {
              setReverbMix(parseFloat(event.target.value));
              if (!enabled) setEnabled(true);
            }}
            className="af-sfx-range"
            disabled={!enabled}
          />
          <span className="af-sfx-eq-value">{Math.round(reverbMix * 100)}%</span>
        </div>
      </div>

      <div className="af-sound-panel-group">
        <div className="af-sfx-eq-row">
          <span className="af-sfx-eq-freq">音高</span>
          <input
            type="range"
            min={-12}
            max={12}
            step={1}
            value={pitch}
            onChange={(event) => setPitch(parseInt(event.target.value, 10))}
            className="af-sfx-range"
          />
          <span className="af-sfx-eq-value">{pitch > 0 ? `+${pitch}` : pitch} 半音</span>
        </div>
      </div>
    </div>
  );
}
