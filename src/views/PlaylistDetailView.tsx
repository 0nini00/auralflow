import { useParams, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePlaylistStore } from '@/stores/playlistStore';
import { useFavoritesStore } from '@/stores/favoritesStore';
import { usePlayerStore } from '@/stores/playerStore';
import { useWyAccountStore } from '@/stores/wyAccountStore';
import { SongAddMenuButton } from '@/components/SongAddMenuButton';
import { DownloadQualityButton } from '@/components/DownloadQualityButton';
import { VirtualList } from '@/components/VirtualList';
import { formatDuration } from '@/lib/utils';
import type { MusicInfo } from '@lx/core';
import { ArrowLeft, Play, Shuffle, Trash2, Clock, Loader2, CornerDownRight, MoreHorizontal, BookmarkX, RefreshCw } from 'lucide-react';

/** Fisher-Yates 均匀洗牌 */
function fisherYatesShuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function PlaylistDetailView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const {
    playlists,
    removeSongFromPlaylist,
  } = usePlaylistStore();

  const favorites = useFavoritesStore((s) => s.favorites);
  const removeFavorite = useFavoritesStore((s) => s.removeFavorite);

  // 网易云歌单支持
  const wyPlaylists = useWyAccountStore((s) => s.playlists);
  const wyGetSongs = useWyAccountStore((s) => s.getPlaylistSongs);
  const wyRefreshSongs = useWyAccountStore((s) => s.refreshPlaylistSongs);
  const wyRemoveTracks = useWyAccountStore((s) => s.removeTracks);
  const wySetSubscribed = useWyAccountStore((s) => s.setSubscribed);
  const [wySongs, setWySongs] = useState<MusicInfo[] | null>(null);
  const [wySongsLoading, setWySongsLoading] = useState(false);
  const [wySongsError, setWySongsError] = useState('');
  const [wyActionPending, setWyActionPending] = useState(false);
  const [wyRefreshing, setWyRefreshing] = useState(false);
  const [actionStatus, setActionStatus] = useState('');
  const [openMenuIndex, setOpenMenuIndex] = useState<number | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);

  const { playQueue, playNext } = usePlayerStore();

  const isFavoritesPlaylist = id === 'favorites';
  const localPlaylist = isFavoritesPlaylist
    ? { id: 'favorites', name: '我喜欢的音乐', songs: favorites, createdAt: 0, updatedAt: 0 }
    : playlists.find((p) => p.id === id);

  // 尝试匹配网易云歌单
  const wyPlaylist = !localPlaylist && id ? wyPlaylists.find(p => p.id === id) : null;

  // 异步加载网易云歌单歌曲
  useEffect(() => {
    if (!wyPlaylist) return;
    let cancelled = false;
    setWySongsLoading(true);
    setWySongsError('');
    wyGetSongs(wyPlaylist.id)
      .then(songs => { if (!cancelled) setWySongs(songs); })
      .catch(e => { if (!cancelled) setWySongsError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setWySongsLoading(false); });
    return () => { cancelled = true; };
  }, [wyPlaylist?.id]);

  // 最终展示的歌单数据
  const resolvedPlaylist = localPlaylist
    ? { ...localPlaylist, cover: (localPlaylist as any).cover ?? (localPlaylist as any).picUrl }
    : wyPlaylist
      ? { id: wyPlaylist.id, name: wyPlaylist.name, songs: wySongs ?? [], createdAt: 0, updatedAt: 0, description: wyPlaylist.author ? `by ${wyPlaylist.author}` : undefined, cover: wyPlaylist.picUrl }
      : null;

  if (wySongsLoading) {
    return (
      <div className="af-playlist-detail-view">
        <div className="af-empty-state">
          <Loader2 size={32} className="af-spin" />
          <p>加载歌单中...</p>
        </div>
      </div>
    );
  }

  if (wySongsError) {
    return (
      <div className="af-playlist-detail-view">
        <div className="af-empty-state">
          <p>加载失败</p>
          <span>{wySongsError}</span>
          <button onClick={() => navigate('/playlists')} style={{ marginTop: 16 }}>返回歌单列表</button>
        </div>
      </div>
    );
  }

  if (!localPlaylist && !wyPlaylist) {
    return (
      <div className="af-playlist-detail-view">
        <div className="af-empty-state">
          <p>歌单不存在</p>
          <button onClick={() => navigate('/playlists')}>返回歌单列表</button>
        </div>
      </div>
    );
  }

  const playlist = resolvedPlaylist!;
  const isWyPlaylist = !!wyPlaylist;
  const isWyOwned = isWyPlaylist && wyPlaylist!.subscribed === false;
  const isWySubscribed = isWyPlaylist && wyPlaylist!.subscribed === true;
  const songs = playlist.songs;

  const handlePlayAll = () => {
    if (songs.length > 0) playQueue(songs, 0);
  };

  const handleShufflePlay = () => {
    if (songs.length > 0) playQueue(fisherYatesShuffle(songs), 0);
  };

  const handlePlayTrack = (index: number) => {
    playQueue(songs, index);
  };

  const handlePlayNext = (song: MusicInfo) => {
    playNext(song);
  };

  const handleRemoveSong = (index: number) => {
    setOpenMenuIndex(null);
    setActionStatus('');
    if (isFavoritesPlaylist) {
      const song = favorites[index];
      if (song) removeFavorite(song);
      return;
    }
    if (isWyOwned) {
      const song = songs[index];
      if (!song) return;
      setWyActionPending(true);
      wyRemoveTracks(playlist.id, [song])
        .then(() => {
          setWySongs((prev) => prev ? prev.filter((_, i) => i !== index) : prev);
          setActionStatus('已从网易云歌单移除');
        })
        .catch((err) => {
          setActionStatus(`移除失败：${err instanceof Error ? err.message : String(err)}`);
        })
        .finally(() => setWyActionPending(false));
      return;
    }
    if (!isWyPlaylist) {
      removeSongFromPlaylist(playlist.id, index);
    }
  };

  const handleUnsubscribe = () => {
    if (!isWySubscribed) return;
    if (!confirm(`取消收藏歌单"${playlist.name}"？`)) return;
    setWyActionPending(true);
    setActionStatus('');
    wySetSubscribed(playlist.id, false)
      .then(() => navigate('/playlists'))
      .catch((err) => {
        setActionStatus(`取消收藏失败：${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => setWyActionPending(false));
  };

  const handleRefreshWy = () => {
    if (!isWyPlaylist) return;
    setWyRefreshing(true);
    setWySongsError('');
    wyRefreshSongs(playlist.id)
      .then((songs) => setWySongs(songs))
      .catch((err) => {
        setWySongsError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setWyRefreshing(false));
  };

  return (
    <div className="af-playlist-detail-view">
      <div className="af-playlist-detail-header">
        <button className="af-back-btn" onClick={() => navigate('/playlists')}>
          <ArrowLeft size={20} />
        </button>

        <div className="af-playlist-detail-info">
          <div className="af-playlist-detail-cover">
            {playlist.cover ? (
              <img src={playlist.cover} alt={playlist.name} />
            ) : (
              <div className="af-cover-placeholder">♪</div>
            )}
          </div>

          <div className="af-playlist-detail-meta">
            <h1>{playlist.name}</h1>
            {!isFavoritesPlaylist && !isWyPlaylist && playlist.description && (
              <p className="af-playlist-description">{playlist.description}</p>
            )}
            {isWyPlaylist && wyPlaylist && (
              <p className="af-playlist-description">by {wyPlaylist.author}{wyPlaylist.trackCount != null && ` · ${wyPlaylist.trackCount} 首`}</p>
            )}
            {!isWyPlaylist && (
              <p className="af-playlist-stats">
                {songs.length} 首歌曲
                {!isFavoritesPlaylist && playlist.createdAt > 0 && (
                  <>
                    {' · '}
                    创建于 {new Date(playlist.createdAt).toLocaleDateString('zh-CN')}
                  </>
                )}
              </p>
            )}

            <div className="af-playlist-actions">
              <button
                className="af-btn-primary"
                onClick={handlePlayAll}
                disabled={songs.length === 0}
              >
                <Play size={16} fill="currentColor" />
                <span>播放全部</span>
              </button>
              <button
                className="af-btn-secondary"
                onClick={handleShufflePlay}
                disabled={songs.length === 0}
              >
                <Shuffle size={16} />
                <span>随机播放</span>
              </button>
              {isWyPlaylist && (
                <button
                  className="af-btn-secondary"
                  onClick={handleRefreshWy}
                  disabled={wyRefreshing || wySongsLoading}
                  title="重新从网易云拉取最新歌单内容"
                >
                  <RefreshCw size={16} className={wyRefreshing ? 'af-spin' : ''} />
                  <span>{wyRefreshing ? '刷新中' : '刷新'}</span>
                </button>
              )}
              {isWySubscribed && (
                <button
                  className="af-btn-secondary"
                  onClick={handleUnsubscribe}
                  disabled={wyActionPending}
                  title="取消收藏该歌单"
                >
                  <BookmarkX size={16} />
                  <span>{wyActionPending ? '处理中' : '取消收藏'}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {actionStatus && <p className="af-playlist-action-status">{actionStatus}</p>}

      <div className="af-playlist-songs">
        {songs.length === 0 ? (
          <div className="af-empty-state">
            <p>歌单是空的</p>
            <span>从搜索或其他地方添加歌曲</span>
          </div>
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

            <VirtualList
              items={songs}
              rowHeight={60}
              className="af-song-list-virtual"
              onScroll={() => setOpenMenuIndex(null)}
              renderItem={(song, index) => (
                <div
                  className={`af-song-list-row ${openMenuIndex === index ? 'af-menu-open' : ''}`}
                  onClick={() => handlePlayTrack(index)}
                  title="单击播放"
                >
                  <div className="af-col-index">{index + 1}</div>

                  <div className="af-col-title">
                    <div className="af-song-cover">
                      {song.img ? (
                        <img src={song.img} alt={song.name} />
                      ) : (
                        <div className="af-cover-placeholder">♪</div>
                      )}
                    </div>
                    <span>{song.name}</span>
                  </div>

                  <div className="af-col-artist">{song.singer}</div>
                  <div className="af-col-album">{song.albumName || '-'}</div>
                  <div className="af-col-duration">{formatDuration(song.interval || 0)}</div>

                  <div className="af-col-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="af-action-btn"
                      onClick={() => handlePlayTrack(index)}
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
                    <button
                      className="af-action-btn"
                      onClick={(e) => {
                        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        setMenuPos({ top: r.bottom + 4, left: Math.max(8, r.right - 180) });
                        setOpenMenuIndex(openMenuIndex === index ? null : index);
                      }}
                      title="更多操作"
                    >
                      <MoreHorizontal size={14} />
                    </button>
                  </div>
                </div>
              )}
            />
          </>
        )}
      </div>

      {openMenuIndex != null && menuPos && songs[openMenuIndex] && createPortal(
        <div
          className="af-dropdown-menu af-song-action-menu af-song-action-portal"
          style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, zIndex: 9999 }}
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={() => handlePlayNext(songs[openMenuIndex!])}>
            <CornerDownRight size={14} />
            <span>下一首播放</span>
          </button>
          {(!isWyPlaylist || isWyOwned) && (
            <button
              className="af-menu-danger"
              onClick={() => { handleRemoveSong(openMenuIndex!); setOpenMenuIndex(null); }}
              disabled={wyActionPending}
            >
              <Trash2 size={14} />
              <span>移除</span>
            </button>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
