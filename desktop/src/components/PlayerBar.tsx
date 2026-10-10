import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePlayerStore } from '@/stores/playerStore';
import { useInterpolatedPlaybackProgress } from '@/hooks/useInterpolatedPlaybackProgress';
import { useSleepTimerStore } from '@/stores/sleepTimerStore';
import { ImmersiveLyricsOverlay } from '@/components/ImmersiveLyricsOverlay';
import { SongAddMenuButton } from '@/components/SongAddMenuButton';
import { BAR_QUEUE_CLASSES, QueuePanel, type QueuePanelProps } from '@/components/QueuePanel';
import { listen } from '@tauri-apps/api/event';
import { subscribeLyricSettings } from '@/stores/lyricSettingsSync';
import { toggleDesktopLyricFromPlayer } from '@/utils/desktopLyricToggle';
import { getNextPlayMode, getPlayModeControl } from '@/services/playback/playModeControl';
import { PLAYER_COVER_CSS_SIZE, coverSrc } from '@/utils/imageReferrerPolicy';
import { formatTime } from '@/utils/formatTime';
import {
  Play,
  Pause,
  Loader2,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Repeat,
  Repeat1,
  Shuffle,
  ListMusic,
  Timer,
} from 'lucide-react';
import { getLyricWindowState, isLyricWindowOpen } from '@lx/tauri-bridge';
import { useArtworkAmbience } from '@/hooks/useArtworkAmbience';

const BAR_QUEUE_PANEL_ID = 'af-bar-queue-panel';
/** 定位用的宽度，与 .af-bar-queue-panel 的 width 保持一致（窄窗口由 CSS 的 calc 兜底） */
const BAR_QUEUE_PANEL_WIDTH = 340;

/**
 * 迷你栏贴窗口底部，弹层只能朝上开：bottom 取触发按钮上沿到窗口底部的距离，
 * 横向贴按钮右缘并夹在窗口内，窄窗口下也不出界。
 */
function getQueuePanelPosition(anchor: HTMLElement) {
  const rect = anchor.getBoundingClientRect();
  const left = Math.max(8, Math.min(rect.right - BAR_QUEUE_PANEL_WIDTH, window.innerWidth - BAR_QUEUE_PANEL_WIDTH - 8));
  const bottom = Math.max(8, window.innerHeight - rect.top + 10);
  return { left, bottom };
}

type PlayerBarQueueMenuProps = Pick<QueuePanelProps, 'tracks' | 'currentIndex' | 'play' | 'remove'> & {
  /** 触发按钮：弹层按它的位置定位，关闭后焦点交还给它 */
  anchor: HTMLElement;
  onClose: () => void;
};

/**
 * 迷你栏的播放列表弹层：portal 到 body，免得被迷你栏自身的 z-index / overflow 裁掉。
 * 沿用与 SongAddMenu 相同的弹层约定：backdrop 点击或 Escape 关闭并归还焦点。
 */
function PlayerBarQueueMenu({ tracks, currentIndex, play, remove, anchor, onClose }: PlayerBarQueueMenuProps) {
  const [position] = useState(() => getQueuePanelPosition(anchor));
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    // 先声明归属再加监听：portal 里的面板也能被触发按钮的 aria-controls 关联到
    const previousControls = anchor.getAttribute('aria-controls');
    anchor.setAttribute('aria-controls', previousControls ? `${previousControls} ${BAR_QUEUE_PANEL_ID}` : BAR_QUEUE_PANEL_ID);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      onCloseRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (previousControls === null) anchor.removeAttribute('aria-controls');
      else anchor.setAttribute('aria-controls', previousControls);
    };
  }, [anchor]);

  return createPortal(
    <>
      <div className="af-bar-queue-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="af-bar-queue-layer" style={{ bottom: position.bottom, left: position.left }}>
        <QueuePanel id={BAR_QUEUE_PANEL_ID} tracks={tracks} currentIndex={currentIndex} play={play} remove={remove}
          classes={BAR_QUEUE_CLASSES} onClose={onClose} />
      </div>
    </>,
    document.body,
  );
}

