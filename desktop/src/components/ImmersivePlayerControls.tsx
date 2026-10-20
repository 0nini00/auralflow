import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import { LogOut, Ellipsis, Gauge, ListMusic, Pause, Play, Repeat, Repeat1, Share2, Shuffle, SkipBack, SkipForward, Languages, Volume2, VolumeX } from 'lucide-react';
import { IMMERSIVE_QUEUE_CLASSES, QueuePanel } from '@/components/QueuePanel';
import { formatTime } from '@/utils/formatTime';

type Panel = 'more' | 'lyrics' | 'queue';
export type LyricDisplayOption = 'translation' | 'romanization' | 'ruby';
export interface ImmersivePlayerControlsHandle {
  dismissPanel: () => boolean;
}
export interface ImmersivePlayerControlsProps {
  playback: {
    isPlaying: boolean;
    volume: number;
    isMuted: boolean;
    playbackRate: number;
    mode: { id: string; label: string };
  };
  actions: {
    togglePlay: () => void;
    toggleMute: () => void;
    setVolume: (volume: number) => void;
    prev: () => void;
    next: () => void;
    cycleMode: () => void;
    setPlaybackRate: (rate: number) => void;
    share: () => void;
    exitImmersive: () => void;
  };
  timeline: { current: number; duration: number; onSeek: (value: number) => void; onSeekStart: () => void; onSeekEnd: () => void };
  lyrics: {
    showTranslation: boolean;
    showRomanization: boolean;
    showRuby: boolean;
    pending: boolean;
    onToggle: (option: LyricDisplayOption) => void;
  };
  queue: {
    tracks: ReadonlyArray<{ id: string | number; source: string; name: string; singer: string }>;
    currentIndex: number;
    play: (index: number) => void;
    remove: (index: number) => void;
  };
  desktopLyrics: { open: boolean; label: string; toggle: () => void };
  onPanelOpenChange: (open: boolean) => void;
  error?: string;
  shareStatus?: string;
  children?: ReactNode;
}

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

