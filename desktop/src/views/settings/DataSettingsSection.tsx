import type { DataSettingsModel } from "../useSettingsViewModel";
import { formatByteSize } from "../useSettingsViewModel";
import { SettingRow } from "./SettingRow";
import { OfflineCacheLibrary } from '@/components/OfflineCacheLibrary';

function formatCount(value: number | undefined): string {
  return value == null ? "计算中..." : String(value);
}

/**
 * 数据管理。
 *
 * 三张卡共用同一套节奏，和设置页其它地方一致：
 *   · 一行 SettingRow —— 左侧「标题 + 说明」，右侧操作按钮（宽度自适应，不拉伸）；
 *   · 需要时再跟一行数据（.af-data-row），内边距与行高沿用 .af-setting-row，
 *     靠一条发丝线与上半行分开；
 *   · 数据条是扁平的 dl（标签与数值同一行），用细竖线分组，不再套一层带边框的
 *     容器 —— 卡片里再套卡片会读成两个层级；
 *   · 卡片之间由 .af-data-stack 提供间距：.af-settings-card 自身没有外边距，
 *     直接相邻的两张卡会拼成一整块，看不出这是三件事。
 */
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

      <div className="af-data-stack">
        <OfflineCacheLibrary />
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

        <div className="af-settings-card">
          <SettingRow
            label="资源缓存"
            hint="播放时落盘的歌曲音频与封面文件，超出容量上限后自动淘汰最久未使用的部分。"
          >
            <button
              type="button"
              className="af-settings-small-button af-settings-danger-button"
              onClick={() => { void handleClearMediaCache(); }}
              disabled={dataPending}
            >
              清理缓存
            </button>
          </SettingRow>
          <div className="af-data-row">
            <dl className="af-data-stats" aria-label="资源缓存占用">
              <div className="af-data-stat">
                <dt>已使用</dt>
                <dd>{formatByteSize(resourceCacheSize)}</dd>
              </div>
              <div className="af-data-stat">
                <dt>音频</dt>
                <dd>{formatByteSize(mediaCacheStats?.audioCacheSize ?? null)}</dd>
              </div>
              <div className="af-data-stat">
                <dt>封面</dt>
                <dd>{formatByteSize(mediaCacheStats?.coverCacheSize ?? null)}</dd>
              </div>
            </dl>
          </div>
        </div>

        <div className="af-settings-card">
          <SettingRow
            label="歌曲元信息缓存"
            hint="解析出的播放地址与歌词，独立于音频文件；清理后下次播放会重新解析或获取。"
          >
            <button
              type="button"
              className="af-settings-small-button"
              onClick={() => { void handleClearPlaybackUrlCache(); }}
              disabled={dataPending}
            >
              清理 URL 缓存
            </button>
            <button
              type="button"
              className="af-settings-small-button af-settings-danger-button"
              onClick={() => { void handleClearLyricsCache(); }}
              disabled={dataPending}
            >
              清理歌词缓存
            </button>
          </SettingRow>
          <div className="af-data-row">
            <dl className="af-data-stats" aria-label="歌曲元信息缓存条目数">
              <div className="af-data-stat">
                <dt>歌曲 URL</dt>
                <dd>{formatCount(persistentCacheSummary?.playbackUrlCount)}</dd>
              </div>
              <div className="af-data-stat">
                <dt>歌词</dt>
                <dd>{formatCount(persistentCacheSummary?.lyricCount)}</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>

      {dataStatus && <p className="af-settings-hint" role="status">{dataStatus}</p>}
    </section>
  );
}
