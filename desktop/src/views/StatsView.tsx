import { AlertTriangle, BarChart3, Clock, Play, TrendingUp, Trophy, Users } from "lucide-react";
import { useMemo } from "react";
import { aggregateListeningStats, type HistoryPlayEntry } from "@lx/core";
import { MAX_HISTORY, useHistoryStore } from "@/stores/historyStore";

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

/**
 * 听歌统计：把本机播放历史（`useHistoryStore.history` + 真实时间戳）交给 core 的
 * `aggregateListeningStats` 聚合，界面只负责画数字卡片与纯 CSS 条形榜——不引入图表库。
 *
 * 诚实边界（都写在界面上）：
 * - 历史上限 `MAX_HISTORY` 条，更早的播放不在统计里；
 * - 桌面旧历史没有时间戳，那部分只进总数 / 总时长 / 榜单，不进趋势；
 * - 时长字段缺失的记录计入次数但不计入总时长（`playsWithoutDuration`）。
 */
export function StatsView() {
  const statsEntries = useHistoryStore((s) => s.statsEntries);
  // 这两个切片本身不直接渲染，只作为重算依赖：`statsEntries` 是读取当前 store 的稳定引用，
  // 不把 history / 时间戳列进依赖，删历史或清空后统计数字会停在旧值上。
  const history = useHistoryStore((s) => s.history);
  const playedAtByKey = useHistoryStore((s) => s.playedAtByKey);

  const entries = useMemo(() => statsEntries(), [statsEntries, history, playedAtByKey]);
  const stats = useMemo(() => aggregateListeningStats(entries), [entries]);
  const missingPlayedAt = useMemo(
    () => entries.filter((entry: HistoryPlayEntry) => entry.playedAt == null).length,
    [entries],
  );

  const topTracks = stats.topTracks.slice(0, RANK_LIMIT);
  const topArtists = stats.topArtists.slice(0, RANK_LIMIT);
  const trend = stats.byDay.slice(-TREND_WINDOW_DAYS);

  // 桌面历史按 `source:id` 去重，每首歌的次数恒为 1，靠次数排不出长度差：
  // 榜单条形优先用累计时长，一条时长都没有时才退回次数。
  const trackByDuration = stats.topTracks.some((track) => track.totalMs > 0);
  const artistByDuration = stats.topArtists.some((artist) => artist.totalMs > 0);
  const maxTrackValue = Math.max(0, ...topTracks.map((track) => (trackByDuration ? track.totalMs : track.plays)));
  const maxArtistValue = Math.max(0, ...topArtists.map((artist) => (artistByDuration ? artist.totalMs : artist.plays)));
  const maxDayPlays = Math.max(0, ...trend.map((day) => day.plays));

  if (stats.totalPlays === 0) {
    return (
      <div className="af-stats-view af-animate-slide-in">
        <header className="af-stats-head">
          <h1 className="af-heading-1">听歌统计</h1>
        </header>
        <div className="af-empty-state">
          <BarChart3 size={32} />
          <p>还没有可以统计的播放记录</p>
          <span>
            播放过的歌曲会进入本机播放历史（上限 {MAX_HISTORY} 条），之后这里会显示总时长、次数与榜单。
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
          数据来自本机播放历史（上限 {MAX_HISTORY} 条，更早的播放已被截断）；开启 WebDAV 同步时，
          云端历史（含其它设备）会合并进来一起统计。
        </p>
      </header>

      <section className="af-stats-cards" aria-label="总览">
        <article className="af-stats-card">
          <span className="af-stats-card-label">
            <Clock size={14} />总时长
          </span>
          <strong className="af-stats-card-value">{formatTotalDuration(stats.totalMs)}</strong>
          <span className="af-stats-card-note">按每条记录的歌曲时长累计</span>
        </article>
        <article className="af-stats-card">
          <span className="af-stats-card-label">
            <Play size={14} />总次数
          </span>
          <strong className="af-stats-card-value">{stats.totalPlays} 次</strong>
          <span className="af-stats-card-note">历史条数（同一首歌只保留一条记录）</span>
        </article>
        {stats.playsWithoutDuration > 0 && (
          <article className="af-stats-card af-stats-card-warn">
            <span className="af-stats-card-label">
              <AlertTriangle size={14} />时长未知
            </span>
            <strong className="af-stats-card-value">{stats.playsWithoutDuration} 次</strong>
            <span className="af-stats-card-note">这些记录没有歌曲时长，未计入总时长</span>
          </article>
        )}
      </section>

      {missingPlayedAt > 0 && (
        <p className="af-stats-notice">
          <AlertTriangle size={14} />
          <span>
            部分历史没有播放时间，趋势可能不完整（{missingPlayedAt} / {stats.totalPlays} 条缺少时间；
            旧版本记录的历史不会回填时间）。
          </span>
        </p>
      )}

      <section className="af-stats-panel">
        <h2 className="af-stats-panel-title">
          <Trophy size={16} />Top 歌曲
        </h2>
        <p className="af-stats-panel-note">
          按累计时长排序。历史里同一首歌只保留一条记录、次数恒为 1，所以不按次数排名。
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
