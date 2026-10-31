import type { DataSettingsModel } from "../useSettingsViewModel";
import { formatByteSize } from "../useSettingsViewModel";
import { SettingRow } from "./SettingRow";

function formatCount(value: number | undefined): string {
  return value == null ? "计算中..." : String(value);
}

export function DataSettingsSection({ model }: { model: DataSettingsModel }) {
  const {
    mediaCacheStats,
    persistentCacheSummary,
    dataPending,
    dataStatus,
    handleClearPlaybackHistory,
    handleClearMediaCache,
    handleClearPlaybackUrlCache,
    handleClearLyricsCache,
  } = model;

  // 资源缓存 = 音频 + 封面文件；播放地址/歌词只存文本，不占这里的字节数。
  const resourceCacheSize = mediaCacheStats
    ? mediaCacheStats.audioCacheSize + mediaCacheStats.coverCacheSize
    : null;

  return (
<section className="af-settings-section" id="data">
  <h2 className="af-settings-section-title">数据管理</h2>

  <div className="af-settings-card">
    <SettingRow label="播放历史" hint="只清空最近播放记录，不影响收藏、歌单和缓存">
      <button
        type="button"
        className="af-settings-small-button"
        onClick={() => { void handleClearPlaybackHistory(); }}
        disabled={dataPending}
      >
        清空播放历史
      </button>
    </SettingRow>
  </div>

  <div className="af-settings-card" style={{ marginTop: 16 }}>
    <div className="af-settings-row">
      <div className="af-data-cache-block">
        <span className="af-settings-label">资源缓存</span>
        <p className="af-settings-hint">播放时落盘的歌曲音频与封面文件，超出容量上限后自动淘汰最久未使用的部分。</p>
        <div className="af-data-cache-size af-cache-size-single" aria-label="资源缓存大小">
          <div className="af-data-cache-size-item af-total">
            <span>已使用缓存大小</span>
            <strong>{formatByteSize(resourceCacheSize)}</strong>
          </div>
        </div>
      </div>
      <div className="af-settings-input-group" style={{ flexDirection: "column", alignItems: "stretch" }}>
        <button
          type="button"
          className="af-settings-small-button af-settings-danger-button"
          onClick={() => { void handleClearMediaCache(); }}
          disabled={dataPending}
        >
          清理缓存
        </button>
      </div>
    </div>
  </div>

  <div className="af-settings-card" style={{ marginTop: 16 }}>
    <div className="af-settings-row">
      <div className="af-data-cache-block">
        <span className="af-settings-label">歌曲元信息缓存</span>
        <p className="af-settings-hint">解析出的播放地址与歌词，独立于音频文件；清理后下次播放会重新解析或获取。</p>
        <div className="af-data-cache-size af-cache-size-pair" aria-label="歌曲元信息缓存条目数">
          <div className="af-data-cache-size-item">
            <span>歌曲 URL 数量</span>
            <strong>{formatCount(persistentCacheSummary?.playbackUrlCount)}</strong>
          </div>
          <div className="af-data-cache-size-item">
            <span>歌词数量</span>
            <strong>{formatCount(persistentCacheSummary?.lyricCount)}</strong>
          </div>
        </div>
      </div>
      <div className="af-settings-input-group" style={{ flexDirection: "column", alignItems: "stretch" }}>
        <button
          type="button"
          className="af-settings-small-button"
          onClick={() => { void handleClearPlaybackUrlCache(); }}
          disabled={dataPending}
        >
          清理歌曲 URL 缓存
        </button>
        <button
          type="button"
          className="af-settings-small-button af-settings-danger-button"
          onClick={() => { void handleClearLyricsCache(); }}
          disabled={dataPending}
        >
          清理歌词缓存
        </button>
      </div>
    </div>
  </div>

  {dataStatus && <p className="af-settings-hint" role="status">{dataStatus}</p>}
</section>
  );
}
