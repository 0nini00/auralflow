import type { DataSettingsModel } from "../useSettingsViewModel";
import { formatByteSize } from "../useSettingsViewModel";

export function DataSettingsSection({ model }: { model: DataSettingsModel }) {
  const {
    songCacheStats,
    dataPending,
    dataStatus,
    handleClearHistoryAndCache,
  } = model;

  return (
<section className="af-settings-section" id="data">
  <h2 className="af-settings-section-title">数据管理</h2>
  <div className="af-settings-row">
    <div>
      <label className="af-settings-label">播放历史与缓存</label>
      <p className="af-settings-hint">
        普通在线歌曲会缓存音频和封面。
      </p>
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
  );
}