export const PlayerBar: React.FC = () => {
  const {
    current: currentTrack,
    status,
    progress: storeProgress,
    progressSampledAt,
    duration,
    volume,
    isMuted,
    playbackRate,
    repeatMode,
    isShuffle,
    togglePlay,
    toggleMute: storeToggleMute,
    setVolume,
    next,
    prev: previous,
    setPlayMode,
    setProgress,
  } = usePlayerStore();

  // 队列逐字段订阅：迷你栏只在意队列本身，避免整表订阅被每帧进度推送带着重渲染
  const queueTracks = usePlayerStore((s) => s.queue);
  const queueIndex = usePlayerStore((s) => s.currentIndex);
  const playByIndex = usePlayerStore((s) => s.playByIndex);
  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue);

  // 与沉浸式一致：播放中用插值进度，进度条更顺滑
  const interpolatedProgress = useInterpolatedPlaybackProgress({
    status,
    progress: storeProgress,
    progressSampledAt,
    duration,
    playbackRate,
  });
  const isPlaying = status === 'playing';
  const currentTime = isPlaying ? interpolatedProgress : storeProgress;

  const sleepMode = useSleepTimerStore((s) => s.mode);
  const sleepRemainingSec = useSleepTimerStore((s) => s.remainingSec);
  const sleepRemainingSongs = useSleepTimerStore((s) => s.remainingSongs);
  const startTimer = useSleepTimerStore((s) => s.startTimer);
  const startSongs = useSleepTimerStore((s) => s.startSongs);
  const cancelSleep = useSleepTimerStore((s) => s.cancel);
  const [sleepMenuOpen, setSleepMenuOpen] = useState(false);
  const [lyricOpen, setLyricOpen] = useState(false);
  const [lyricLocked, setLyricLocked] = useState(false);
  const [immersiveLyricsOpen, setImmersiveLyricsOpen] = useState(false);
  const [queueMenuAnchor, setQueueMenuAnchor] = useState<HTMLElement | null>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubProgress, setScrubProgress] = useState(0);
  const scrub = useRef<{ trackKey: string; value: number; changed: boolean } | null>(null);
  const trackKey = currentTrack ? `${currentTrack.source}:${currentTrack.id}` : '';
  useEffect(() => {
    // 保留旧手势身份直到抬起/取消，不能把仍在移动的指针当成新歌键盘seek。
    setIsScrubbing(false);
  }, [trackKey]);
  // 拖动期间用本地值显示，避免 rAF 进度回写顶回去导致拖不动
  const displayTime = isScrubbing ? scrubProgress : currentTime;

  useEffect(() => {
    void isLyricWindowOpen().then(setLyricOpen).catch(() => undefined);
    void getLyricWindowState()
      .then((state) => setLyricLocked(state.locked))
      .catch(() => undefined);
    const unlistenPromise = listen<{ open: boolean }>('lyric-window-open-changed', (event) => {
      setLyricOpen(event.payload.open);
    });
    const unsubscribeLyricSettings = subscribeLyricSettings((patch) => {
      if (typeof patch.lyricLocked === 'boolean') {
        setLyricLocked(patch.lyricLocked);
      }
    });
    return () => {
      void unlistenPromise.then((unlisten) => unlisten()).catch(() => undefined);
      unsubscribeLyricSettings();
    };
  }, []);

  const sleepLabel = sleepMode === 'timer'
    ? `${Math.ceil(sleepRemainingSec / 60)} 分钟后关闭`
    : sleepMode === 'songs'
      ? `${sleepRemainingSongs} 首后关闭`
      : '定时关闭';

    const playModeControl = getPlayModeControl({ repeatMode, isShuffle });

  const handleTrackPlay = () => {
    togglePlay();
  };

  const handlePlayModeToggle = () => {
    setPlayMode(getNextPlayMode(playModeControl.id));
  };

  const handleQueueToggle = (event: React.MouseEvent<HTMLButtonElement>) => {
    // currentTarget 在事件派发结束后会被置空，先取出再进 updater
    const trigger = event.currentTarget;
    setQueueMenuAnchor((current) => (current ? null : trigger));
  };

  const closeQueueMenu = () => {
    // 关闭后把焦点还给触发按钮，键盘用户不会掉到文档末尾；节点可能已卸载，fail-soft 不抛错
    queueMenuAnchor?.focus?.();
    setQueueMenuAnchor(null);
  };

  const handleScrubStart = () => {
    scrub.current = { trackKey, value: currentTime, changed: false };
    setScrubProgress(currentTime);
    setIsScrubbing(true);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = Number(e.target.value);
    if (!Number.isFinite(time)) return;
    if (scrub.current) {
      if (scrub.current.trackKey !== trackKey) return;
      scrub.current.value = time;
      scrub.current.changed = true;
      setScrubProgress(time);
      return;
    }
    setProgress(time);
  };

  const cancelScrub = () => {
    scrub.current = null;
    setIsScrubbing(false);
  };

  const handleScrubEnd = () => {
    const draft = scrub.current;
    cancelScrub();
    if (draft?.changed && draft.trackKey === trackKey) setProgress(draft.value);
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
        void isLyricWindowOpen().then(setLyricOpen).catch(() => undefined);
      }, 120);
    } catch (error) {
      setLyricOpen(false);
    }
  };

  // 必须在 early return 之前调用（hooks 规则）；无当前歌曲时它会清掉氛围变量。
  useArtworkAmbience();

  if (!currentTrack) return null;

  const coverUrl = coverSrc(currentTrack.img || currentTrack.picUrl || '', PLAYER_COVER_CSS_SIZE);
  const lyricButtonLabel = lyricOpen
    ? lyricLocked
      ? '解锁桌面歌词'
      : '关闭桌面歌词'
    : '打开桌面歌词';

  return (
    <>
      <div className="af-player-bar">
        <div className="af-player-container">
          <div className="af-progress-bar">
            <span className="af-time">{formatTime(displayTime)}</span>
            <div className="af-progress-track">
              <div
                className="af-progress-fill"
                style={{ width: `${duration ? (displayTime / duration) * 100 : 0}%` }}
              />
              <input
                type="range"
                min="0"
                max={duration || 0}
                value={displayTime || 0}
                onChange={handleSeek}
                onPointerDown={handleScrubStart}
                onPointerUp={handleScrubEnd}
                onPointerCancel={cancelScrub}
                onBlur={cancelScrub}
                className="af-progress-input"
                aria-label="进度"
              />
            </div>
            <span className="af-time">{formatTime(duration)}</span>
          </div>

          <div className="af-player-grid">
          <div className="af-player-track-info">
            <div
              className="af-track-cover-wrapper"
              onClick={() => setImmersiveLyricsOpen(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') setImmersiveLyricsOpen(true);
              }}
              role="button"
              tabIndex={0}
              aria-label="打开整页歌词播放"
            >
              {coverUrl ? (
                <img
                  src={coverUrl}
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
              data-tooltip={lyricButtonLabel}
            >
              <span>词</span>
            </button>
            <div className="af-sleep-timer-wrapper">
              <button
                onClick={() => setSleepMenuOpen((v) => !v)}
                className={`af-like-button ${sleepMode !== 'off' ? 'af-active' : ''}`}
                aria-label={sleepLabel}
                data-tooltip={sleepLabel}
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
                onClick={handlePlayModeToggle}
                className={`af-control-btn ${playModeControl.id !== 'sequence' ? 'af-active' : ''}`}
                aria-label={`播放模式：${playModeControl.label}`}
                data-tooltip={playModeControl.label}
              >
                {playModeControl.id === 'shuffle' ? (
                  <Shuffle size={16} />
                ) : playModeControl.id === 'single-loop' ? (
                  <Repeat1 size={16} />
                ) : (
                  <Repeat size={16} />
                )}
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
                {status === "loading" ? (
                  <Loader2 size={20} className="af-spin" />
                ) : isPlaying ? (
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
                onClick={handleQueueToggle}
                className={`af-control-btn ${queueMenuAnchor ? 'af-active' : ''}`}
                aria-label="播放列表"
                data-tooltip="播放列表"
                aria-haspopup="dialog"
                aria-expanded={queueMenuAnchor != null}
              >
                <ListMusic size={18} />
              </button>
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
      {queueMenuAnchor && (
        <PlayerBarQueueMenu
          tracks={queueTracks}
          currentIndex={queueIndex}
          play={playByIndex}
          remove={removeFromQueue}
          anchor={queueMenuAnchor}
          onClose={closeQueueMenu}
        />
      )}
      <ImmersiveLyricsOverlay
        open={immersiveLyricsOpen}
        onClose={() => setImmersiveLyricsOpen(false)}
      />
    </>
  );
};
