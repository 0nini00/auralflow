import { useEffect, useRef, useState, type CSSProperties, type ChangeEvent } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  Eye,
  EyeOff,
  Gauge,
  ListMusic,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Share2,
  Shuffle,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { PlayerVisualizerRenderer } from '@/components/playerVisualizers/PlayerVisualizerRenderer';
import { SongAddMenuButton } from '@/components/SongAddMenuButton';
import { SoundEffectPanel } from '@/components/SoundEffectPanel';
import { useInterpolatedPlaybackProgress } from '@/hooks/useInterpolatedPlaybackProgress';
import { useLyrics } from '@/hooks/useLyrics';
import { getNextPlayMode, getPlayModeControl } from '@/services/playback/playModeControl';
import { useSoundEffectStore } from '@/stores/soundEffectStore';
import { broadcastLyricSettings, subscribeLyricSettings } from '@/stores/lyricSettingsSync';
import { usePlayerStore } from '@/stores/playerStore';
import { logAsyncError } from '@/utils/logAsyncError';
import { buildMusicShareText } from '@/utils/shareLink';
import { toggleDesktopLyricFromPlayer } from '@/utils/desktopLyricToggle';
import { getImageReferrerPolicy, normalizeImageUrl } from '@/utils/imageReferrerPolicy';
import { getLyricWindowState, isLyricWindowOpen, loadSettings, patchSettings } from '@lx/tauri-bridge';
import { listen } from '@tauri-apps/api/event';

interface ImmersiveLyricsOverlayProps {
  open: boolean;
  onClose: () => void;
  defaultControlsHidden?: boolean;
}

const DEFAULT_IMMERSIVE_LYRIC_FONT_SIZE = 36;
const DEFAULT_IMMERSIVE_LYRIC_FONT_FAMILY =
  '"Inter", "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif';

