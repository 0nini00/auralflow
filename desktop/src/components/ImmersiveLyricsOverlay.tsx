import { useEffect, useRef, useState, type CSSProperties, type ChangeEvent } from 'react';
import {
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
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { PlayerVisualizerRenderer } from '@/components/playerVisualizers/PlayerVisualizerRenderer';
import { SongAddMenuButton } from '@/components/SongAddMenuButton';
import { useInterpolatedPlaybackProgress } from '@/hooks/useInterpolatedPlaybackProgress';
import { useNativeFullscreen } from '@/hooks/useNativeFullscreen';
import { useLyrics } from '@/hooks/useLyrics';
import { getNextPlayMode, getPlayModeControl } from '@/services/playback/playModeControl';
import { resolveImmersiveKeyboardAction } from '@/services/playback/immersiveKeyboard';
import {
  getLyricAnimationIntensityScale,
  normalizeLyricAnimationIntensity,
  type LyricAnimationIntensity,
} from '@/services/lyrics/animationIntensity';
import { broadcastLyricSettings, subscribeLyricSettings } from '@/stores/lyricSettingsSync';
import { usePlayerStore } from '@/stores/playerStore';
import { formatTime } from '@/utils/formatTime';
import { buildMusicShareText } from '@/utils/shareLink';
import { toggleDesktopLyricFromPlayer } from '@/utils/desktopLyricToggle';
import { COVER_SIZE_LARGE } from '@lx/core';
import { getImageReferrerPolicy, toCoverSrc } from '@/utils/imageReferrerPolicy';
import { getLyricWindowState, isLyricWindowOpen, loadSettings, patchSettings } from '@lx/tauri-bridge';
import { listen } from '@tauri-apps/api/event';

interface ImmersiveLyricsOverlayProps {
  open: boolean;
  onClose: () => void;
}

const DEFAULT_IMMERSIVE_LYRIC_FONT_FAMILY =
  '"Inter", "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif';


function buildCssUrl(url: string): string {
  return `url(${JSON.stringify(url)})`;
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLSelectElement || target.isContentEditable) return true;
  return Boolean(target.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']"));
}

export function ImmersiveLyricsOverlay({
  open,
  onClose,
}: ImmersiveLyricsOverlayProps) {
  const {
    current: currentTrack,
    queue,
    currentIndex,
    status,
    progress,
    progressSampledAt,
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
    removeFromQueue,
  } = usePlayerStore();

  const [showTranslation, setShowTranslation] = useState(true);
  const [immersiveLyricFontFamily, setImmersiveLyricFontFamily] = useState(DEFAULT_IMMERSIVE_LYRIC_FONT_FAMILY);
  const [animationIntensity, setAnimationIntensity] = useState<LyricAnimationIntensity>('normal');
  const [manualOffsetMs, setManualOffsetMs] = useState(0);
  const [fullscreenError, setFullscreenError] = useState('');
  const [shareStatus, setShareStatus] = useState('');
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showQueuePanel, setShowQueuePanel] = useState(false);
  const [desktopLyricOpen, setDesktopLyricOpen] = useState(false);
  const [desktopLyricLocked, setDesktopLyricLocked] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubProgress, setScrubProgress] = useState(0);
  const queueItemRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const isPlaying = status === 'playing';
  const coverUrl = toCoverSrc(currentTrack?.img || currentTrack?.picUrl || '', COVER_SIZE_LARGE);
  const coverReferrerPolicy = getImageReferrerPolicy(coverUrl);
  const playModeControl = getPlayModeControl({ repeatMode, isShuffle });
  const lyricProgress = useInterpolatedPlaybackProgress({ status, progress, progressSampledAt, duration, playbackRate });
  const { lyrics, currentLine: currentLyricIndex } = useLyrics(currentTrack, lyricProgress, manualOffsetMs / 1000);
  const { isFullscreen: isNativeFullscreen, toggleFullscreen } = useNativeFullscreen(open);



  useEffect(() => {
    if (!open || !showQueuePanel || currentIndex < 0) return;

    const frame = window.requestAnimationFrame(() => {
      queueItemRefs.current[currentIndex]?.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth',
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [currentIndex, open, queue.length, showQueuePanel]);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      const action = resolveImmersiveKeyboardAction(event);
      if (!action) return;
      if (action !== 'close' && isEditableKeyboardTarget(event.target)) return;

      event.preventDefault();
      const player = usePlayerStore.getState();
      switch (action) {
        case 'close':
          onClose();
          break;
        case 'toggle-play':
          player.togglePlay();
          break;
        case 'seek-backward':
          player.setProgress(Math.max(0, player.progress - 5));
          break;
        case 'seek-forward': {
          const max = player.duration > 0 ? player.duration : player.progress + 5;
          player.setProgress(Math.min(max, player.progress + 5));
          break;
        }
        case 'previous':
          void player.prev();
          break;
        case 'next':
          void player.next();
          break;
        case 'volume-up':
          player.setVolume(Math.min(1, player.volume + 0.1));
          break;
        case 'volume-down':
          player.setVolume(Math.max(0, player.volume - 0.1));
          break;
        case 'toggle-mute':
          player.toggleMute();
          break;
      }
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
        setImmersiveLyricFontFamily(settings.immersiveLyricFontFamily || DEFAULT_IMMERSIVE_LYRIC_FONT_FAMILY);
        setAnimationIntensity(normalizeLyricAnimationIntensity(settings.lyricAnimationIntensity));
        setManualOffsetMs(typeof settings.lyricManualOffsetMs === "number" ? settings.lyricManualOffsetMs : 0);
      })
      .catch(() => undefined);
    void isLyricWindowOpen().then(setDesktopLyricOpen).catch(() => undefined);
    void getLyricWindowState()
      .then((state) => setDesktopLyricLocked(state.locked))
      .catch(() => undefined);
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
      if (typeof patch.immersiveLyricFontFamily === 'string') {
        setImmersiveLyricFontFamily(patch.immersiveLyricFontFamily);
      }
      if (typeof patch.lyricAnimationIntensity === 'string') {
        setAnimationIntensity(normalizeLyricAnimationIntensity(patch.lyricAnimationIntensity));
      }
      if (typeof patch.lyricManualOffsetMs === 'number') {
        setManualOffsetMs(patch.lyricManualOffsetMs);
      }
    });
    return () => {
      void unlistenPromise.then((unlisten) => unlisten()).catch(() => undefined);
      unsubscribe();
    };
  }, [open]);

  const handleSeek = (event: ChangeEvent<HTMLInputElement>) => {
    const nextProgress = parseFloat(event.target.value);
    if (!isScrubbing) setIsScrubbing(true);
    setScrubProgress(nextProgress);
    setProgress(nextProgress);
  };

  const handleSeekEnd = () => {
    setIsScrubbing(false);
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
    setShowQueuePanel(false);
  };

  const handleSpeedChange = (rate: number) => {
    setPlaybackRate(rate);
    setShowSpeedMenu(false);
  };

  const handleQueueToggle = () => {
    setShowSpeedMenu(false);
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
          void isLyricWindowOpen().then(setDesktopLyricOpen).catch(() => undefined);
        }, 120);
      })
      .catch((error) => {
        setFullscreenError(`桌面歌词失败：${error instanceof Error ? error.message : String(error)}`);
      });
  };

  const handleFullscreenToggle = async () => {
    closeControlPopovers();
    setFullscreenError('');
    try {
      await toggleFullscreen();
    } catch (error) {
      setFullscreenError(`全屏请求失败：${error instanceof Error ? error.message : String(error)}`);
    }
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
    void playByIndex(index);
    setShowQueuePanel(false);
  };

  const handleQueueItemRemove = (event: React.MouseEvent<HTMLButtonElement>, index: number) => {
    event.stopPropagation();
    removeFromQueue(index);
  };

  if (!open) return null;

  // 拖动进度条时用 scrub 值，避免插值进度和拖拽互相抢
  const liveProgress = isPlaying ? lyricProgress : progress;
  const displayProgress = isScrubbing ? scrubProgress : liveProgress;
  const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (displayProgress / duration) * 100)) : 0;
  const volumePercent = Math.min(100, Math.max(0, volume * 100));
  // 动画强度映射为系数（reduced 0.55 / normal 1 / enhanced 1.25），经 CSS 变量调制沉浸页动画时长
  const animationIntensityScale = getLyricAnimationIntensityScale(animationIntensity);
  const desktopLyricButtonLabel = desktopLyricOpen
    ? desktopLyricLocked
      ? '解锁桌面歌词'
      : '关闭桌面歌词'
    : '打开桌面歌词';

  return (
    <div
      className={[
        'af-immersive-lyrics',
        'af-immersive-visualizer-scrolling',
        isNativeFullscreen ? 'af-immersive-native-fullscreen' : '',
        // 播放态：驱动封面呼吸律动；暂停时 CSS 侧 animation-play-state: paused
        isPlaying ? 'af-immersive-playing' : '',
      ].filter(Boolean).join(' ')}
      role="dialog"
      aria-modal="true"
      aria-label="沉浸式歌词"
      data-anim-intensity={animationIntensity}
      style={{
        '--af-immersive-progress': `${progressPercent}%`,
        '--af-immersive-volume': `${volumePercent}%`,
        '--af-immersive-lyric-font-family': immersiveLyricFontFamily,
        // 封面取色兜底：取色失败时 --af-artwork-rgb 未定义，回退到主题强调色
        '--af-immersive-artwork-rgb': 'var(--af-artwork-rgb, var(--af-accent-primary-rgb))',
        // 动画强度系数：调制封面呼吸与环境色过渡时长（CSS 侧 calc 除法使用）
        '--af-immersive-anim-scale': animationIntensityScale,
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

      <header
        className="af-immersive-heading"
        key={`${currentTrack?.source ?? ''}:${currentTrack?.id ?? ''}`}
        aria-label="当前歌曲"
      >
        <strong className="af-immersive-heading-title">{currentTrack?.name ?? '未在播放'}</strong>
        <span className="af-immersive-heading-artist">{currentTrack?.singer || '请选择一首歌曲'}</span>
      </header>

      <main className="af-immersive-stage af-showcase-layout">
        <section className="af-immersive-cover-section" aria-label="歌曲封面">
          <div className="af-immersive-cover">
            {coverUrl ? (
              <img src={coverUrl} alt={currentTrack?.name ?? '歌曲封面'} referrerPolicy={coverReferrerPolicy} />
            ) : (
              <div className="af-immersive-cover-placeholder">AuralFlow</div>
            )}
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
            layoutKey={`${immersiveLyricFontFamily}:${showTranslation}:${animationIntensity}`}
          />
        </section>
      </main>

      <footer className="af-immersive-controls" aria-label="播放控制">
        {(showSpeedMenu || showQueuePanel) && (
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
                <div
                  key={`${track.source}:${track.id}:${index}`}
                  ref={(element) => {
                    queueItemRefs.current[index] = element;
                  }}
                  className={`af-immersive-queue-item ${index === currentIndex ? 'af-playing' : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleQueueItemPlay(index)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      handleQueueItemPlay(index);
                    }
                  }}
                >
                  <span className="af-immersive-queue-index">{index + 1}</span>
                  <span className="af-immersive-queue-info">
                    <strong>{track.name}</strong>
                    <span>{track.singer || '未知歌手'}</span>
                  </span>
                  <button
                    type="button"
                    className="af-immersive-queue-remove"
                    onClick={(event) => handleQueueItemRemove(event, index)}
                    aria-label={`从播放列表移除 ${track.name}`}
                    data-tooltip="从播放列表移除"
                  >
                    <X size={15} />
                  </button>
                </div>
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
              onPointerDown={() => {
                setIsScrubbing(true);
                setScrubProgress(isPlaying ? lyricProgress : progress);
              }}
              onPointerUp={handleSeekEnd}
              onPointerCancel={handleSeekEnd}
              onBlur={handleSeekEnd}
              aria-label="播放进度"
            />
          </div>
          <span>{formatTime(duration)}</span>
        </div>

        <div className="af-immersive-control-row">
          <div
            className="af-immersive-control-group af-immersive-control-left af-immersive-lyric-tools"
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
              data-tooltip={desktopLyricButtonLabel}
            >
              <span>词</span>
            </button>
            <button
              type="button"
              className={`af-immersive-icon-btn ${showTranslation ? 'af-active' : ''}`}
              onClick={handleTranslationToggle}
              aria-label={showTranslation ? '隐藏歌词译文' : '显示歌词译文'}
              aria-pressed={showTranslation}
              data-tooltip={showTranslation ? '隐藏歌词译文' : '显示歌词译文'}
            >
              <span>译</span>
            </button>
            <div className="af-immersive-menu-anchor">
              <button
                type="button"
                className="af-immersive-icon-btn af-immersive-speed-btn"
                onClick={() => {
                  setShowQueuePanel(false);
                  setShowSpeedMenu((open) => !open);
                }}
                aria-label="播放速度"
                data-tooltip="播放速度"
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
          </div>

          <div className="af-immersive-control-group af-immersive-control-center af-immersive-transport-group">
            <button
              type="button"
              className={`af-immersive-icon-btn ${playModeControl.id !== 'sequence' ? 'af-active' : ''}`}
              onClick={handlePlayModeToggle}
              aria-label={`播放模式：${playModeControl.label}`}
              data-tooltip={playModeControl.label}
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
              data-tooltip="播放列表"
            >
              <ListMusic size={18} />
            </button>
            <button
              type="button"
              className={`af-immersive-icon-btn af-immersive-fullscreen-btn ${isNativeFullscreen ? 'af-active' : ''}`}
              onClick={() => { void handleFullscreenToggle(); }}
              aria-label={isNativeFullscreen ? '退出全屏' : '进入全屏'}
              aria-pressed={isNativeFullscreen}
              data-tooltip={isNativeFullscreen ? '退出全屏' : '进入全屏'}
            >
              {isNativeFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
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
              data-tooltip="复制歌曲链接"
            >
              <Share2 size={18} />
            </button>
            {shareStatus && <span className="af-immersive-share-status">{shareStatus}</span>}
          </div>
        </div>
      </footer>
    </div>
  );
}
