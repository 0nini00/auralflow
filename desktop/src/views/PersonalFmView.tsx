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
  const fmMode = usePlayerStore((s) => s.fmMode);
  const enterFmMode = usePlayerStore((s) => s.enterFmMode);

  const [acting, setActing] = useState(false);
  const autoStartPending = useRef(false);

  /** 拉下一首并播放；解析失败则继续跳，避免卡死链 */
  const playFmTrackWithFallback = async (first?: MusicInfo | null) => {
    let track: MusicInfo | null | undefined = first;
    for (let attempt = 0; attempt < 5; attempt++) {
      if (!track) {
        track = await fmNext();
      }
      if (!track) return false;
      await play(track);
      const st = usePlayerStore.getState();
      const failed =
        st.status === 'error' &&
        st.current != null &&
        st.current.source === track.source &&
        st.current.id === track.id;
      if (!failed) return true;
      track = null;
    }
    return false;
  };


  const currentIsFmTrack = Boolean(
    current && fmQueue.some((track) => track.source === current.source && track.id === current.id),
  );
  const hasExternalCurrent = Boolean(current && !currentIsFmTrack);

  // 进入页面只准备推荐队列，不打断当前正在播放的普通歌曲。
  useEffect(() => {
    if (!account) return;
    if (fmQueue.length === 0 && !fmLoading) {
      void loadFm();
    }
  }, [account, fmLoading, fmQueue.length, loadFm]);

  // 如果当前已经是 FM 队列里的歌，只 soft 挂上 FM 模式，不要 stop 打断播放。
  useEffect(() => {
    if (account && currentIsFmTrack && !fmMode) {
      enterFmMode({ soft: true });
    }
  }, [account, currentIsFmTrack, enterFmMode, fmMode]);

  // 没有当前播放时才自动起播；已有普通歌曲播放时等待用户显式开始。
  useEffect(() => {
    if (!account || current || fmQueue.length === 0 || autoStartPending.current) return;

    autoStartPending.current = true;
    void (async () => {
      try {
        enterFmMode();
        await playFmTrackWithFallback();
      } finally {
        autoStartPending.current = false;
      }
    })();
  }, [account, current, enterFmMode, fmQueue.length]);

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
          <button className="af-btn-primary" style={{ marginTop: 16 }} onClick={() => loadFm(true)}>
            重试
          </button>
        </div>
      </div>
    );
  }

  const handleStartFm = async () => {
    if (acting || fmQueue.length === 0) return;
    setActing(true);
    try {
      enterFmMode();
      await playFmTrackWithFallback();
    } finally {
      setActing(false);
    }
  };

  if (hasExternalCurrent && fmQueue.length > 0) {
    return (
      <div className="af-fm-view">
        <div className="af-empty-state">
          <Radio size={48} strokeWidth={1.5} />
          <p>私人 FM 已准备好</p>
          <span>开始后会切换到推荐播放</span>
          <button
            className="af-btn-primary"
            style={{ marginTop: 16 }}
            onClick={handleStartFm}
            disabled={acting}
          >
            开始私人 FM
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
      if (!fmMode) enterFmMode({ soft: currentIsFmTrack });
      await playFmTrackWithFallback();
    } finally {
      setActing(false);
    }
  };

  const handleDislike = async () => {
    if (acting || !current) return;
    setActing(true);
    try {
      await fmDislike(current);
      if (!fmMode) enterFmMode({ soft: true });
      await playFmTrackWithFallback();
    } finally {
      setActing(false);
    }
  };

  const handlePlayPause = () => {
    if (isPlaying) {
      pause();
      return;
    }
    // error / idle：resume 拉不起来时重新 play 当前曲
    if (status === 'paused') {
      resume();
      return;
    }
    if (current) {
      void play(current);
    }
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
          border-color: var(--af-button-secondary-border);
          background: var(--af-button-secondary-bg);
          color: var(--af-text-secondary);
        }
        .af-fm-action-primary {
          width: 64px;
          height: 64px;
          border-radius: 20px;
          border-color: var(--af-button-secondary-border);
          background: var(--af-button-secondary-bg);
          color: var(--af-text-primary);
          box-shadow: var(--af-button-secondary-shadow);
        }
        .af-fm-action-secondary:hover:not(:disabled),
        .af-fm-action-primary:hover {
          transform: translateY(-1px);
        }
        .af-fm-action-secondary:hover:not(:disabled) {
          border-color: var(--af-button-secondary-hover-border);
          background: var(--af-button-secondary-hover-bg);
          color: var(--af-text-primary);
        }
        .af-fm-action-primary:hover {
          border-color: var(--af-button-secondary-hover-border);
          background: var(--af-button-secondary-hover-bg);
        }
        .af-fm-action-secondary:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .af-fm-action-secondary.af-liked {
          color: var(--af-accent-primary);
          border-color: var(--af-button-active-border);
          background: var(--af-button-active-bg);
          box-shadow: var(--af-button-active-shadow);
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
