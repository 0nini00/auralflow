import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDiscoveryStore } from '@/stores/discoveryStore';
import { useWyAccountStore } from '@/stores/wyAccountStore';
import { usePlayerStore } from '@/stores/playerStore';
import { SongAddMenuButton } from '@/components/SongAddMenuButton';
import type { MusicInfo } from '@lx/core';
import { Radio, Play, Pause, SkipForward, ThumbsDown, Loader2, Music } from 'lucide-react';

export function PersonalFmView() {
  const navigate = useNavigate();
  const account = useWyAccountStore((s) => s.account);
  const isWyLoaded = useWyAccountStore((s) => s.isLoaded);

  const fmQueue = useDiscoveryStore((s) => s.fmQueue);
  const fmIndex = useDiscoveryStore((s) => s.fmIndex);
  const fmLoading = useDiscoveryStore((s) => s.fmLoading);
  const fmError = useDiscoveryStore((s) => s.fmError);
  const loadFm = useDiscoveryStore((s) => s.loadFm);
  const fmNext = useDiscoveryStore((s) => s.fmNext);
  const fmDislike = useDiscoveryStore((s) => s.fmDislike);

  const current = usePlayerStore((s) => s.current);
  const status = usePlayerStore((s) => s.status);
  const play = usePlayerStore((s) => s.play);
  const pause = usePlayerStore((s) => s.pause);
  const resume = usePlayerStore((s) => s.resume);
  const enterFmMode = usePlayerStore((s) => s.enterFmMode);

  const [acting, setActing] = useState(false);
  const autoStartPending = useRef(false);

  // 进入页面：启用 FM 模式（让播放结束自动连播）+ 未加载就拉一批
  useEffect(() => {
    if (account) {
      enterFmMode();
      if (fmQueue.length === 0 && !fmLoading) {
        void loadFm();
      }
    }
  }, [account]);

  // FM 队列就绪后通过 fmNext 起播，保证 fmIndex 与实际播放曲目同步。
  useEffect(() => {
    const currentIsFmTrack = Boolean(
      current && fmQueue.some((track) => track.source === current.source && track.id === current.id),
    );
    if (fmQueue.length > 0 && !currentIsFmTrack && !autoStartPending.current) {
      autoStartPending.current = true;
      void (async () => {
        try {
          const next = await fmNext();
          if (next) await play(next as MusicInfo);
        } finally {
          autoStartPending.current = false;
        }
      })();
    }
  }, [current, fmNext, fmQueue, play]);

  if (!isWyLoaded) {
    return (
      <div className="af-fm-view">
        <div className="af-empty-state">
          <Loader2 size={32} className="af-spin" />
          <p>加载中...</p>
        </div>
      </div>
    );
  }

  if (!account) {
    return (
      <div className="af-fm-view">
        <div className="af-empty-state">
          <Radio size={48} strokeWidth={1.5} />
          <p>请先登录网易云账号</p>
          <span>私人 FM 根据你的听歌偏好推荐</span>
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

  if (fmError) {
    return (
      <div className="af-fm-view">
        <div className="af-empty-state">
          <p>加载失败</p>
          <span>{fmError}</span>
          <button className="af-btn-primary" style={{ marginTop: 16 }} onClick={() => loadFm()}>
            重试
          </button>
        </div>
      </div>
    );
  }

  if (fmQueue.length === 0 || !current) {
    return (
      <div className="af-fm-view">
        <div className="af-empty-state">
          <Loader2 size={32} className="af-spin" />
          <p>正在为你挑选歌曲...</p>
        </div>
      </div>
    );
  }

  const isPlaying = status === 'playing';
  const upcoming = fmQueue.slice(fmIndex);

  const handleSkip = async () => {
    if (acting) return;
    setActing(true);
    try {
      const next = await fmNext();
      if (next) await play(next as MusicInfo);
    } finally {
      setActing(false);
    }
  };

  const handleDislike = async () => {
    if (acting || !current) return;
    setActing(true);
    try {
      await fmDislike(current);
      const next = await fmNext();
      if (next) await play(next as MusicInfo);
    } finally {
      setActing(false);
    }
  };

  const handlePlayPause = () => {
    if (isPlaying) pause();
    else resume();
  };

  return (
    <div className="af-fm-view">
      <div className="af-fm-header">
        <span className="af-page-kicker">Personal FM</span>
        <h1>私人 FM</h1>
        <p>{`正在为 ${account.nickname} 播放推荐曲目`}</p>
      </div>

      <div className="af-fm-stage">
        <div className="af-fm-cover">
          {current.img ? (
            <img src={current.img} alt={current.name} />
          ) : (
            <div className="af-cover-placeholder"><Music size={64} /></div>
          )}
        </div>

        <div className="af-fm-info">
          <h2 className="af-fm-track-title">{current.name}</h2>
          <p className="af-fm-track-artist">{current.singer}</p>
          {current.albumName && <p className="af-fm-track-album">{current.albumName}</p>}

          <div className="af-fm-actions">
            <button
              className="af-fm-action-secondary"
              onClick={handleDislike}
              disabled={acting}
              title="不感兴趣，从推荐中移除"
            >
              <ThumbsDown size={20} />
            </button>

            <SongAddMenuButton
              song={current}
              className="af-fm-action-secondary"
              iconSize={20}
              title="添加到我的喜欢或歌单"
            />

            <button
              className="af-fm-action-primary"
              onClick={handlePlayPause}
              title={isPlaying ? '暂停' : '播放'}
            >
              {isPlaying ? <Pause size={28} fill="currentColor" /> : <Play size={28} fill="currentColor" />}
            </button>

            <button
              className="af-fm-action-secondary"
              onClick={handleSkip}
              disabled={acting}
              title="下一首"
            >
              <SkipForward size={20} />
            </button>
          </div>
        </div>
      </div>

      {upcoming.length > 0 && (
        <div className="af-fm-upcoming">
          <h3>接下来</h3>
          <ul>
            {upcoming.slice(0, 5).map((track, idx) => (
              <li key={`${track.source}:${track.id}:${idx}`}>
                <span className="af-fm-upcoming-num">{idx + 1}</span>
                <span className="af-fm-upcoming-name">{track.name}</span>
                <span className="af-fm-upcoming-artist">{track.singer}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <style>{`
        .af-fm-view {
          padding: 32px 48px;
          max-width: 1200px;
          margin: 0 auto;
        }
        .af-fm-header {
          margin-bottom: 32px;
        }
        .af-fm-header h1 {
          font-size: 36px;
          font-weight: 700;
          margin: 8px 0;
          color: var(--af-text-primary);
        }
        .af-fm-header p {
          color: var(--af-text-secondary);
          font-size: 14px;
        }
        .af-fm-stage {
          display: flex;
          gap: 40px;
          align-items: center;
          padding: 32px;
          background: var(--af-bg-secondary);
          border-radius: var(--af-radius-xl);
          margin-bottom: 32px;
        }
        .af-fm-cover {
          width: 240px;
          height: 240px;
          border-radius: var(--af-radius-lg);
          overflow: hidden;
          background: var(--af-bg-hover);
          flex-shrink: 0;
          box-shadow: 0 12px 40px rgba(0,0,0,.25);
        }
        .af-fm-cover img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .af-fm-cover .af-cover-placeholder {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--af-text-tertiary);
        }
        .af-fm-info {
          flex: 1;
          min-width: 0;
        }
        .af-fm-track-title {
          font-size: 28px;
          font-weight: 700;
          color: var(--af-text-primary);
          margin-bottom: 8px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .af-fm-track-artist {
          font-size: 16px;
          color: var(--af-text-secondary);
          margin-bottom: 4px;
        }
        .af-fm-track-album {
          font-size: 14px;
          color: var(--af-text-tertiary);
          margin-bottom: 24px;
        }
        .af-fm-actions {
          display: flex;
          gap: 16px;
          align-items: center;
          margin-top: 28px;
        }
        .af-fm-action-secondary,
        .af-fm-action-primary {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: 1px solid transparent;
          cursor: pointer;
          transition: all var(--af-transition-fast);
        }
        .af-fm-action-secondary {
          width: 44px;
          height: 44px;
          border-radius: var(--af-button-radius);
          border-color: var(--af-border-primary);
          background: var(--af-bg-surface);
          color: var(--af-text-secondary);
        }
        .af-fm-action-primary {
          width: 64px;
          height: 64px;
          border-radius: 20px;
          border-color: rgba(var(--af-accent-primary-rgb), 0.42);
          background: linear-gradient(180deg, rgba(var(--af-accent-primary-rgb), 0.96), rgba(var(--af-accent-primary-rgb), 0.82));
          color: var(--af-text-on-accent);
          box-shadow: 0 10px 24px rgba(var(--af-accent-primary-rgb), 0.26);
        }
        .af-fm-action-secondary:hover:not(:disabled),
        .af-fm-action-primary:hover {
          transform: translateY(-1px);
        }
        .af-fm-action-secondary:hover:not(:disabled) {
          border-color: var(--af-border-primary);
          background: var(--af-bg-surface-hover);
          color: var(--af-text-primary);
        }
        .af-fm-action-primary:hover {
          background: var(--af-accent-gradient-hover);
          box-shadow: 0 12px 28px rgba(var(--af-accent-primary-rgb), 0.3);
        }
        .af-fm-action-secondary:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .af-fm-action-secondary.af-liked {
          color: var(--af-accent-primary);
          border-color: rgba(var(--af-accent-primary-rgb), 0.32);
          background: rgba(var(--af-accent-primary-rgb), 0.12);
        }
        .af-fm-upcoming h3 {
          font-size: 16px;
          font-weight: 600;
          color: var(--af-text-secondary);
          margin-bottom: 12px;
        }
        .af-fm-upcoming ul {
          list-style: none;
          padding: 0;
          margin: 0;
        }
        .af-fm-upcoming li {
          display: grid;
          grid-template-columns: 32px minmax(0,2fr) minmax(0,1fr);
          gap: 16px;
          padding: 8px 12px;
          border-radius: var(--af-radius-sm);
          color: var(--af-text-secondary);
          font-size: 13px;
        }
        .af-fm-upcoming li:hover {
          background: var(--af-bg-hover);
        }
        .af-fm-upcoming-num {
          color: var(--af-text-tertiary);
          font-variant-numeric: tabular-nums;
        }
        .af-fm-upcoming-name {
          color: var(--af-text-primary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .af-fm-upcoming-artist {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      `}</style>
    </div>
  );
}
