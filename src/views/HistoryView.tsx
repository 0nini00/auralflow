import { ArrowLeft, Clock, History, Play, Shuffle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { DownloadQualityButton } from "@/components/DownloadQualityButton";
import { SongAddMenuButton } from "@/components/SongAddMenuButton";
import { formatDuration } from "@/lib/utils";
import { useHistoryStore } from "@/stores/historyStore";
import { usePlayerStore } from "@/stores/playerStore";

function fisherYatesShuffle<T>(items: T[]): T[] {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

export function HistoryView() {
  const navigate = useNavigate();
  const history = useHistoryStore((s) => s.history);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const historyCover = history[0]?.img || history[0]?.picUrl || "";

  return (
    <div className="af-playlist-detail-view af-history-view">
      <div className="af-playlist-detail-header">
        <button className="af-back-btn" onClick={() => navigate(-1)}>
          <ArrowLeft size={20} />
        </button>

        <div className="af-playlist-detail-info">
          <div className="af-playlist-detail-cover af-history-cover">
            {historyCover ? (
              <img src={historyCover} alt="播放历史封面" />
            ) : (
              <div className="af-cover-placeholder">
                <History size={64} strokeWidth={1.5} />
              </div>
            )}
          </div>

          <div className="af-playlist-detail-meta">
            <h1>播放历史</h1>
            <p className="af-playlist-stats">{history.length} 首歌曲</p>
            <div className="af-playlist-actions">
              <button
                className="af-btn-primary"
                onClick={() => history.length > 0 && void playQueue(history, 0)}
                disabled={history.length === 0}
              >
                <Play size={16} fill="currentColor" />
                <span>播放全部</span>
              </button>
              <button
                className="af-btn-secondary"
                onClick={() => history.length > 0 && void playQueue(fisherYatesShuffle(history), 0)}
                disabled={history.length === 0}
              >
                <Shuffle size={16} />
                <span>随机播放</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="af-playlist-songs">
        {history.length === 0 ? (
          <div className="af-empty-state">
            <History size={32} />
            <p>还没有播放历史</p>
            <span>播放歌曲后，这里会显示最近听过的内容。</span>
          </div>
        ) : (
          <>
            <div className="af-song-list-header">
              <div className="af-col-index">#</div>
              <div className="af-col-title">标题</div>
              <div className="af-col-artist">艺术家</div>
              <div className="af-col-album">专辑</div>
              <div className="af-col-duration"><Clock size={16} /></div>
              <div className="af-col-actions" />
            </div>
            <div className="af-song-list-body">
              {history.map((song, index) => (
                <div
                  key={`${song.source}-${song.id}-${index}`}
                  className="af-song-list-row"
                  onClick={() => { void playQueue(history, index); }}
                >
                  <div className="af-col-index">{index + 1}</div>
                  <div className="af-col-title">
                    <div className="af-song-cover">
                      {song.img || song.picUrl ? (
                        <img src={song.img || song.picUrl} alt={song.name} />
                      ) : (
                        <div className="af-cover-placeholder" />
                      )}
                    </div>
                    <span>{song.name}</span>
                  </div>
                  <div className="af-col-artist">{song.singer || "-"}</div>
                  <div className="af-col-album">{song.albumName || "-"}</div>
                  <div className="af-col-duration">{formatDuration(song.interval || 0)}</div>
                  <div className="af-col-actions" onClick={(event) => event.stopPropagation()}>
                    <button
                      className="af-action-btn"
                      onClick={() => { void playQueue(history, index); }}
                      title="播放"
                    >
                      <Play size={14} fill="currentColor" />
                    </button>
                    <SongAddMenuButton
                      song={song}
                      iconSize={14}
                      title="添加到我的喜欢或歌单"
                    />
                    <DownloadQualityButton
                      song={song}
                      iconSize={14}
                      title="下载"
                    />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
