import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Cloud, Clock, Loader2, Play, RefreshCw, Shuffle, CornerDownRight } from 'lucide-react';
import { cloudQualityLabel } from '@lx/core';
import { useWyAccountStore } from '@/stores/wyAccountStore';
import { useCloudDriveStore } from '@/stores/cloudDriveStore';
import { usePlayerStore } from '@/stores/playerStore';
import { SongAddMenuButton } from '@/components/SongAddMenuButton';
import { DownloadQualityButton } from '@/components/DownloadQualityButton';
import { formatDuration } from '@/lib/utils';
import { coverSrc } from '@/utils/imageReferrerPolicy';
import { fisherYatesShuffle } from '@/utils/shared';

type PendingPlayAction = 'play-all' | 'shuffle' | `track:${number}` | null;

/** 容量展示：按 1024 进制，保留一位小数，GB 以下退到 MB。 */
function formatBytes(bytes?: number): string {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return '—';
  const gb = bytes / 1024 / 1024 / 1024;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}

/**
 * 音乐云盘页。
 *
 * 数据来自 weapi `/v1/cloud/get`（见 `services/wyAccountService.getCloudSongs`），
 * **不是搜索结果**：实测账号内 161 条里只有 40 条被网易云匹配到在线曲目、能被
 * `cloudsearch` 命中，剩下 121 条仅自己可见。所以这个页面是「浏览云盘」而不是
 * 「搜索云盘」。
 *
 * 条目由 `@lx/core` 的 `toCloudMusicInfos` 映射成带 `wyCloud: true` 的 MusicInfo，
 * 播放链路据此跳过网关/自定义源与试听判定（见 `services/playback/playbackResolver`）。
 */
