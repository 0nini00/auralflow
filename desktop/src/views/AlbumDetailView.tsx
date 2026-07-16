/**
 * 专辑详情页：复用 PlaylistDetailView 同样的歌曲列表样式。
 */

import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getAlbumDetail } from "@/services/wyAccountService";
import { usePlayerStore } from "@/stores/playerStore";
import { SongAddMenuButton } from "@/components/SongAddMenuButton";
import { DownloadQualityButton } from "@/components/DownloadQualityButton";
import { formatDuration } from "@/lib/utils";
import type { MusicInfo } from "@lx/core";
import { ArrowLeft, Play, Shuffle, Clock, Disc3, Loader2 } from "lucide-react";

interface AlbumInfoFull {
  id: string;
  name: string;
  picUrl: string;
  artist: string;
  artistId: string;
  publishTime: number;
  trackCount: number;
  description: string;
}

function fisherYatesShuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function formatDate(ts: number) {
  if (!ts) return "";
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function AlbumDetailView() {
  type PendingPlayAction = 'play-all' | 'shuffle' | `track:${number}` | null;
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [info, setInfo] = useState<AlbumInfoFull | null>(null);
  const [songs, setSongs] = useState<MusicInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [descExpanded, setDescExpanded] = useState(false);
  const [pendingPlayAction, setPendingPlayAction] = useState<PendingPlayAction>(null);

  const playQueue = usePlayerStore((s) => s.playQueue);
  const isPlayAllPending = pendingPlayAction === 'play-all';
  const isShufflePending = pendingPlayAction === 'shuffle';

  const runPlayQueueAction = async (action: Exclude<PendingPlayAction, null>, queueToPlay: MusicInfo[], startIndex = 0) => {
    if (pendingPlayAction) return;
    setPendingPlayAction(action);
    try {
      await playQueue(queueToPlay, startIndex);
    } finally {
      setPendingPlayAction(null);
    }
  };

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setError("");

    getAlbumDetail(id)
      .then((data) => {
        if (cancelled) return;
        setInfo(data.info);
        setSongs(data.songs as unknown as MusicInfo[]);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="af-playlist-detail-view">
        <div className="af-empty-state">
          <Loader2 size={32} className="af-spin" />
          <p>加载专辑...</p>
        </div>
      </div>
    );
  }

  if (error || !info) {
    return (
      <div className="af-playlist-detail-view">
        <div className="af-empty-state">
          <p>加载失败</p>
          <span>{error || "专辑不存在"}</span>
          <button className="af-btn-primary" style={{ marginTop: 16 }} onClick={() => navigate(-1)}>返回</button>
        </div>
      </div>
    );
  }

  return (
    <div className="af-playlist-detail-view">
      <div className="af-playlist-detail-header">
        <button className="af-back-btn" onClick={() => navigate(-1)}>
          <ArrowLeft size={20} />
        </button>

        <div className="af-playlist-detail-info">
          <div className="af-playlist-detail-cover">
            {info.picUrl ? (
              <img src={info.picUrl} alt={info.name} />
            ) : (
              <div className="af-cover-placeholder"><Disc3 size={64} /></div>
            )}
          </div>

          <div className="af-playlist-detail-meta">
            <h1>{info.name}</h1>
            <p className="af-playlist-description">
              {info.artistId ? (
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); navigate(`/artist/${info.artistId}`); }}
                  style={{ color: "var(--af-accent-primary)", background: "none", border: "none", padding: 0, cursor: "pointer" }}
                >
                  {info.artist}
                </button>
              ) : info.artist}
              {info.publishTime ? ` · ${formatDate(info.publishTime)}` : ""}
            </p>
            <p className="af-playlist-stats">
              {info.trackCount} 首
            </p>
            {info.description && (
              <div style={{ marginTop: 12 }}>
                <p
                  className="af-playlist-description"
                  style={
                    descExpanded
                      ? {}
                      : {
                          maxHeight: 60,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          display: "-webkit-box",
                          WebkitLineClamp: 3,
                          WebkitBoxOrient: "vertical",
                        }
                  }
                >
                  {info.description}
                </p>
                <button
                  type="button"
                  className="af-desc-toggle"
                  onClick={() => setDescExpanded((v) => !v)}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--af-accent-primary)",
                    fontSize: 13,
                    padding: "4px 0",
                    cursor: "pointer",
                  }}
                >
                  {descExpanded ? "收起" : "展开"}
                </button>
              </div>
            )}

            <div className="af-playlist-actions">
              <button
                className="af-btn-primary"
                onClick={() => songs.length > 0 && void runPlayQueueAction('play-all', songs, 0)}
                disabled={songs.length === 0 || isPlayAllPending}
              >
                {isPlayAllPending ? <Loader2 size={16} className="af-spin" /> : <Play size={16} fill="currentColor" />}
                <span>{isPlayAllPending ? '加载中' : '播放全部'}</span>
              </button>
              <button
                className="af-btn-secondary"
                onClick={() => songs.length > 0 && void runPlayQueueAction('shuffle', fisherYatesShuffle(songs), 0)}
                disabled={songs.length === 0 || isShufflePending}
              >
                {isShufflePending ? <Loader2 size={16} className="af-spin" /> : <Shuffle size={16} />}
                <span>{isShufflePending ? '加载中' : '随机播放'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="af-playlist-songs">
        {songs.length === 0 ? (
          <div className="af-empty-state"><p>暂无曲目</p></div>
        ) : (
          <>
            <div className="af-song-list-header">
              <div className="af-col-index">#</div>
              <div className="af-col-title">标题</div>
              <div className="af-col-artist">艺术家</div>
              <div className="af-col-album">专辑</div>
              <div className="af-col-duration"><Clock size={16} /></div>
              <div className="af-col-actions"></div>
            </div>
            <div className="af-song-list-body">
              {songs.map((song, index) => (
                <div
                  key={`${song.source}-${song.id}-${index}`}
                  className="af-song-list-row"
                  onClick={() => { void runPlayQueueAction(`track:${index}`, songs, index); }}
                >
                  <div className="af-col-index">{index + 1}</div>
                  <div className="af-col-title">
                    <div className="af-song-cover">
                      {song.img ? <img src={song.img} alt={song.name} /> : <div className="af-cover-placeholder">♪</div>}
                    </div>
                    <span>{song.name}</span>
                  </div>
                  <div className="af-col-artist">{song.singer}</div>
                  <div className="af-col-album">{song.albumName || "-"}</div>
                  <div className="af-col-duration">{formatDuration(song.interval || 0)}</div>
                  <div className="af-col-actions" onClick={(e) => e.stopPropagation()}>
                    <button className="af-action-btn" onClick={() => { void runPlayQueueAction(`track:${index}`, songs, index); }} title="播放">
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
