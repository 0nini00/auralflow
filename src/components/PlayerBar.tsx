import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlayerStore, RepeatMode } from '@/stores/playerStore';
import { useSleepTimerStore } from '@/stores/sleepTimerStore';
import { SongAddMenuButton } from '@/components/SongAddMenuButton';
import { listen } from '@tauri-apps/api/event';
import { subscribeLyricSettings } from '@/stores/lyricSettingsSync';
import { toggleDesktopLyricFromPlayer } from '@/utils/desktopLyricToggle';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Repeat,
  Repeat1,
  Shuffle,
  Mic2,
  Timer,
} from 'lucide-react';
import { getLyricWindowState, isLyricWindowOpen } from '@lx/tauri-bridge';

export const PlayerBar: React.FC = () => {
  const navigate = useNavigate();

  const {
    current: currentTrack,
    status,
    progress: currentTime,
    duration,
    volume,
    isMuted,
    repeatMode,
    isShuffle: isShuffleOn,
    togglePlay,
    toggleMute: storeToggleMute,
    setVolume,
    next,
    prev: previous,
    setRepeatMode,
    toggleShuffle,
    setProgress,
  } = usePlayerStore();

  const sleepMode = useSleepTimerStore((s) => s.mode);
  const sleepRemainingSec = useSleepTimerStore((s) => s.remainingSec);
  const sleepRemainingSongs = useSleepTimerStore((s) => s.remainingSongs);
  const startTimer = useSleepTimerStore((s) => s.startTimer);
  const startSongs = useSleepTimerStore((s) => s.startSongs);
  const cancelSleep = useSleepTimerStore((s) => s.cancel);
  const [sleepMenuOpen, setSleepMenuOpen] = useState(false);
  const [lyricOpen, setLyricOpen] = useState(false);
  const [lyricLocked, setLyricLocked] = useState(false);

  useEffect(() => {
    void isLyricWindowOpen().then(setLyricOpen).catch(() => {});
    void getLyricWindowState().then((state) => setLyricLocked(state.locked)).catch(() => {});
    const unlistenPromise = listen<{ open: boolean }>('lyric-window-open-changed', (event) => {
      setLyricOpen(event.payload.open);
    });
    const unsubscribeLyricSettings = subscribeLyricSettings((patch) => {
      if (typeof patch.lyricLocked === 'boolean') {
        setLyricLocked(patch.lyricLocked);
      }
    });
    return () => {
      void unlistenPromise.then((unlisten) => unlisten()).catch(() => {});
      unsubscribeLyricSettings();
    };
  }, []);

  const sleepLabel = sleepMode === 'timer'
    ? `${Math.ceil(sleepRemainingSec / 60)} 分钟后关闭`
    : sleepMode === 'songs'
      ? `${sleepRemainingSongs} 首后关闭`
      : '定时关闭';

  const isPlaying = status === 'playing';

  const handleTrackPlay = () => {
    togglePlay();
  };

  const handleRepeatToggle = () => {
    const modes: RepeatMode[] = ['off', 'all', 'one'];
    const currentIndex = modes.indexOf(repeatMode);
    const nextMode = modes[(currentIndex + 1) % modes.length];
    setRepeatMode(nextMode);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    setProgress(time);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
  };

  const handleLyricToggle = async () => {
    try {
      const result = await toggleDesktopLyricFromPlayer(undefined, {
        knownOpen: lyricOpen,
        knownLocked: lyricLocked,
      });
      setLyricOpen(result.open);
      setLyricLocked(result.locked);
      window.setTimeout(() => {
        void isLyricWindowOpen().then(setLyricOpen).catch(() => {});
      }, 120);
    } catch (error) {
      console.error('[desktop lyric] toggle failed', error);
      setLyricOpen(false);
    }
  };

  const formatTime = (time: number) => {
    if (isNaN(time) || !time) return '0:00';
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  if (!currentTrack) return null;

  const lyricButtonLabel = lyricOpen
    ? lyricLocked
      ? '解锁桌面歌词'
      : '关闭桌面歌词'
    : '打开桌面歌词';

  return (
    <div className="af-player-bar">
      <div className="af-player-container">
        <div className="af-player-grid">
          <div className="af-player-track-info">
            <div
              className="af-track-cover-wrapper"
              onClick={() => navigate('/player')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') navigate('/player');
              }}
              role="button"
              tabIndex={0}
              aria-label="进入全屏播放"
            >
              {currentTrack.img || currentTrack.picUrl ? (
                <img
                  src={currentTrack.img || currentTrack.picUrl}
                  alt={currentTrack.name}
                  className="af-track-cover"
                />
              ) : (
                <div className="af-track-cover-placeholder">
                  <svg width="24" height="24" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M18 3a1 1 0 00-1.196-.98l-10 2A1 1 0 006 5v9.114A4.369 4.369 0 005 14c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V7.82l8-1.6v5.894A4.37 4.37 0 0015 12c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V3z" />
                  </svg>
                </div>
              )}
            </div>
            <div className="af-track-details">
              <div className="af-track-name">{currentTrack.name}</div>
              <div className="af-track-artist">{currentTrack.singer}</div>
            </div>
            <SongAddMenuButton
              song={currentTrack}
              className="af-like-button"
              iconSize={18}
              title="添加到我的喜欢或歌单"
            />
            <button
              onClick={() => { void handleLyricToggle(); }}
              className={`af-like-button ${lyricOpen ? 'af-active' : ''}`}
              aria-label={lyricButtonLabel}
              title={lyricButtonLabel}
            >
              <Mic2 size={18} />
            </button>
            <div className="af-sleep-timer-wrapper">
              <button
                onClick={() => setSleepMenuOpen((v) => !v)}
                className={`af-like-button ${sleepMode !== 'off' ? 'af-active' : ''}`}
                aria-label={sleepLabel}
                title={sleepLabel}
              >
                <Timer size={18} />
              </button>
              {sleepMenuOpen && (
                <>
                  <div
                    className="af-sleep-backdrop"
                    onClick={() => setSleepMenuOpen(false)}
                    aria-hidden="true"
                  />
                  <div className="af-sleep-menu" role="menu">
                  <div className="af-sleep-menu-title">{sleepLabel}</div>
                  {[15, 30, 45, 60].map((m) => (
                    <button
                      key={m}
                      className="af-sleep-menu-item"
                      onClick={() => { startTimer(m); setSleepMenuOpen(false); }}
                    >
                      {m} 分钟后关闭
                    </button>
                  ))}
                  <button
                    className="af-sleep-menu-item"
                    onClick={() => { startSongs(1); setSleepMenuOpen(false); }}
                  >
                    播完当前歌曲
                  </button>
                  <button
                    className="af-sleep-menu-item"
                    onClick={() => { startSongs(10); setSleepMenuOpen(false); }}
                  >
                    10 首后关闭
                  </button>
                  {sleepMode !== 'off' && (
                    <button
                      className="af-sleep-menu-item af-sleep-menu-cancel"
                      onClick={() => { cancelSleep(); setSleepMenuOpen(false); }}
                    >
                      取消定时
                    </button>
                  )}
                </div>
                </>
              )}
            </div>
          </div>

          <div className="af-player-controls">
            <div className="af-control-buttons">
              <button
                onClick={toggleShuffle}
                className={`af-control-btn ${isShuffleOn ? 'af-active' : ''}`}
                aria-label="随机播放"
              >
                <Shuffle size={16} />
              </button>

              <button
                onClick={previous}
                className="af-control-btn"
                aria-label="上一首"
              >
                <SkipBack size={18} fill="currentColor" />
              </button>

              <button
                onClick={handleTrackPlay}
                className="af-play-button"
                aria-label={isPlaying ? '暂停' : '播放'}
              >
                {isPlaying ? (
                  <Pause size={20} fill="currentColor" />
                ) : (
                  <Play size={20} fill="currentColor" />
                )}
              </button>

              <button
                onClick={next}
                className="af-control-btn"
                aria-label="下一首"
              >
                <SkipForward size={18} fill="currentColor" />
              </button>

              <button
                onClick={handleRepeatToggle}
                className={`af-control-btn ${repeatMode !== 'off' ? 'af-active' : ''}`}
                aria-label="循环播放"
              >
                {repeatMode === 'one' ? <Repeat1 size={16} /> : <Repeat size={16} />}
              </button>
            </div>

            <div className="af-progress-bar">
              <span className="af-time">{formatTime(currentTime)}</span>
              <div className="af-progress-track">
                <div
                  className="af-progress-fill"
                  style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }}
                />
                <input
                  type="range"
                  min="0"
                  max={duration || 0}
                  value={currentTime || 0}
                  onChange={handleSeek}
                  className="af-progress-input"
                  aria-label="进度"
                />
              </div>
              <span className="af-time">{formatTime(duration)}</span>
            </div>
          </div>

          <div className="af-player-volume">
            <button
              onClick={storeToggleMute}
              className="af-control-btn"
              aria-label={isMuted ? '取消静音' : '静音'}
            >
              {isMuted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </button>
            <div className="af-volume-track">
              <div
                className="af-volume-fill"
                style={{ width: `${volume * 100}%` }}
              />
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={volume}
                onChange={handleVolumeChange}
                className="af-volume-input"
                aria-label="音量"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