export const ImmersivePlayerControls = forwardRef<ImmersivePlayerControlsHandle, ImmersivePlayerControlsProps>(
  function ImmersivePlayerControls({ playback, actions, timeline, lyrics, queue, desktopLyrics, onPanelOpenChange, error, shareStatus, children }, ref) {
    const [panel, setPanel] = useState<Panel | null>(null);
    const triggers = useRef<Partial<Record<Panel, HTMLButtonElement | null>>>({});

    const dismissPanel = () => {
      if (!panel) return false;
      const trigger = triggers.current[panel];
      setPanel(null);
      trigger?.focus();
      return true;
    };
    useImperativeHandle(ref, () => ({ dismissPanel }));
    useEffect(() => onPanelOpenChange(panel !== null), [panel, onPanelOpenChange]);

    const togglePanel = (next: Panel) => setPanel(current => current === next ? null : next);
    const triggerProps = (name: Panel) => ({
      ref: (node: HTMLButtonElement | null) => { triggers.current[name] = node; },
      className: `af-immersive-icon-btn${panel === name ? ' af-active' : ''}`,
      'aria-expanded': panel === name,
      'aria-haspopup': 'dialog' as const,
      'aria-controls': `af-immersive-${name}-panel`,
      onClick: () => togglePanel(name),
    });

    return (
      <footer className="af-immersive-controls" aria-label="播放控制" data-panel-open={panel !== null}
        onKeyDownCapture={event => {
          if (event.key !== 'Escape' || document.querySelector('.af-add-menu')) return;
          if (!dismissPanel()) return;
          event.preventDefault();
          event.stopPropagation();
        }}>
        {panel && <div className="af-immersive-popover-backdrop" onClick={dismissPanel} aria-hidden="true" />}
        {error && <div className="af-immersive-status" role="alert">{error}</div>}
        {shareStatus && <span className="af-immersive-share-status" role="status">{shareStatus}</span>}
        <div className="af-immersive-progress-row">
          <div className="af-immersive-progress-track">
            <div className="af-immersive-progress-fill" />
            <input type="range" min="0" max={timeline.duration || 0} value={timeline.current}
              onChange={event => timeline.onSeek(Number(event.target.value))}
              onPointerDown={timeline.onSeekStart} onPointerUp={timeline.onSeekEnd}
              onPointerCancel={timeline.onSeekEnd} onBlur={timeline.onSeekEnd} aria-label="播放进度" />
          </div>
        </div>
        <div className="af-immersive-control-row">
          <div className="af-immersive-time-group" aria-label="播放时间">
            <span className="af-immersive-time-current">{formatTime(timeline.current)}</span>
            <span className="af-immersive-time-total">{formatTime(timeline.duration)}</span>
          </div>
          <div className="af-immersive-control-center">
            <button type="button" className="af-immersive-icon-btn" onClick={actions.toggleMute} aria-label={playback.isMuted ? '取消静音' : '静音'}>
              {playback.isMuted || playback.volume === 0 ? <VolumeX size={19} /> : <Volume2 size={19} />}
            </button>
            <div className="af-immersive-volume-track">
              <div className="af-immersive-volume-fill" />
              <input type="range" min="0" max="1" step="0.01" value={playback.volume}
                onChange={event => actions.setVolume(Number(event.target.value))} aria-label="音量" />
            </div>
            <button type="button" className="af-immersive-icon-btn" onClick={actions.prev} aria-label="上一首"><SkipBack size={20} fill="currentColor" /></button>
            <button type="button" className="af-immersive-play-btn af-immersive-main-play" onClick={actions.togglePlay} aria-label={playback.isPlaying ? '暂停' : '播放'}>
              {playback.isPlaying ? <Pause size={26} fill="currentColor" /> : <Play size={26} fill="currentColor" />}
            </button>
            <button type="button" className="af-immersive-icon-btn" onClick={actions.next} aria-label="下一首"><SkipForward size={20} fill="currentColor" /></button>
            <button type="button" className={`af-immersive-icon-btn${playback.mode.id !== 'sequence' ? ' af-active' : ''}`}
              onClick={actions.cycleMode} aria-label={`播放模式：${playback.mode.label}`} data-tooltip={playback.mode.label}>
              {playback.mode.id === 'shuffle' ? <Shuffle size={18} /> : playback.mode.id === 'single-loop' ? <Repeat1 size={18} /> : <Repeat size={18} />}
            </button>
          </div>
          <div className="af-immersive-control-right">
            <div className="af-immersive-menu-anchor">
              <button type="button" {...triggerProps('lyrics')} aria-label="歌词工具" data-tooltip="歌词工具"><Languages size={18} /></button>
              {panel === 'lyrics' && (
                <div id="af-immersive-lyrics-panel" className="af-immersive-popover af-immersive-lyrics-panel" role="dialog" aria-label="歌词显示设置">
                  {([
                    ['translation', '译文', lyrics.showTranslation],
                    ['romanization', '罗马音', lyrics.showRomanization],
                    ['ruby', '注音', lyrics.showRuby],
                  ] as const).map(([option, label, enabled]) => (
                    <button key={option} type="button" className={enabled ? 'af-active' : ''} aria-label={label}
                      aria-pressed={enabled} disabled={lyrics.pending} onClick={() => lyrics.onToggle(option)}>{label}</button>
                  ))}
                </div>
              )}
            </div>
            <div className="af-immersive-menu-anchor">
              <button type="button" {...triggerProps('queue')} aria-label="播放列表" data-tooltip="播放列表"><ListMusic size={18} /></button>
              {panel === 'queue' && (
                <QueuePanel id="af-immersive-queue-panel" tracks={queue.tracks} currentIndex={queue.currentIndex}
                  play={queue.play} remove={queue.remove} classes={IMMERSIVE_QUEUE_CLASSES} onClose={dismissPanel} />
              )}
            </div>
            <button type="button" className={`af-immersive-icon-btn${desktopLyrics.open ? ' af-active' : ''}`} aria-label={desktopLyrics.label}
              aria-pressed={desktopLyrics.open} data-tooltip={desktopLyrics.label} onClick={() => { dismissPanel(); desktopLyrics.toggle(); }}><span>词</span></button>
            <div className="af-immersive-menu-anchor">
              <button type="button" {...triggerProps('more')} aria-label="更多" data-tooltip="更多"><Ellipsis size={20} /></button>
              {panel === 'more' && (
                <div id="af-immersive-more-panel" className="af-immersive-popover af-immersive-more-panel" role="dialog" aria-label="更多播放操作">
                  <div className="af-immersive-more-grid">
                    {children}
                    <label className="af-immersive-more-speed"><Gauge size={18} aria-hidden="true" /><span>播放速度</span>
                      <select aria-label="播放速度" value={playback.playbackRate} onChange={event => actions.setPlaybackRate(Number(event.target.value))}>
                        {PLAYBACK_RATES.map(rate => <option key={rate} value={rate}>{rate}x</option>)}
                      </select>
                    </label>
                    <button type="button" className="af-immersive-more-action" aria-label="复制歌曲链接"
                      onClick={() => { actions.share(); dismissPanel(); }}><Share2 size={18} /><span>复制歌曲链接</span></button>
                    <button type="button" className="af-immersive-more-action" aria-label="退出沉浸式播放"
                      onClick={() => { dismissPanel(); actions.exitImmersive(); }}><LogOut size={18} /><span>退出沉浸式播放</span></button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </footer>
    );
  },
);
