import { useDialogFocus } from '@/hooks/useDialogFocus';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ImmersivePlayerControls, type ImmersivePlayerControlsHandle, type LyricDisplayOption } from '@/components/ImmersivePlayerControls';
import { PlayerVisualizerRenderer } from '@/components/playerVisualizers/PlayerVisualizerRenderer';
import { SongAddMenuButton } from '@/components/SongAddMenuButton';
import { useInterpolatedPlaybackProgress } from '@/hooks/useInterpolatedPlaybackProgress';
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
import { buildMusicShareText } from '@/utils/shareLink';
import { toggleDesktopLyricFromPlayer } from '@/utils/desktopLyricToggle';
import { IMMERSIVE_COVER_CSS_SIZE, coverSrc } from '@/utils/imageReferrerPolicy';
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
  const [showRomanization, setShowRomanization] = useState(false);
  const [showRuby, setShowRuby] = useState(false);
  const [immersiveLyricFontFamily, setImmersiveLyricFontFamily] = useState(DEFAULT_IMMERSIVE_LYRIC_FONT_FAMILY);
  const [animationIntensity, setAnimationIntensity] = useState<LyricAnimationIntensity>('normal');
  const [manualOffsetMs, setManualOffsetMs] = useState(0);
  const [lyricError, setLyricError] = useState('');
  const [shareStatus, setShareStatus] = useState('');
  const [panelOpen, setPanelOpen] = useState(false);
  const [lyricSettingsPending, setLyricSettingsPending] = useState(false);
  const controlsRef = useRef<ImmersivePlayerControlsHandle>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus({ open, containerRef: dialogRef, onClose: () => {
    if (!controlsRef.current?.dismissPanel()) onClose();
  } });
  const [desktopLyricOpen, setDesktopLyricOpen] = useState(false);
  const [desktopLyricLocked, setDesktopLyricLocked] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubProgress, setScrubProgress] = useState(0);
  const isPlaying = status === 'playing';
  const coverUrl = coverSrc(currentTrack?.img || currentTrack?.picUrl || '', IMMERSIVE_COVER_CSS_SIZE);
  const playModeControl = getPlayModeControl({ repeatMode, isShuffle });
  const lyricProgress = useInterpolatedPlaybackProgress({ status, progress, progressSampledAt, duration, playbackRate });
  const lyricTime = lyricProgress + manualOffsetMs / 1000;
  const { lyrics, currentLine: currentLyricIndex } = useLyrics(currentTrack, lyricTime);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const action = resolveImmersiveKeyboardAction(event);
      if (!action) return;
      if (action !== 'close' && isEditableKeyboardTarget(event.target)) return;
      if (action === 'toggle-play' && event.target instanceof HTMLElement
        && event.target.closest('button, a, [role="button"], [role="menuitem"]')) return;
      // 收藏/歌单通过 portal 展示并拥有自己的 Escape 监听，先让它关闭。
      if (action === 'close' && document.querySelector('.af-add-menu')) {
        event.preventDefault();
        return;
      }

      event.preventDefault();
      const player = usePlayerStore.getState();
      switch (action) {
        case 'close':
          if (controlsRef.current?.dismissPanel()) break;
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
        setShowRomanization(settings.lyricShowRomanization === true);
        setShowRuby(settings.lyricShowRuby === true);
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
      if (typeof patch.lyricShowRomanization === "boolean") setShowRomanization(patch.lyricShowRomanization);
      if (typeof patch.lyricShowRuby === "boolean") setShowRuby(patch.lyricShowRuby);
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

  const handleSeek = (nextProgress: number) => {
    // 仅指针按下才进入拖动预览；键盘 seek 后继续显示实时进度。
    setScrubProgress(nextProgress);
    setProgress(nextProgress);
  };

  const handleSeekEnd = () => setIsScrubbing(false);
  const closeControlPopovers = () => { controlsRef.current?.dismissPanel(); };
  const handlePlayModeToggle = () => {
    closeControlPopovers();
    setPlayMode(getNextPlayMode(playModeControl.id));
  };

  const handleLyricDisplayToggle = async (option: LyricDisplayOption) => {
    const options = {
      translation: { key: 'lyricShowTranslation', value: showTranslation, set: setShowTranslation, label: '译文' },
      romanization: { key: 'lyricShowRomanization', value: showRomanization, set: setShowRomanization, label: '罗马音' },
      ruby: { key: 'lyricShowRuby', value: showRuby, set: setShowRuby, label: '注音' },
    } as const;
    const setting = options[option];
    const patch = { [setting.key]: !setting.value };
    setLyricSettingsPending(true);
    setLyricError('');
    try {
      await patchSettings(patch);
      setting.set(!setting.value);
      broadcastLyricSettings(patch);
    } catch (error) {
      setLyricError(`${setting.label}设置失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLyricSettingsPending(false);
    }
  };

  const handleDesktopLyricToggle = () => {
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
        setLyricError(`桌面歌词失败：${error instanceof Error ? error.message : String(error)}`);
      });
  };

  const handleShare = async () => {
    if (!currentTrack) return;
    try {
      await navigator.clipboard.writeText(buildMusicShareText(currentTrack));
      setShareStatus('已复制');
      window.setTimeout(() => setShareStatus(''), 1600);
    } catch {
      setShareStatus('复制失败');
      window.setTimeout(() => setShareStatus(''), 1600);
    }
  };

  if (!open) return null;

  // 拖动进度条时用 scrub 值，避免插值进度和拖拽互相抢
  const liveProgress = isPlaying ? lyricProgress : progress;
  const displayProgress = isScrubbing ? scrubProgress : liveProgress;
  const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (displayProgress / duration) * 100)) : 0;
  const volumePercent = Math.min(100, Math.max(0, volume * 100));
  // 动画强度仅用于歌词过渡，不改变新布局的封面尺寸。
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
        // 保留播放态给歌词表现层，不再驱动封面呼吸缩放。
        isPlaying ? 'af-immersive-playing' : '',
      ].filter(Boolean).join(' ')}
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="沉浸式歌词"
      data-anim-intensity={animationIntensity}
      data-panel-open={panelOpen}
      style={{
        '--af-immersive-progress': `${progressPercent}%`,
        '--af-immersive-volume': `${volumePercent}%`,
        '--af-immersive-lyric-font-family': immersiveLyricFontFamily,
        // 封面取色兜底：取色失败时 --af-artwork-rgb 未定义，回退到主题强调色
        '--af-immersive-artwork-rgb': 'var(--af-artwork-rgb, var(--af-accent-primary-rgb))',
        // 歌词过渡继续使用现有动画强度设置。
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

      <main className="af-immersive-stage af-showcase-layout">
        <section className="af-immersive-cover-section" aria-label="歌曲封面">
          <div className="af-immersive-cover">
            {coverUrl ? (
              <img src={coverUrl} alt={currentTrack?.name ?? '歌曲封面'} />
            ) : (
              <div className="af-immersive-cover-placeholder">AuralFlow</div>
            )}
          </div>
          <div className="af-immersive-heading" key={`${currentTrack?.source ?? ''}:${currentTrack?.id ?? ''}`} aria-label="当前歌曲">
            <h1 className="af-immersive-heading-title">{currentTrack?.name ?? '未在播放'}</h1>
            <p className="af-immersive-heading-artist">{currentTrack?.singer || '请选择一首歌曲'}</p>
            <p className="af-immersive-heading-album">{currentTrack?.albumName || '未知专辑'}</p>
          </div>
        </section>
        <section className="af-immersive-lyric-section" aria-label="歌词">
          <PlayerVisualizerRenderer
            currentTrack={currentTrack}
            coverUrl={coverUrl}
            lyrics={lyrics}
            currentLyricIndex={currentLyricIndex}
            currentTime={lyricTime}
            duration={duration}
            progressPercent={progressPercent}
            isPlaying={isPlaying}
            showTranslation={showTranslation}
            showRomanization={showRomanization}
            showRuby={showRuby}
            layoutKey={`${immersiveLyricFontFamily}:${showTranslation}:${showRomanization}:${showRuby}:${animationIntensity}`}
          />
        </section>
      </main>

      <ImmersivePlayerControls
        ref={controlsRef}
        playback={{ isPlaying, volume, isMuted, playbackRate, mode: playModeControl }}
        actions={{ togglePlay, toggleMute, setVolume, prev, next, cycleMode: handlePlayModeToggle, setPlaybackRate, share: handleShare, exitImmersive: onClose }}
        timeline={{
          current: displayProgress,
          duration,
          onSeek: handleSeek,
          onSeekStart: () => { setIsScrubbing(true); setScrubProgress(liveProgress); },
          onSeekEnd: handleSeekEnd,
        }}
        lyrics={{ showTranslation, showRomanization, showRuby, pending: lyricSettingsPending, onToggle: handleLyricDisplayToggle }}
        queue={{ tracks: queue, currentIndex, play: playByIndex, remove: removeFromQueue }}
        desktopLyrics={{ open: desktopLyricOpen, label: desktopLyricButtonLabel, toggle: handleDesktopLyricToggle }}
        onPanelOpenChange={setPanelOpen}
        error={lyricError}
        shareStatus={shareStatus}
      >
        {currentTrack && <SongAddMenuButton song={currentTrack} className="af-immersive-more-action" iconSize={18} title="添加到我的喜欢或歌单" label="收藏 / 加入歌单" />}
      </ImmersivePlayerControls>
    </div>
  );
}