function formatTime(time: number): string {
  if (!Number.isFinite(time) || time <= 0) return '0:00';
  const minutes = Math.floor(time / 60);
  const seconds = Math.floor(time % 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function buildCssUrl(url: string): string {
  return `url(${JSON.stringify(url)})`;
}

export function ImmersiveLyricsOverlay({
  open,
  onClose,
  defaultControlsHidden = false,
}: ImmersiveLyricsOverlayProps) {
  const {
    current: currentTrack,
    queue,
    currentIndex,
    status,
    progress,
    duration,
    volume,
    isMuted,
    playbackRate,
    repeatMode,
    isShuffle,
    togglePlay,
    toggleMute,
    setVolume,
    setProgress,
    setPlaybackRate,
    setPlayMode,
    playByIndex,
    prev,
    next,
  } = usePlayerStore();

  const [showTranslation, setShowTranslation] = useState(true);
  const [immersiveLyricFontSize, setImmersiveLyricFontSize] = useState(DEFAULT_IMMERSIVE_LYRIC_FONT_SIZE);
  const [immersiveLyricFontFamily, setImmersiveLyricFontFamily] = useState(DEFAULT_IMMERSIVE_LYRIC_FONT_FAMILY);
  const [fullscreenError, setFullscreenError] = useState('');
  const [shareStatus, setShareStatus] = useState('');
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showSoundEffectPanel, setShowSoundEffectPanel] = useState(false);
  const [showQueuePanel, setShowQueuePanel] = useState(false);
  const [desktopLyricOpen, setDesktopLyricOpen] = useState(false);
  const [desktopLyricLocked, setDesktopLyricLocked] = useState(false);
  const [isNativeFullscreen, setIsNativeFullscreen] = useState(false);
  const [hidePlayerControls, setHidePlayerControls] = useState(false);
  const fullscreenEnteredRef = useRef(false);
  const isPlaying = status === 'playing';
  const soundEffectActive = useSoundEffectStore((state) => state.enabled || state.pitch !== 0);
  const coverUrl = normalizeImageUrl(currentTrack?.img || currentTrack?.picUrl || '');
  const coverReferrerPolicy = getImageReferrerPolicy(coverUrl);
  const playModeControl = getPlayModeControl({ repeatMode, isShuffle });
  const lyricProgress = useInterpolatedPlaybackProgress({ status, progress, duration, playbackRate });
  const { lyrics, currentLine: currentLyricIndex } = useLyrics(currentTrack, lyricProgress);

  useEffect(() => {
    if (!open) return;

    const appWindow = getCurrentWindow();
    setFullscreenError('');
    setHidePlayerControls(defaultControlsHidden);

    void appWindow
      .isFullscreen()
      .then(setIsNativeFullscreen)
      .catch(logAsyncError('immersive-lyrics:query-fullscreen'));

    return () => {
      if (fullscreenEnteredRef.current) {
        fullscreenEnteredRef.current = false;
        void appWindow
          .setFullscreen(false)
          .then(() => {
            setIsNativeFullscreen(false);
          })
          .catch(logAsyncError('immersive-lyrics:exit-fullscreen'));
      }
    };
  }, [defaultControlsHidden, open]);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, open]);

  useEffect(() => {
    if (!open) return;

    void loadSettings()
      .then((settings) => {
        setShowTranslation(settings.lyricShowTranslation !== false);
        setImmersiveLyricFontSize(settings.immersiveLyricFontSize || DEFAULT_IMMERSIVE_LYRIC_FONT_SIZE);
        setImmersiveLyricFontFamily(settings.immersiveLyricFontFamily || DEFAULT_IMMERSIVE_LYRIC_FONT_FAMILY);
      })
      .catch(logAsyncError('immersive-lyrics:load-settings'));
    void isLyricWindowOpen().then(setDesktopLyricOpen).catch(logAsyncError('immersive-lyrics:query-lyric-open'));
    void getLyricWindowState()
      .then((state) => setDesktopLyricLocked(state.locked))
      .catch(logAsyncError('immersive-lyrics:query-lyric-state'));
    const unlistenPromise = listen<{ open: boolean }>('lyric-window-open-changed', (event) => {
      setDesktopLyricOpen(event.payload.open);
    });

    const unsubscribe = subscribeLyricSettings((patch) => {
      if (typeof patch.lyricLocked === 'boolean') {
        setDesktopLyricLocked(patch.lyricLocked);
      }
      if (typeof patch.lyricShowTranslation === 'boolean') {
        setShowTranslation(patch.lyricShowTranslation);
      }
      if (typeof patch.immersiveLyricFontSize === 'number') {
        setImmersiveLyricFontSize(patch.immersiveLyricFontSize);
      }
      if (typeof patch.immersiveLyricFontFamily === 'string') {
        setImmersiveLyricFontFamily(patch.immersiveLyricFontFamily);
      }
    });
    return () => {
      void unlistenPromise.then((unlisten) => unlisten()).catch(logAsyncError('immersive-lyrics:unlisten-lyric-window'));
      unsubscribe();
    };
  }, [open]);

  const handleSeek = (event: ChangeEvent<HTMLInputElement>) => {
    const nextProgress = parseFloat(event.target.value);
    setProgress(nextProgress);
  };

  const handleVolumeChange = (event: ChangeEvent<HTMLInputElement>) => {
    setVolume(parseFloat(event.target.value));
  };

  const handlePlayModeToggle = () => {
    closeControlPopovers();
    setPlayMode(getNextPlayMode(playModeControl.id));
  };

  const handleTranslationToggle = () => {
    closeControlPopovers();
    const nextShowTranslation = !showTranslation;
    setShowTranslation(nextShowTranslation);
    broadcastLyricSettings({ lyricShowTranslation: nextShowTranslation });
    patchSettings({ lyricShowTranslation: nextShowTranslation }).catch((error) => {
      setShowTranslation(!nextShowTranslation);
      broadcastLyricSettings({ lyricShowTranslation: !nextShowTranslation });
      setFullscreenError(`译文设置失败：${error instanceof Error ? error.message : String(error)}`);
    });
  };

  const closeControlPopovers = () => {
    setShowSpeedMenu(false);
    setShowSoundEffectPanel(false);
    setShowQueuePanel(false);
  };

  const handleSpeedChange = (rate: number) => {
    setPlaybackRate(rate);
    setShowSpeedMenu(false);
  };

  const handleSoundEffectToggle = () => {
    setShowSpeedMenu(false);
    setShowQueuePanel(false);
    setShowSoundEffectPanel((open) => !open);
  };

  const handleQueueToggle = () => {
    setShowSpeedMenu(false);
    setShowSoundEffectPanel(false);
    setShowQueuePanel((open) => !open);
  };

  const handleDesktopLyricToggle = () => {
    closeControlPopovers();
    void toggleDesktopLyricFromPlayer(undefined, {
      knownOpen: desktopLyricOpen,
      knownLocked: desktopLyricLocked,
    })
      .then((result) => {
        setDesktopLyricOpen(result.open);
        setDesktopLyricLocked(result.locked);
        window.setTimeout(() => {
          void isLyricWindowOpen().then(setDesktopLyricOpen).catch(logAsyncError('immersive-lyrics:refresh-lyric-open'));
        }, 120);
      })
      .catch((error) => {
        console.error('[desktop lyric] toggle failed', error);
        setFullscreenError(`桌面歌词失败：${error instanceof Error ? error.message : String(error)}`);
      });
  };

  const handleFullscreenToggle = async () => {
    closeControlPopovers();
    setFullscreenError('');
    const appWindow = getCurrentWindow();

    try {
      const currentlyFullscreen = await appWindow.isFullscreen();
      await appWindow.setFullscreen(!currentlyFullscreen);
      fullscreenEnteredRef.current = !currentlyFullscreen;
      setIsNativeFullscreen(!currentlyFullscreen);
    } catch (error) {
      setFullscreenError(`全屏请求失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleHidePlayerControls = () => {
    closeControlPopovers();
    setHidePlayerControls(true);
  };

  const handleShowPlayerControls = () => {
    setHidePlayerControls(false);
  };

  const handleShare = async () => {
    if (!currentTrack) return;
    closeControlPopovers();
    try {
      await navigator.clipboard.writeText(buildMusicShareText(currentTrack));
      setShareStatus('已复制');
      window.setTimeout(() => setShareStatus(''), 1600);
    } catch {
      setShareStatus('复制失败');
      window.setTimeout(() => setShareStatus(''), 1600);
    }
  };

  const handleQueueItemPlay = (index: number) => {
    playByIndex(index);
    setShowQueuePanel(false);
  };

  if (!open) return null;

  const displayProgress = isPlaying ? lyricProgress : progress;
  const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (displayProgress / duration) * 100)) : 0;
  const volumePercent = Math.min(100, Math.max(0, volume * 100));
  const controlsHidden = hidePlayerControls;
  const desktopLyricButtonLabel = desktopLyricOpen
    ? desktopLyricLocked
      ? '解锁桌面歌词'
      : '关闭桌面歌词'
    : '打开桌面歌词';

  return (
    <div
      className={[
        'af-immersive-lyrics',
        'af-immersive-visualizer-poster',
        isNativeFullscreen ? 'af-immersive-native-fullscreen' : '',
        controlsHidden ? 'af-immersive-controls-hidden' : '',
      ].filter(Boolean).join(' ')}
      role="dialog"
      aria-modal="true"
      aria-label="沉浸式歌词"
      style={{
        '--af-immersive-progress': `${progressPercent}%`,
        '--af-immersive-volume': `${volumePercent}%`,
        '--af-immersive-lyric-font-family': immersiveLyricFontFamily,
        '--af-immersive-lyric-font-size': `${immersiveLyricFontSize}px`,
        '--af-immersive-lyric-secondary-font-size': `${Math.max(14, Math.round(immersiveLyricFontSize * 0.48))}px`,
      } as CSSProperties}
    >
      {coverUrl && (
        <div
          className="af-immersive-cover-glow"
          style={{ backgroundImage: buildCssUrl(coverUrl) }}
          aria-hidden="true"
        />
      )}
      <div className="af-immersive-noise" aria-hidden="true" />

      <button type="button" className="af-immersive-close" onClick={onClose} aria-label="退出沉浸式歌词">
        <X size={26} />
      </button>

      <main className="af-immersive-stage af-showcase-layout">
        <section className="af-immersive-cover-section" aria-label="歌曲封面">
          <div className="af-immersive-cover">
            {coverUrl ? (
              <img src={coverUrl} alt={currentTrack?.name ?? '歌曲封面'} referrerPolicy={coverReferrerPolicy} />
            ) : (
              <div className="af-immersive-cover-placeholder">AuralFlow</div>
            )}
          </div>
          <div className="af-immersive-meta">
            <strong>{currentTrack?.name ?? '未在播放'}</strong>
            <span>{currentTrack?.singer || '请选择一首歌曲'}</span>
          </div>
        </section>

        <section className="af-immersive-lyric-section" aria-label="歌词">
          <PlayerVisualizerRenderer
            currentTrack={currentTrack}
            coverUrl={coverUrl}
            lyrics={lyrics}
            currentLyricIndex={currentLyricIndex}
            currentTime={lyricProgress}
            duration={duration}
            progressPercent={progressPercent}
            isPlaying={isPlaying}
            showTranslation={showTranslation}
            controlsHidden={controlsHidden}
          />
        </section>
      </main>

      {controlsHidden && (
        <button
          type="button"
          className="af-immersive-restore-controls"
          onClick={handleShowPlayerControls}
          aria-label="显示播放器控制栏"
          title="显示播放器控制栏"
        >
          <Eye size={18} />
        </button>
      )}

      {!controlsHidden && (
      <footer className="af-immersive-controls" aria-label="播放控制">
        {(showSpeedMenu || showSoundEffectPanel || showQueuePanel) && (
          <div className="af-immersive-popover-backdrop" onClick={closeControlPopovers} aria-hidden="true" />
        )}
        {showQueuePanel && (
          <div className="af-immersive-queue-panel" role="dialog" aria-label="播放列表">
            <div className="af-immersive-queue-header">
              <strong>播放列表</strong>
              <span>{queue.length} 首</span>
            </div>
            <div className="af-immersive-queue-list">
              {queue.map((track, index) => (
                <button
                  key={`${track.source}:${track.id}:${index}`}
                  type="button"
                  className={`af-immersive-queue-item ${index === currentIndex ? 'af-playing' : ''}`}
                  onClick={() => handleQueueItemPlay(index)}
                >
                  <span className="af-immersive-queue-index">{index + 1}</span>
                  <span className="af-immersive-queue-info">
                    <strong>{track.name}</strong>
                    <span>{track.singer || '未知歌手'}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
        {fullscreenError && <div className="af-immersive-status">{fullscreenError}</div>}
        <div className="af-immersive-progress-row">
          <span>{formatTime(displayProgress)}</span>
          <div className="af-immersive-progress-track">
            <div className="af-immersive-progress-fill" />
            <input
              type="range"
              min="0"
              max={duration || 0}
              value={displayProgress || 0}
              onChange={handleSeek}
              aria-label="播放进度"
            />
          </div>
          <span>{formatTime(duration)}</span>
        </div>

        <div className="af-immersive-control-row">
          <div
            className={`af-immersive-control-group af-immersive-control-left af-immersive-lyric-tools ${showSoundEffectPanel ? 'af-popover-open' : ''}`}
          >
            {currentTrack && (
              <SongAddMenuButton
                song={currentTrack}
                className="af-immersive-icon-btn"
                iconSize={18}
                title="添加到我的喜欢或歌单"
              />
            )}
            <button
              type="button"
              className={`af-immersive-icon-btn ${desktopLyricOpen ? 'af-active' : ''}`}
              onClick={handleDesktopLyricToggle}
              aria-label={desktopLyricButtonLabel}
              aria-pressed={desktopLyricOpen}
              title={desktopLyricButtonLabel}
            >
              <span>词</span>
            </button>
            <button
              type="button"
              className={`af-immersive-icon-btn ${showTranslation ? 'af-active' : ''}`}
              onClick={handleTranslationToggle}
              aria-label={showTranslation ? '隐藏歌词译文' : '显示歌词译文'}
              aria-pressed={showTranslation}
              title={showTranslation ? '隐藏歌词译文' : '显示歌词译文'}
            >
              <span>译</span>
            </button>
            <div className="af-immersive-menu-anchor">
              <button
                type="button"
                className="af-immersive-icon-btn af-immersive-speed-btn"
                onClick={() => {
                  setShowSoundEffectPanel(false);
                  setShowQueuePanel(false);
                  setShowSpeedMenu((open) => !open);
                }}
                aria-label="播放速度"
                title="播放速度"
              >
                <Gauge size={18} />
                <span className="af-immersive-speed-label">{playbackRate}x</span>
              </button>
              {showSpeedMenu && (
                <div className="af-immersive-menu af-immersive-speed-menu" role="menu">
                  {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
                    <button
                      key={rate}
                      type="button"
                      className={rate === playbackRate ? 'af-active' : ''}
                      onClick={() => handleSpeedChange(rate)}
                    >
                      {rate}x
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="af-immersive-menu-anchor">
              <button
                type="button"
                className={`af-immersive-icon-btn ${soundEffectActive ? 'af-active' : ''}`}
                onClick={handleSoundEffectToggle}
                aria-label="音效"
                title="音效"
              >
                <SlidersHorizontal size={18} />
              </button>
              {showSoundEffectPanel && (
                <div className="af-immersive-sound-popover">
                  <SoundEffectPanel />
                </div>
              )}
            </div>
          </div>

          <div className="af-immersive-control-group af-immersive-control-center af-immersive-transport-group">
            <button
              type="button"
              className={`af-immersive-icon-btn ${playModeControl.id !== 'sequence' ? 'af-active' : ''}`}
              onClick={handlePlayModeToggle}
              aria-label={`播放模式：${playModeControl.label}`}
              title={playModeControl.label}
            >
              {playModeControl.id === 'shuffle' ? (
                <Shuffle size={18} />
              ) : playModeControl.id === 'single-loop' ? (
                <Repeat1 size={18} />
              ) : (
                <Repeat size={18} />
              )}
            </button>
            <button type="button" className="af-immersive-icon-btn" onClick={prev} aria-label="上一首">
              <SkipBack size={20} fill="currentColor" />
            </button>
            <button
              type="button"
              className="af-immersive-play-btn"
              onClick={togglePlay}
              aria-label={isPlaying ? '暂停' : '播放'}
            >
              {isPlaying ? <Pause size={26} fill="currentColor" /> : <Play size={26} fill="currentColor" />}
            </button>
            <button type="button" className="af-immersive-icon-btn" onClick={next} aria-label="下一首">
              <SkipForward size={20} fill="currentColor" />
            </button>
          </div>

          <div className="af-immersive-control-group af-immersive-control-right af-immersive-utility-group">
            <button
              type="button"
              className={`af-immersive-icon-btn ${showQueuePanel ? 'af-active' : ''}`}
              onClick={handleQueueToggle}
              aria-label="播放列表"
              aria-pressed={showQueuePanel}
              title="播放列表"
            >
              <ListMusic size={18} />
            </button>
            <button
              type="button"
              className={`af-immersive-icon-btn af-immersive-fullscreen-btn ${isNativeFullscreen ? 'af-active' : ''}`}
              onClick={() => { void handleFullscreenToggle(); }}
              aria-label={isNativeFullscreen ? '退出全屏' : '进入全屏'}
              aria-pressed={isNativeFullscreen}
              title={isNativeFullscreen ? '退出全屏' : '进入全屏'}
            >
              {isNativeFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
            </button>
            <button
              type="button"
              className="af-immersive-icon-btn"
              onClick={handleHidePlayerControls}
              aria-label="隐藏播放器控制栏"
              title="隐藏播放器控制栏"
            >
              <EyeOff size={18} />
            </button>
            <button
              type="button"
              className="af-immersive-icon-btn"
              onClick={toggleMute}
              aria-label={isMuted ? '取消静音' : '静音'}
            >
              {isMuted || volume === 0 ? <VolumeX size={19} /> : <Volume2 size={19} />}
            </button>
            <div className="af-immersive-volume-track">
              <div className="af-immersive-volume-fill" />
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={volume}
                onChange={handleVolumeChange}
                aria-label="音量"
              />
            </div>
            <button
              type="button"
              className="af-immersive-icon-btn"
              onClick={() => { void handleShare(); }}
              aria-label="复制歌曲链接"
              title="复制歌曲链接"
            >
              <Share2 size={18} />
            </button>
            {shareStatus && <span className="af-immersive-share-status">{shareStatus}</span>}
          </div>
        </div>
      </footer>
      )}
    </div>
  );
}
