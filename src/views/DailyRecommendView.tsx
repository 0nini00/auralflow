import { useEffect } from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDiscoveryStore } from '@/stores/discoveryStore';
import { useWyAccountStore } from '@/stores/wyAccountStore';
import { usePlayerStore } from '@/stores/playerStore';
import { SongAddMenuButton } from '@/components/SongAddMenuButton';
import { DownloadQualityButton } from '@/components/DownloadQualityButton';
import { formatDuration } from '@/lib/utils';
import { Calendar, Play, Shuffle, RefreshCw, Clock, Loader2 } from 'lucide-react';

type PendingPlayAction = 'play-all' | 'shuffle' | `track:${number}` | null;

function fisherYatesShuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function DailyRecommendView() {
  const navigate = useNavigate();
  const account = useWyAccountStore((s) => s.account);
  const isWyLoaded = useWyAccountStore((s) => s.isLoaded);
  const daily = useDiscoveryStore((s) => s.daily);
  const dailyLoading = useDiscoveryStore((s) => s.dailyLoading);
  const dailyError = useDiscoveryStore((s) => s.dailyError);
  const dailyDate = useDiscoveryStore((s) => s.dailyDate);
  const loadDaily = useDiscoveryStore((s) => s.loadDaily);
  const refreshDaily = useDiscoveryStore((s) => s.refreshDaily);

  const playQueue = usePlayerStore((s) => s.playQueue);
  const [pendingPlayAction, setPendingPlayAction] = useState<PendingPlayAction>(null);
  const isPlayAllPending = pendingPlayAction === 'play-all';
  const isShufflePending = pendingPlayAction === 'shuffle';

  const runPlayQueueAction = async (action: Exclude<PendingPlayAction, null>, queueToPlay: typeof daily, startIndex = 0) => {
    if (pendingPlayAction) return;
    setPendingPlayAction(action);
    try {
      await playQueue(queueToPlay as any, startIndex);
    } finally {
      setPendingPlayAction(null);
    }
  };

  useEffect(() => {
    if (account) loadDaily();
  }, [account]);

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

  if (!account) {
    return (
      <div className="af-playlist-detail-view">
        <div className="af-empty-state">
          <Calendar size={48} strokeWidth={1.5} />
          <p>请先登录网易云账号</p>
          <span>每日推荐根据你的听歌偏好生成</span>
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
            <div className="af-cover-placeholder" style={{ background: 'var(--af-accent-gradient)' }}>
              <Calendar size={64} color="white" />
            </div>
          </div>

          <div className="af-playlist-detail-meta">
            <h1>每日歌曲推荐</h1>
            <p className="af-playlist-description">
              根据你的口味，每日 6:00 更新 · {dailyDate || '今日'}
            </p>
            <p className="af-playlist-stats">
              {daily.length} 首歌曲
            </p>

            <div className="af-playlist-actions">
              <button
                className="af-btn-primary"
                onClick={() => daily.length > 0 && runPlayQueueAction('play-all', daily, 0)}
                disabled={daily.length === 0 || dailyLoading || isPlayAllPending}
              >
                {isPlayAllPending ? <Loader2 size={16} className="af-spin" /> : <Play size={16} fill="currentColor" />}
                <span>{isPlayAllPending ? '加载中' : '播放全部'}</span>
              </button>
              <button
                className="af-btn-secondary"
                onClick={() => daily.length > 0 && runPlayQueueAction('shuffle', fisherYatesShuffle(daily as any), 0)}
                disabled={daily.length === 0 || dailyLoading || isShufflePending}
              >
                {isShufflePending ? <Loader2 size={16} className="af-spin" /> : <Shuffle size={16} />}
                <span>{isShufflePending ? '加载中' : '随机播放'}</span>
              </button>
              <button
                className="af-btn-secondary"
                onClick={() => refreshDaily()}
                disabled={dailyLoading}
                title="重新获取每日推荐"
              >
                <RefreshCw size={16} className={dailyLoading ? 'af-spin' : ''} />
                <span>{dailyLoading ? '刷新中' : '刷新'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {dailyError && (
        <div className="af-empty-state">
          <p>加载失败</p>
          <span>{dailyError}</span>
        </div>
      )}

      {!dailyError && daily.length === 0 && !dailyLoading && (
        <div className="af-empty-state">
          <p>暂无推荐</p>
          <span>登录账号听一些歌，明天就有了</span>
        </div>
      )}

      {daily.length > 0 && (
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
            {daily.map((song, index) => (
              <div
                key={`${song.source}-${song.id}-${index}`}
                className="af-song-list-row"
                onClick={() => playQueue(daily as any, index)}
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
                    onClick={() => runPlayQueueAction(`track:${index}`, daily, index)}
                    disabled={pendingPlayAction === `track:${index}`}
                    title="播放"
                  >
                    {pendingPlayAction === `track:${index}` ? <Loader2 size={14} className="af-spin" /> : <Play size={14} fill="currentColor" />}
                  </button>
                  <SongAddMenuButton
                    song={song as any}
                    iconSize={14}
                    title="添加到我的喜欢或歌单"
                  />
                  <DownloadQualityButton
                    song={song as any}
                    iconSize={14}
                    title="下载"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