export function CloudDriveView() {
  const navigate = useNavigate();
  const account = useWyAccountStore((s) => s.account);
  const isWyLoaded = useWyAccountStore((s) => s.isLoaded);

  const songs = useCloudDriveStore((s) => s.songs);
  const count = useCloudDriveStore((s) => s.count);
  const usedBytes = useCloudDriveStore((s) => s.usedBytes);
  const maxBytes = useCloudDriveStore((s) => s.maxBytes);
  const loading = useCloudDriveStore((s) => s.loading);
  const loadingMore = useCloudDriveStore((s) => s.loadingMore);
  const error = useCloudDriveStore((s) => s.error);
  const loaded = useCloudDriveStore((s) => s.loaded);
  const initialize = useCloudDriveStore((s) => s.initialize);
  const loadMore = useCloudDriveStore((s) => s.loadMore);
  const refresh = useCloudDriveStore((s) => s.refresh);

  const playNext = usePlayerStore((s) => s.playNext);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const [pendingPlayAction, setPendingPlayAction] = useState<PendingPlayAction>(null);
  const isPlayAllPending = pendingPlayAction === 'play-all';
  const isShufflePending = pendingPlayAction === 'shuffle';

  // 用接口给的 hasMore，而不是「已加载条数 < 总数」：映射会丢掉缺 id 的条目，
  // 两者不相等时前者才是真实结论（见 getCloudSongs 的 nextOffset 说明）。
  const hasMore = useCloudDriveStore((s) => s.hasMore);

  // 触底自动加载：接口按 200 条一页，绝大多数云盘一次就到位；这条兜底只对
  // 更大的库生效，避免用户必须反复点「加载更多」才能翻到底。
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = loadMoreSentinelRef.current;
    if (!node || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore();
      },
      { rootMargin: '400px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loadMore, songs.length]);

  // 换账号 / 退出登录都要重算列表：store 用 uid 判定归属，传空串会清空。
  useEffect(() => {
    void initialize(account?.uid ?? '');
  }, [account?.uid, initialize]);

  const headerCoverUrl = useMemo(
    () => coverSrc(songs[0]?.picUrl || songs[0]?.img || '', 240) || '',
    [songs],
  );

  const runPlayQueueAction = async (
    action: Exclude<PendingPlayAction, null>,
    queueToPlay: typeof songs,
    startIndex = 0,
  ) => {
    if (pendingPlayAction) return;
    setPendingPlayAction(action);
    try {
      await playQueue(queueToPlay, startIndex);
    } finally {
      setPendingPlayAction(null);
    }
  };

  if (!isWyLoaded) {
    return (
      <div className="af-playlist-detail-view">
        <div className="af-empty-state">
          <Loader2 size={32} className="af-spin" />
          <p>加载中...</p>
        </div>
      </div>
    );
  }

  // 云盘是账号私有资源：未登录时不渲染内容，也不宣传"登录后可用"以外的任何东西。
  if (!account) {
    return (
      <div className="af-playlist-detail-view">
        <div className="af-empty-state">
          <Cloud size={48} strokeWidth={1.5} />
          <p>请先登录网易云账号</p>
          <span>音乐云盘里的文件只对你自己可见，需要登录后读取</span>
          <button
            className="af-btn-primary"
            style={{ marginTop: 16 }}
            onClick={() => navigate('/settings')}
          >
            去登录
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="af-playlist-detail-view">
      <div className="af-playlist-detail-header">
        <div className="af-playlist-detail-info">
          <div className="af-playlist-detail-cover">
            {headerCoverUrl ? (
              <img src={headerCoverUrl} alt="云盘封面" />
            ) : (
              <div className="af-cover-placeholder" style={{ background: 'var(--af-accent-gradient)' }}>
                <Cloud size={64} color="white" />
              </div>
            )}
          </div>

          <div className="af-playlist-detail-meta">
            <h1>音乐云盘</h1>
            <p className="af-playlist-description">
              你自己上传到网易云的文件 · 已用 {formatBytes(usedBytes)} / {formatBytes(maxBytes)}
            </p>
            <p className="af-playlist-stats">
              {count} 首歌曲{songs.length < count ? ` · 已加载 ${songs.length} 首` : ''}
            </p>

            <div className="af-playlist-actions">
              <button
                className="af-btn-primary"
                onClick={() => songs.length > 0 && runPlayQueueAction('play-all', songs, 0)}
                disabled={songs.length === 0 || loading || isPlayAllPending}
              >
                {isPlayAllPending ? <Loader2 size={16} className="af-spin" /> : <Play size={16} fill="currentColor" />}
                <span>{isPlayAllPending ? '加载中' : '播放全部'}</span>
              </button>
              <button
                className="af-btn-secondary"
                onClick={() => songs.length > 0 && runPlayQueueAction('shuffle', fisherYatesShuffle(songs), 0)}
                disabled={songs.length === 0 || loading || isShufflePending}
              >
                {isShufflePending ? <Loader2 size={16} className="af-spin" /> : <Shuffle size={16} />}
                <span>{isShufflePending ? '加载中' : '随机播放'}</span>
              </button>
              <button
                className="af-btn-secondary"
                onClick={() => void refresh()}
                disabled={loading || loadingMore}
                title="重新读取云盘列表"
              >
                <RefreshCw size={16} className={loading ? 'af-spin' : ''} />
                <span>{loading ? '刷新中' : '刷新'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="af-empty-state">
          <p>加载失败</p>
          <span>{error}</span>
        </div>
      )}

      {!error && loading && songs.length === 0 && (
        <div className="af-empty-state">
          <Loader2 size={32} className="af-spin" />
          <p>正在读取云盘...</p>
        </div>
      )}

      {!error && !loading && loaded && songs.length === 0 && (
        <div className="af-empty-state">
          <p>云盘里没有歌曲</p>
          <span>在网易云音乐客户端里「上传到音乐云盘」之后会出现在这里</span>
        </div>
      )}

      {songs.length > 0 && (
        <div className="af-playlist-songs">
          <div className="af-song-list-header">
            <div className="af-col-index">#</div>
            <div className="af-col-title">标题</div>
            <div className="af-col-artist">艺术家</div>
            <div className="af-col-album">专辑</div>
            <div className="af-col-duration"><Clock size={16} /></div>
            <div className="af-col-actions"></div>
          </div>

          <div className="af-song-list-body">
            {songs.map((song, index) => {
              const qualityLabel = cloudQualityLabel(song.cloudMeta?.bitrate);
              const rowKey = `${song.source}-${song.id}-${index}`;
              return (
                <div
                  key={rowKey}
                  className="af-song-list-row"
                  onClick={() => runPlayQueueAction(`track:${index}`, songs, index)}
                  title="单击播放"
                >
                  <div className="af-col-index">{index + 1}</div>

                  <div className="af-col-title">
                    <div className="af-song-cover">
                      {song.picUrl || song.img ? (
                        <img src={coverSrc(song.picUrl || song.img, 48)} alt={song.name} />
                      ) : (
                        <div className="af-cover-placeholder">暂无封面</div>
                      )}
                    </div>
                    <span>{song.name}</span>
                    {qualityLabel && <span className="af-song-quality-tag">{qualityLabel}</span>}
                  </div>

                  <div className="af-col-artist">{song.singer}</div>
                  <div className="af-col-album">{song.albumName || '-'}</div>
                  <div className="af-col-duration">{formatDuration(song.interval || 0)}</div>

                  <div className="af-col-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="af-action-btn"
                      onClick={() => playNext(song)}
                      title="下一首播放"
                      aria-label="下一首播放"
                    >
                      <CornerDownRight size={14} />
                    </button>
                    <SongAddMenuButton song={song} iconSize={14} title="添加到我的喜欢或歌单" />
                    <DownloadQualityButton song={song} iconSize={14} title="下载" />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {hasMore && (
        <div ref={loadMoreSentinelRef} className="af-empty-state" style={{ paddingTop: 8, paddingBottom: 24 }}>
          <button
            className="af-btn-secondary"
            onClick={() => void loadMore()}
            disabled={loadingMore || loading}
          >
            {loadingMore ? <Loader2 size={16} className="af-spin" /> : null}
            <span>{loadingMore ? '加载中' : '加载更多'}</span>
          </button>
        </div>
      )}
    </div>
  );
}
