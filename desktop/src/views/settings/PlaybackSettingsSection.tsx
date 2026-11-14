import { Pause, Volume2 } from "lucide-react";
import { Select } from "@/components/ui";
import type { PlaybackSettingsModel } from "../useSettingsViewModel";
import { SettingRow } from "./SettingRow";

const QUALITY_OPTIONS = [
  { value: "128k", label: "标准 128K" },
  { value: "192k", label: "较高 192K" },
  { value: "320k", label: "高品质 320K" },
  { value: "flac", label: "无损 FLAC" },
  { value: "flac24bit", label: "Hi-Res" },
];

export function PlaybackSettingsSection({ model }: { model: PlaybackSettingsModel }) {
  const {
    defaultQuality,
    handleDefaultQualityChange,
    pauseOnExternalPlayback,
    handlePauseOnExternalPlaybackChange,
    playbackFailedAutoNext,
    handlePlaybackFailedAutoNextChange,
    playbackSettingsStatus,
  } = model;

  return (
<section className="af-settings-section" id="playback">
  <h2 className="af-settings-section-title">播放</h2>

  <div className="af-settings-card">
    <SettingRow label="音质偏好" hint="在线播放与下载的默认音质">
      <Select
        label="音质偏好"
        triggerClassName="af-settings-select"
        options={QUALITY_OPTIONS}
        value={defaultQuality}
        onChange={(quality) => { void handleDefaultQualityChange(quality); }}
      />
    </SettingRow>
    <SettingRow label="其他媒体播放时" hint="系统里其他应用开始播放时 AuralFlow 的反应">
      <div className="af-segment">
        <button
          type="button"
          className={`af-segment-btn ${pauseOnExternalPlayback ? "af-active" : ""}`}
          onClick={() => { void handlePauseOnExternalPlaybackChange(true); }}
          aria-pressed={pauseOnExternalPlayback}
        >
          <Pause size={14} />
          自动暂停
        </button>
        <button
          type="button"
          className={`af-segment-btn ${!pauseOnExternalPlayback ? "af-active" : ""}`}
          onClick={() => { void handlePauseOnExternalPlaybackChange(false); }}
          aria-pressed={!pauseOnExternalPlayback}
        >
          <Volume2 size={14} />
          继续播放
        </button>
      </div>
    </SettingRow>
    <SettingRow label="播放失败自动下一首" hint="播放中出错时自动跳下一首；私人 FM 始终连播">
      <input
        type="checkbox"
        className="af-switch"
        role="switch"
        aria-label="播放失败自动下一首"
        checked={playbackFailedAutoNext}
        onChange={(e) => { void handlePlaybackFailedAutoNextChange(e.target.checked); }}
      />
    </SettingRow>
  </div>
  {playbackSettingsStatus && <p className="af-settings-hint" role="status">{playbackSettingsStatus}</p>}
</section>
  );
}
