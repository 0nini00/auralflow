import type { DataSettingsModel } from "../useSettingsViewModel";
import { formatByteSize } from "../useSettingsViewModel";
import { SettingRow } from "./SettingRow";

export function DataSettingsSection({ model }: { model: DataSettingsModel }) {
  const {
    songCacheStats,
    dataPending,
    dataStatus,
    handleClearPlaybackHistory,
    handleClearAllCache,
    handleClearLyricsCache,
  } = model;

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
        <span className="af-settings-label">播放缓存</span>
        <p className="af-settings-hint">普通在线歌曲会缓存音频和封面；歌词有独立的清理入口。</p>
        <div className="af-data-cache-size" aria-label="播放缓存大小">
          <div className="af-data-cache-size-item af-total">
            <span>总占用</span>
            <strong>{formatByteSize(songCacheStats?.totalSize ?? null)}</strong>
          </div>
          <div className="af-data-cache-size-item">
            <span>播放链接/歌词</span>
            <strong>{formatByteSize(songCacheStats?.persistentCacheSize ?? null)}</strong>
          </div>
          <div className="af-data-cache-size-item">
            <span>歌曲音频文件</span>
            <strong>{formatByteSize(songCacheStats?.audioCacheSize ?? null)}</strong>
          </div>
          <div className="af-data-cache-size-item">
            <span>封面图片</span>
            <strong>{formatByteSize(songCacheStats?.coverCacheSize ?? null)}</strong>
          </div>
        </div>
      </div>
      <div className="af-settings-input-group" style={{ flexDirection: "column", alignItems: "stretch" }}>
        <button
          type="button"
          className="af-settings-small-button af-settings-danger-button"
          onClick={() => { void handleClearAllCache(); }}
          disabled={dataPending}
        >
          {dataPending ? "清理中..." : "清空全部缓存"}
        </button>
        <button
          type="button"
          className="af-settings-small-button"
          onClick={() => { void handleClearLyricsCache(); }}
          disabled={dataPending}
        >
          只清歌词缓存
        </button>
      </div>
    </div>
  </div>

  {dataStatus && <p className="af-settings-hint" role="status">{dataStatus}</p>}
</section>
  );
}
