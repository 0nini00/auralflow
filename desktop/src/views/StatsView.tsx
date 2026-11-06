import { BarChart3, Clock, Play, TrendingUp, Trophy, Users } from "lucide-react";
import { useMemo } from "react";
import { aggregateListeningEvents } from "@lx/core";
import { useListeningStatsStore } from "@/stores/listeningStatsStore";

/** 趋势区最多展示最近多少天（core 的 byDay 只含数据里出现过的天，空白天不补零）。 */
const TREND_WINDOW_DAYS = 30;

/** 榜单展示前几名。core 返回的是完整排名，截断属于 UI 决策。 */
const RANK_LIMIT = 10;

/** 累计时长按「小时 / 分钟 / 秒」展示：比单曲的 m:ss 更符合「一共听了多久」的读法。 */
function formatTotalDuration(totalMs: number): string {
  const seconds = Math.max(0, Math.round(totalMs / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes > 0 ? `${hours} 小时 ${restMinutes} 分钟` : `${hours} 小时`;
}

/** 条形长度：占当前榜单最大值的百分比。非零值保底 4%，否则「有数据却看不见条」。 */
function barWidth(value: number, max: number): string {
  if (value <= 0 || max <= 0) return "0%";
  return `${Math.max(4, Math.min(100, (value / max) * 100))}%`;
}

/** 本机独立收听会话；旧历史与 WebDAV 历史不冒充真实收听事件。 */
export function StatsView() {
  const events = useListeningStatsStore((s) => s.events);
  const error = useListeningStatsStore((s) => s.error);
  const loaded = useListeningStatsStore((s) => s.loaded);
  const stats = useMemo(() => aggregateListeningEvents(events), [events]);

  const topTracks = stats.topTracks.slice(0, RANK_LIMIT);
  const topArtists = stats.topArtists.slice(0, RANK_LIMIT);
  const trend = stats.byDay.slice(-TREND_WINDOW_DAYS);

  // 榜单按真实累计收听时长排序。
  const trackByDuration = stats.topTracks.some((track) => track.totalMs > 0);
  const artistByDuration = stats.topArtists.some((artist) => artist.totalMs > 0);
  const maxTrackValue = Math.max(0, ...topTracks.map((track) => (trackByDuration ? track.totalMs : track.plays)));
  const maxArtistValue = Math.max(0, ...topArtists.map((artist) => (artistByDuration ? artist.totalMs : artist.plays)));
  const maxDayPlays = Math.max(0, ...trend.map((day) => day.plays));

  if (!loaded) {
    return (
      <div className="af-stats-view af-animate-slide-in">
        <header className="af-stats-head">
          <h1 className="af-heading-1">听歌统计</h1>
        </header>
        <div className="af-empty-state">
          <BarChart3 size={32} />
          <p>正在读取收听统计…</p>
        </div>
      </div>
    );
  }

  if (stats.totalPlays === 0) {
    return (
      <div className="af-stats-view af-animate-slide-in">
        <header className="af-stats-head">
          <h1 className="af-heading-1">听歌统计</h1>
        </header>
        {error && <p role="alert" className="af-stats-notice">统计保存或读取失败：{error}</p>}
        <div className="af-empty-state">
          <BarChart3 size={32} />
          <p>还没有可以统计的播放记录</p>
          <span>
            仅统计本机从此版本开始的真实收听；旧历史不回填，WebDAV 历史不参与统计。
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="af-stats-view af-animate-slide-in">
      <header className="af-stats-head">
        <h1 className="af-heading-1">听歌统计</h1>
        <p className="af-text-body">
          仅统计本机从此版本开始的真实收听；旧历史不回填，WebDAV 历史不参与统计。
        </p>
      </header>

      {error && <p role="alert" className="af-stats-notice">统计保存或读取失败：{error}</p>}
      <section className="af-stats-cards" aria-label="总览">
        <article className="af-stats-card">
          <span className="af-stats-card-label">
            <Clock size={14} />总时长
          </span>
          <strong className="af-stats-card-value">{formatTotalDuration(stats.totalMs)}</strong>
          <span className="af-stats-card-note">按实际播放经过时间累计，暂停与跳转不计时</span>
        </article>
        <article className="af-stats-card">
          <span className="af-stats-card-label">
            <Play size={14} />总次数
          </span>
          <strong className="af-stats-card-value">{stats.totalPlays} 次</strong>
          <span className="af-stats-card-note">有效收听会话数，同曲重播独立计次</span>
        </article>
      </section>

      <section className="af-stats-panel">
        <h2 className="af-stats-panel-title">
          <Trophy size={16} />Top 歌曲
        </h2>
        <p className="af-stats-panel-note">
          按实际累计收听时长排序，每次重播分别累计。
        </p>
        {topTracks.length === 0 ? (
          <p className="af-stats-panel-empty">历史里没有可排名的歌曲。</p>
        ) : (
          <ol className="af-stats-rank-list">
            {topTracks.map((track, index) => (
              <li className="af-stats-rank-row" key={track.key}>
                <span className="af-stats-rank-index">{index + 1}</span>
                <div className="af-stats-rank-body">
                  <div className="af-stats-rank-line">
                    <span className="af-stats-rank-name" title={track.song.name}>
                      {track.song.name}
                    </span>
                    <span className="af-stats-rank-value">
                      {track.totalMs > 0 ? formatTotalDuration(track.totalMs) : "时长未知"}
                    </span>
                  </div>
                  <div className="af-stats-rank-sub">{track.song.singer || "未知歌手"}</div>
                  <div className="af-stats-bar">
                    <div
                      className="af-stats-bar-fill"
                      style={{ width: barWidth(trackByDuration ? track.totalMs : track.plays, maxTrackValue) }}
                    />
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="af-stats-panel">
        <h2 className="af-stats-panel-title">
          <Users size={16} />Top 歌手
        </h2>
        <p className="af-stats-panel-note">按累计时长排序；「A/B」这类合唱串整体算一个歌手，不拆分。</p>
        {topArtists.length === 0 ? (
          <p className="af-stats-panel-empty">历史里没有可排名的歌手（记录的歌手名可能为空）。</p>
        ) : (
          <ol className="af-stats-rank-list">
            {topArtists.map((artist, index) => (
              <li className="af-stats-rank-row" key={artist.name}>
                <span className="af-stats-rank-index">{index + 1}</span>
                <div className="af-stats-rank-body">
                  <div className="af-stats-rank-line">
                    <span className="af-stats-rank-name" title={artist.name}>
                      {artist.name}
                    </span>
                    <span className="af-stats-rank-value">
                      {artist.totalMs > 0 ? formatTotalDuration(artist.totalMs) : "时长未知"}
                    </span>
                  </div>
                  <div className="af-stats-bar">
                    <div
                      className="af-stats-bar-fill"
                      style={{ width: barWidth(artistByDuration ? artist.totalMs : artist.plays, maxArtistValue) }}
                    />
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="af-stats-panel">
        <h2 className="af-stats-panel-title">
          <TrendingUp size={16} />按天趋势
        </h2>
        {trend.length === 0 ? (
          <p className="af-stats-panel-empty">
            历史里没有可用的播放时间，画不出趋势；总时长与榜单不受影响。
          </p>
        ) : (
          <>
            <p className="af-stats-panel-note">
              最近 {trend.length} 天里有播放记录的日子（按本机时区的自然日切分，没有播放的日子不补零）。
            </p>
            <ol className="af-stats-rank-list">
              {trend.map((day) => (
                <li className="af-stats-rank-row" key={day.day}>
                  <span className="af-stats-rank-index af-stats-rank-index-day">{day.day.slice(5)}</span>
                  <div className="af-stats-rank-body">
                    <div className="af-stats-rank-line">
                      <span className="af-stats-rank-name">{day.plays} 次播放</span>
                      <span className="af-stats-rank-value">
                        {day.totalMs > 0 ? formatTotalDuration(day.totalMs) : "时长未知"}
                      </span>
                    </div>
                    <div className="af-stats-bar">
                      <div className="af-stats-bar-fill" style={{ width: barWidth(day.plays, maxDayPlays) }} />
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </>
        )}
      </section>
    </div>
  );
}
