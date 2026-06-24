/**
 * 歌手详情页：头部信息 + 热门歌曲 / 专辑切换
 *
 * 数据走 wyAccountService.getArtistDetail/getArtistSongs/getArtistAlbums。
 * UI 风格对齐 PlaylistDetailView，复用同一套 song-list 类名。
 */

import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  getArtistDetail,
  getArtistSongs,
  getArtistAlbums,
} from "@/services/wyAccountService";
import { usePlayerStore } from "@/stores/playerStore";
import { SongAddMenuButton } from "@/components/SongAddMenuButton";
import { DownloadQualityButton } from "@/components/DownloadQualityButton";
import { formatDuration } from "@/lib/utils";
import type { MusicInfo, AlbumInfo } from "@lx/core";
import { ArrowLeft, Play, Shuffle, Clock, User, Loader2 } from "lucide-react";

interface ArtistInfo {
  id: string;
  name: string;
  picUrl: string;
  alias: string[];
  briefDesc: string;
  musicSize: number;
  albumSize: number;
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

export function ArtistDetailView() {
  type PendingPlayAction = 'play-all' | 'shuffle' | `track:${number}` | null;
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [tab, setTab] = useState<"songs" | "albums">("songs");
  const [info, setInfo] = useState<ArtistInfo | null>(null);
  const [songs, setSongs] = useState<MusicInfo[]>([]);
  const [albums, setAlbums] = useState<AlbumInfo[]>([]);
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

    Promise.all([getArtistDetail(id), getArtistSongs(id), getArtistAlbums(id)])
      .then(([detail, songsRes, albumsRes]) => {
        if (cancelled) return;
        setInfo(detail);
        setSongs(songsRes.songs as unknown as MusicInfo[]);
        setAlbums(albumsRes.albums);
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
          <p>加载歌手信息...</p>
        </div>
      </div>
    );
  }

  if (error || !info) {
    return (
      <div className="af-playlist-detail-view">
        <div className="af-empty-state">
          <p>加载失败</p>
          <span>{error || "歌手不存在"}</span>
          <button className="af-btn-primary" style={{ marginTop: 16 }} onClick={() => navigate(-1)}>
            返回
          </button>
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
          <div className="af-playlist-detail-cover" style={{ borderRadius: "50%" }}>
            {info.picUrl ? (
              <img src={info.picUrl} alt={info.name} />
            ) : (
              <div className="af-cover-placeholder"><User size={64} /></div>
            )}
          </div>

          <div className="af-playlist-detail-meta">
            <h1>{info.name}</h1>
            {info.alias.length > 0 && (
              <p className="af-playlist-description">别名：{info.alias.join(" / ")}</p>
            )}
            <p className="af-playlist-stats">
              {info.musicSize} 首作品 · {info.albumSize} 张专辑
            </p>
            {info.briefDesc && (
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
                  {info.briefDesc}
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
                <span>{isPlayAllPending ? '加载中' : '播放热门'}</span>
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

      <div className="af-artist-tabs">
        <button
          className={tab === "songs" ? "af-tab-active" : ""}
          onClick={() => setTab("songs")}
        >
          热门歌曲（{songs.length}）
        </button>
        <button
          className={tab === "albums" ? "af-tab-active" : ""}
          onClick={() => setTab("albums")}
        >
          专辑（{albums.length}）
        </button>
      </div>

      {tab === "songs" && (
        <div className="af-playlist-songs">
          {songs.length === 0 ? (
            <div className="af-empty-state"><p>暂无热门歌曲</p></div>
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
      )}

      {tab === "albums" && (
        <div className="af-artist-albums-grid">
          {albums.length === 0 ? (
            <div className="af-empty-state"><p>暂无专辑</p></div>
          ) : (
            albums.map((album) => (
              <button
                key={album.id}
                type="button"
                className="af-album-card"
                onClick={() => navigate(`/album/${album.id}`)}
              >
                <div className="af-album-cover">
                  {album.picUrl ? <img src={album.picUrl} alt={album.name} /> : <div className="af-cover-placeholder">♪</div>}
                </div>
                <div className="af-album-meta">
                  <h3 className="af-album-name">{album.name}</h3>
                  <p className="af-album-info">
                    {album.trackCount ? `${album.trackCount} 首` : ""}
                    {album.publishTime ? ` · ${formatDate(album.publishTime)}` : ""}
                  </p>
                </div>
              </button>
            ))
          )}
        </div>
      )}

      <style>{`
        .af-artist-tabs {
          display: flex;
          gap: 8px;
          padding: 16px 0;
          border-bottom: 1px solid var(--af-border-secondary);
          margin-bottom: 16px;
        }
        .af-artist-tabs button {
          padding: 8px 18px;
          background: transparent;
          border: none;
          color: var(--af-text-secondary);
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          border-radius: var(--af-radius-md);
        }
        .af-artist-tabs button:hover {
          background: var(--af-bg-hover);
        }
        .af-artist-tabs button.af-tab-active {
          color: var(--af-accent-primary);
          background: rgba(34, 197, 94, 0.12);
        }
        .af-artist-albums-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
          gap: 18px;
        }
        .af-album-card {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 0;
          background: transparent;
          border: none;
          cursor: pointer;
          text-align: left;
        }
        .af-album-cover {
          width: 100%;
          aspect-ratio: 1 / 1;
          border-radius: var(--af-radius-md);
          overflow: hidden;
          background: var(--af-bg-secondary);
          transition: transform 0.2s;
        }
        .af-album-cover img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .af-album-card:hover .af-album-cover {
          transform: translateY(-2px);
        }
        .af-album-name {
          font-size: 14px;
          font-weight: 600;
          color: var(--af-text-primary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          margin: 0;
        }
        .af-album-info {
          font-size: 12px;
          color: var(--af-text-secondary);
          margin: 0;
        }
      `}</style>
    </div>
  );
}
