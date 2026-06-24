import { useNavigate } from 'react-router-dom';
import { usePlayerStore, RepeatMode } from '@/stores/playerStore';
import { SongAddMenuButton } from '@/components/SongAddMenuButton';
import { SoundEffectPanel } from '@/components/SoundEffectPanel';
import { PlayerVisualizerRenderer } from '@/components/playerVisualizers/PlayerVisualizerRenderer';
import { useSoundEffectStore } from '@/stores/soundEffectStore';
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
  X,
  Mic2,
  ListMusic,
  Share2,
  Gauge,
  Languages,
  SlidersHorizontal,
  MessageCircle,
  ThumbsUp,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { getComments, type Comment } from '@/services/commentsService';
import { useLyrics } from '@/hooks/useLyrics';
import { useLyricAutoScroll } from '@/hooks/useLyricAutoScroll';
import { buildMusicShareText } from '@/utils/shareLink';
import { toggleDesktopLyricFromPlayer } from '@/utils/desktopLyricToggle';
import { logAsyncError } from '@/utils/logAsyncError';
import { broadcastLyricSettings, subscribeLyricSettings } from '@/stores/lyricSettingsSync';
import { getLyricWindowState, isLyricWindowOpen, loadSettings, patchSettings } from '@lx/tauri-bridge';
import { listen } from '@tauri-apps/api/event';

export function PlayerView() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'lyrics' | 'playlist' | 'comments'>('lyrics');
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showSoundEffectPanel, setShowSoundEffectPanel] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsTotal, setCommentsTotal] = useState(0);
  const [commentsError, setCommentsError] = useState('');
  const [shareStatus, setShareStatus] = useState('');
  const [desktopLyricOpen, setDesktopLyricOpen] = useState(false);
  const [desktopLyricLocked, setDesktopLyricLocked] = useState(false);
  const [showTranslation, setShowTranslation] = useState(true);

  const {

    current: currentTrack,

    queue,

    currentIndex,

    status,

    progress: currentTime,

    duration,

    volume,

    isMuted,

    playbackRate,

    repeatMode,

    isShuffle,

    togglePlay,

    setVolume,

    toggleMute,

    setPlaybackRate,

    next,

    prev,

    setRepeatMode,

    toggleShuffle,

    setProgress,

    playByIndex,

  } = usePlayerStore();

  const isPlaying = status === 'playing';
  const coverUrl = currentTrack?.img || currentTrack?.picUrl || '';
  const soundEffectActive = useSoundEffectStore((s) => s.enabled || s.pitch !== 0);

  // 使用统一的歌词 hook
  const { lyrics, currentLine: currentLyricIndex } = useLyrics(currentTrack, currentTime);

  const {
    containerRef: lyricsViewportRef,
    handleWheel: handleLyricsWheel,
    resumeAutoScroll: resumeLyricAutoScroll,
    setLineRef: lyricLineRef,
  } = useLyricAutoScroll({
    active: activeTab === 'lyrics',
    currentLine: currentLyricIndex,
    progress: currentTime,
    resetKey: `${currentTrack?.source ?? ''}:${currentTrack?.id ?? ''}`,
  });

  useEffect(() => {
    void loadSettings()
      .then((settings) => setShowTranslation(settings.lyricShowTranslation !== false))
      .catch(logAsyncError('player-view:load-lyric-settings'));
    void isLyricWindowOpen().then(setDesktopLyricOpen).catch(logAsyncError('player-view:query-lyric-open'));
    void getLyricWindowState()
      .then((state) => setDesktopLyricLocked(state.locked))
      .catch(logAsyncError('player-view:query-lyric-state'));
    const unlistenPromise = listen<{ open: boolean }>('lyric-window-open-changed', (event) => {
      setDesktopLyricOpen(event.payload.open);
    });
    const unsubscribeLyricSettings = subscribeLyricSettings((patch) => {
      if (typeof patch.lyricLocked === 'boolean') {
        setDesktopLyricLocked(patch.lyricLocked);
      }
      if (typeof patch.lyricShowTranslation === 'boolean') {
        setShowTranslation(patch.lyricShowTranslation);
      }
    });
    return () => {
      void unlistenPromise.then((unlisten) => unlisten()).catch(logAsyncError('player-view:unlisten-lyric-window'));
      unsubscribeLyricSettings();
    };
  }, []);

  // 加载评论
  useEffect(() => {
    if (currentTrack && activeTab === 'comments') {
      setCommentsLoading(true);
      setCommentsError('');
      getComments(currentTrack, 1).then(result => {
        setComments(result.comments || []);
        setCommentsTotal(result.total || 0);
        setCommentsError(result.error || '');
        setCommentsLoading(false);
      }).catch(() => {
        setComments([]);
        setCommentsTotal(0);
        setCommentsError('获取评论失败');
        setCommentsLoading(false);
      });
    }
  }, [currentTrack, activeTab]);

  const handleClose = () => {
    // 尝试返回上一页，如果是直接访问则回到首页
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/');
    }
  };

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
    resumeLyricAutoScroll(false);
    setProgress(time);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
  };

  const handleSpeedChange = (rate: number) => {
    setPlaybackRate(rate);
    setShowSpeedMenu(false);
  };

  const handleSoundEffectToggle = () => {
    setShowSpeedMenu(false);
    setShowSoundEffectPanel((open) => !open);
  };

  const handleDesktopLyricToggle = () => {
    setShowSpeedMenu(false);
    setShowSoundEffectPanel(false);
    setShareStatus('正在切换桌面歌词...');
    void toggleDesktopLyricFromPlayer(undefined, {
      knownOpen: desktopLyricOpen,
      knownLocked: desktopLyricLocked,
    })
      .then((result) => {
        setDesktopLyricOpen(result.open);
        setDesktopLyricLocked(result.locked);
        setShareStatus(result.message);
        window.setTimeout(() => {
          void isLyricWindowOpen().then(setDesktopLyricOpen).catch(logAsyncError('player-view:refresh-lyric-open'));
        }, 120);
        window.setTimeout(() => setShareStatus(''), 1600);
      })
      .catch((error) => {
        console.error('[desktop lyric] toggle failed', error);
        setShareStatus(`桌面歌词失败：${error instanceof Error ? error.message : String(error)}`);
        window.setTimeout(() => setShareStatus(''), 3200);
      });
  };

  const handleTranslationToggle = () => {
    const next = !showTranslation;
    setShowTranslation(next);
    broadcastLyricSettings({ lyricShowTranslation: next });
    patchSettings({ lyricShowTranslation: next }).catch((error) => {
      setShowTranslation(!next);
      broadcastLyricSettings({ lyricShowTranslation: !next });
      setShareStatus(`译文设置失败：${error instanceof Error ? error.message : String(error)}`);
      window.setTimeout(() => setShareStatus(''), 2600);
    });
  };

  const handleShare = async () => {
    if (!currentTrack) return;
    const text = buildMusicShareText(currentTrack);
    try {
      await navigator.clipboard.writeText(text);
      setShareStatus('已复制链接');
      window.setTimeout(() => setShareStatus(''), 1600);
    } catch {
      setShareStatus('复制失败');
      window.setTimeout(() => setShareStatus(''), 1600);
    }
  };

  const formatTime = (time: number) => {
    if (isNaN(time) || !isFinite(time)) return '0:00';
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  if (!currentTrack) {
    // 切歌瞬间 / 解析中 / 加载中：保留全屏框架，避免短暂闪现"暂无播放内容"
    if (status === 'loading' || queue.length > 0) {
      return (
        <div className="af-player-view-empty">
          <p className="af-text-body" style={{ opacity: 0.6 }}>正在加载下一首…</p>
        </div>
      );
    }
    return (
      <div className="af-player-view-empty">
        <p className="af-text-body">暂无播放内容</p>
        <button onClick={handleClose} className="af-btn-primary" style={{ marginTop: '16px' }}>
          返回
        </button>
      </div>
    );
  }

  const desktopLyricButtonLabel = desktopLyricOpen
    ? desktopLyricLocked
      ? '解锁桌面歌词'
      : '关闭桌面歌词'
    : '打开桌面歌词';

  return (
    <div className="af-player-view">
      {/* 关闭按钮 */}
      <button className="af-player-close" onClick={handleClose} aria-label="退出全屏">
        <X size={28} />
      </button>

      <div className="af-player-main">
        {/* 顶部：歌曲信息 */}
        <div className="af-player-header">
          <h1 className="af-player-title">{currentTrack.name}</h1>
          <p className="af-player-artist">{currentTrack.singer}</p>
          {currentTrack.albumName && (
            <p className="af-player-album">{currentTrack.albumName}</p>
          )}
        </div>

        {/* 中间：左侧封面 + 右侧歌词 */}
        <div className="af-player-content">
          {/* 左侧：封面 */}
          <div className="af-player-cover-wrapper">
            <div className="af-player-album-art">
              {coverUrl ? (
                <img src={coverUrl} alt={currentTrack.name} />
              ) : (
                <div className="af-album-placeholder">
                  <svg width="80" height="80" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M18 3a1 1 0 00-1.196-.98l-10 2A1 1 0 006 5v9.114A4.369 4.369 0 005 14c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V7.82l8-1.6v5.894A4.37 4.37 0 0015 12c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V3z" />
                  </svg>
                </div>
              )}
            </div>
          </div>

          {/* 右侧：歌词/播放列表/评论 */}
          <div className="af-player-lyrics-section">
          <div className="af-lyrics-header">
            <button
              className={`af-lyrics-tab ${activeTab === 'lyrics' ? 'af-active' : ''}`}
              onClick={() => setActiveTab('lyrics')}
            >
              <Mic2 size={18} />
              <span>歌词</span>
            </button>
            <button
              className={`af-lyrics-tab ${activeTab === 'playlist' ? 'af-active' : ''}`}
              onClick={() => setActiveTab('playlist')}
            >
              <ListMusic size={18} />
              <span>播放列表</span>
            </button>
            <button
              className={`af-lyrics-tab ${activeTab === 'comments' ? 'af-active' : ''}`}
              onClick={() => setActiveTab('comments')}
            >
              <MessageCircle size={18} />
              <span>评论</span>
            </button>
            <button
              type="button"
              className={`af-lyrics-translation-toggle ${showTranslation ? 'af-active' : ''}`}
              onClick={handleTranslationToggle}
              title={showTranslation ? '隐藏歌词译文' : '显示歌词译文'}
              aria-label={showTranslation ? '隐藏歌词译文' : '显示歌词译文'}
              aria-pressed={showTranslation}
            >
              <Languages size={17} />
              <span>译文</span>
            </button>
          </div>

          {activeTab === 'lyrics' ? (
            <PlayerVisualizerRenderer
              lyrics={lyrics}
              currentLyricIndex={currentLyricIndex}
              showTranslation={showTranslation}
              lyricsViewportRef={lyricsViewportRef}
              handleLyricsWheel={handleLyricsWheel}
              lyricLineRef={lyricLineRef}
            />
          ) : activeTab === 'playlist' ? (
            <div className="af-queue-list">
              {queue.map((track, index) => (
                <div
                  key={index}
                  className={`af-queue-item ${index === currentIndex ? 'af-playing' : ''}`}
                  onClick={() => playByIndex(index)}
                  title="单击播放"
                >
                  <span className="af-queue-index">{index + 1}</span>
                  <div className="af-queue-info">
                    <div className="af-queue-name">{track.name}</div>
                    <div className="af-queue-artist">{track.singer}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="af-comments-section">
              {commentsLoading ? (
                <div className="af-comments-loading">加载中...</div>
              ) : comments.length === 0 ? (
                <div className="af-lyrics-empty">{commentsError || '暂无评论'}</div>
              ) : (
                <>
                  <div className="af-comments-header">
                    <span>精彩评论</span>
                    <span className="af-comments-count">{commentsTotal} 条</span>
                  </div>
                  <div className="af-comments-list">
                    {comments.map((comment) => (
                      <div key={comment.id} className="af-comment-item">
                        <div className="af-comment-avatar">
                          {comment.userAvatar ? (
                            <img src={comment.userAvatar} alt={comment.userName} />
                          ) : (
                            <div className="af-avatar-placeholder">{comment.userName.charAt(0)}</div>
                          )}
                        </div>
                        <div className="af-comment-content">
                          <div className="af-comment-user">{comment.userName}</div>
                          <div className="af-comment-text">{comment.content}</div>
                          <div className="af-comment-meta">
                            <span className="af-comment-time">
                              {new Date(comment.time).toLocaleDateString('zh-CN')}
                            </span>
                            <span className="af-comment-likes">
                              <ThumbsUp size={12} />
                              {comment.likedCount}
                            </span>
                          </div>
                          {comment.replies && comment.replies.length > 0 && (
                            <div className="af-comment-replies">
                              {comment.replies.map((reply) => (
                                <div key={reply.id} className="af-comment-reply">
                                  <span className="af-reply-user">{reply.userName}：</span>
                                  {reply.content}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        {/* 结束 af-player-lyrics-section */}
      </div>
      {/* 结束 af-player-content */}
      </div>
      {/* 结束 af-player-main */}

      {/* 底部控制栏 */}
      <div className="af-player-controls-bar">
        {/* 进度条（独立一行） */}
        <div className="af-progress-row">
          <span className="af-player-time">{formatTime(currentTime)}</span>
          <div className="af-player-progress-track">
            <div
              className="af-player-progress-fill"
              style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
            />
            <input
              type="range"
              min="0"
              max={duration || 0}
              value={currentTime || 0}
              onChange={handleSeek}
              className="af-player-progress-input"
            />
          </div>
          <span className="af-player-time">{formatTime(duration)}</span>
        </div>

        {/* 控制按钮（分三组） */}
        <div className="af-controls-row">
          {/* 左侧：辅助功能 */}
          <div className="af-controls-left">
            <SongAddMenuButton
              song={currentTrack}
              className="af-player-control-btn"
              iconSize={20}
              title="添加到我的喜欢或歌单"
            />

            <button
              type="button"
              onClick={handleDesktopLyricToggle}
              className={`af-player-control-btn ${desktopLyricOpen ? 'af-active' : ''}`}
              title={desktopLyricButtonLabel}
              aria-label={desktopLyricButtonLabel}
            >
              <Mic2 size={20} />
            </button>

            <div className="af-speed-control">
              <button
                onClick={() => {
                  setShowSoundEffectPanel(false);
                  setShowSpeedMenu(!showSpeedMenu);
                }}
                className="af-player-control-btn"
                title="播放速度"
              >
                <Gauge size={20} />
                <span className="af-speed-label">{playbackRate}x</span>
              </button>
              {showSpeedMenu && (
                <div className="af-speed-menu">
                  {[0.5, 0.75, 1.0, 1.25, 1.5, 2.0].map((rate) => (
                    <button
                      key={rate}
                      onClick={() => handleSpeedChange(rate)}
                      className={`af-speed-option ${rate === playbackRate ? 'af-active' : ''}`}
                    >
                      {rate}x
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="af-sound-control">
              <button
                type="button"
                onClick={handleSoundEffectToggle}
                className={`af-player-control-btn ${soundEffectActive ? 'af-active' : ''}`}
                title="音效"
                aria-label="音效"
                aria-expanded={showSoundEffectPanel}
              >
                <SlidersHorizontal size={20} />
              </button>
              {showSoundEffectPanel && (
                <>
                  <div
                    className="af-player-popover-backdrop"
                    onClick={() => setShowSoundEffectPanel(false)}
                    aria-hidden="true"
                  />
                  <div className="af-sound-popover">
                    <SoundEffectPanel />
                  </div>
                </>
              )}
            </div>
          </div>

          {/* 中间：主控制 */}
          <div className="af-controls-center">
            <button
              onClick={toggleShuffle}
              className={`af-player-control-btn ${isShuffle ? 'af-active' : ''}`}
              title="随机播放"
            >
              <Shuffle size={22} />
            </button>

            <button onClick={prev} className="af-player-control-btn" title="上一首">
              <SkipBack size={28} fill="currentColor" />
            </button>

            <button
              onClick={handleTrackPlay}
              className="af-player-play-btn"
              title={isPlaying ? '暂停' : '播放'}
            >
              {isPlaying ? (
                <Pause size={36} fill="currentColor" />
              ) : (
                <Play size={36} fill="currentColor" />
              )}
            </button>

            <button onClick={next} className="af-player-control-btn" title="下一首">
              <SkipForward size={28} fill="currentColor" />
            </button>

            <button
              onClick={handleRepeatToggle}
              className={`af-player-control-btn ${repeatMode !== 'off' ? 'af-active' : ''}`}
              title={repeatMode === 'off' ? '循环关闭' : repeatMode === 'all' ? '列表循环' : '单曲循环'}
            >
              {repeatMode === 'one' ? <Repeat1 size={22} /> : <Repeat size={22} />}
            </button>
          </div>

          {/* 右侧：音量和更多 */}
          <div className="af-controls-right">
            <div className="af-player-volume-control">
              <button
                onClick={toggleMute}
                className="af-player-control-btn"
                title={isMuted ? '取消静音' : '静音'}
              >
                {isMuted || volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
              </button>
              <div className="af-player-volume-slider">
                <div
                  className="af-player-volume-fill"
                  style={{ width: `${volume * 100}%` }}
                />
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={volume}
                  onChange={handleVolumeChange}
                  className="af-player-volume-input"
                  title={`音量 ${Math.round(volume * 100)}%`}
                />
              </div>
            </div>

            <button
              onClick={handleShare}
              className="af-player-control-btn"
              title="复制歌曲链接"
            >
              <Share2 size={20} />
            </button>
            {shareStatus && <span className="af-share-status">{shareStatus}</span>}
          </div>
        </div>
      </div>

      <style>{`
        .af-player-view {
          position: fixed;
          inset: 0;
          --af-lyric-font-stack: "Inter", "Noto Sans CJK SC", "Noto Sans JP", "Source Han Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
          --af-lyric-translation-font-stack: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", "Helvetica Neue", Arial, "Noto Sans CJK SC", "Source Han Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans JP", "Source Han Sans JP", "Hiragino Sans", "Yu Gothic", Meiryo, sans-serif;
          background: var(--af-bg-base);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .af-player-view-empty {
          position: fixed;
          inset: 0;
          background: var(--af-bg-base);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
        }

        .af-player-close {
          position: absolute;
          top: 20px;
          right: 20px;
          width: 48px;
          height: 48px;
          border-radius: var(--af-button-radius);
          border: 1px solid var(--af-border-secondary);
          background: var(--af-bg-elevated);
          color: var(--af-text-primary);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
          z-index: 10;
        }

        .af-player-close:hover {
          border-color: var(--af-border-primary);
          background: var(--af-bg-surface-hover);
          transform: translateY(-1px);
        }

        .af-player-main {
          flex: 1;
          display: flex;
          flex-direction: column;
          padding: 60px 5% 32px;
          overflow: hidden;
        }

        .af-player-header {
          text-align: center;
          margin-bottom: 32px;
          padding: 0 20px;
        }

        .af-player-title {
          font-size: 32px;
          font-weight: 700;
          color: var(--af-text-primary);
          margin-bottom: 8px;
        }

        .af-player-artist {
          font-size: 20px;
          color: var(--af-text-secondary);
          margin-bottom: 4px;
        }

        .af-player-album {
          font-size: 16px;
          color: var(--af-text-tertiary);
        }

        .af-player-content {
          flex: 1;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 48px;
          min-height: 0;
          overflow: hidden;
          max-width: 1200px;
          margin: 0 auto;
          width: 100%;
          align-items: stretch;
        }

        .af-player-cover-wrapper {
          display: flex;
          align-items: flex-start;
          justify-content: center;
          align-self: start;
        }

        .af-player-album-art {
          width: 400px;
          height: 400px;
          border-radius: var(--af-radius-xl);
          overflow: hidden;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
          flex-shrink: 0;
        }

        .af-player-album-art img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .af-album-placeholder {
          width: 100%;
          height: 100%;
          background: linear-gradient(135deg, var(--af-accent-primary), var(--af-accent-secondary));
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          opacity: 0.6;
        }

        .af-player-lyrics-section {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          min-height: 0;
          height: 100%;
          align-self: stretch;
        }

        .af-lyrics-header {
          display: flex;
          justify-content: center;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
          padding: 0 20px;
          margin-bottom: 16px;
        }

        .af-lyrics-tab {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          min-width: 118px;
          height: 52px;
          padding: 10px 20px;
          border: 1px solid var(--af-border-secondary);
          background: var(--af-bg-surface);
          color: var(--af-text-secondary);
          border-radius: var(--af-button-radius);
          cursor: pointer;
          font-size: 14px;
          font-weight: 600;
          transition: all var(--af-transition-fast);
        }

        .af-lyrics-tab svg {
          flex-shrink: 0;
        }

        .af-lyrics-tab:hover {
          border-color: var(--af-border-primary);
          background: var(--af-bg-surface-hover);
          color: var(--af-text-primary);
        }

        .af-lyrics-tab.af-active {
          border-color: rgba(var(--af-accent-primary-rgb), 0.32);
          background: rgba(var(--af-accent-primary-rgb), 0.12);
          color: var(--af-accent-primary);
        }

        .af-lyrics-translation-toggle {
          height: 40px;
          min-width: 78px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 8px 12px;
          border: 1px solid var(--af-border-secondary);
          border-radius: var(--af-button-radius);
          background: var(--af-bg-surface);
          color: var(--af-text-secondary);
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: all var(--af-transition-fast);
        }

        .af-lyrics-translation-toggle:hover {
          border-color: var(--af-border-primary);
          background: var(--af-bg-surface-hover);
          color: var(--af-text-primary);
        }

        .af-lyrics-translation-toggle.af-active {
          border-color: rgba(var(--af-accent-primary-rgb), 0.32);
          background: rgba(var(--af-accent-primary-rgb), 0.12);
          color: var(--af-accent-primary);
        }

        .af-lyrics-viewport {
          flex: 1;
          overflow-y: auto;
          overflow-x: hidden;
          padding: 0 20px;
          min-height: 0;
          overscroll-behavior: contain;
          scrollbar-width: thin;
          scrollbar-color: var(--af-border-primary) transparent;
        }

        .af-lyrics-viewport::-webkit-scrollbar {
          width: 4px;
        }

        .af-lyrics-viewport::-webkit-scrollbar-track {
          background: transparent;
        }

        .af-lyrics-viewport::-webkit-scrollbar-thumb {
          background: var(--af-border-primary);
          border-radius: 2px;
        }

        .af-lyrics-track {
          padding: var(--af-lyrics-center-padding, 40vh) 0;
        }

        .af-lyrics-empty {
          text-align: center;
          color: var(--af-text-tertiary);
          padding: 40px;
          font-size: 16px;
        }

        .af-lyric-line {
          min-height: 54px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          gap: 4px;
          color: var(--af-text-tertiary);
          transition: color 0.22s ease, opacity 0.22s ease, transform 0.22s ease;
          opacity: 0.52;
          padding: 8px 0;
          font-family: var(--af-lyric-font-stack);
          letter-spacing: 0;
        }

        .af-lyric-line.af-current {
          color: var(--af-accent-primary);
          opacity: 1;
          transform: translateY(-1px);
        }

        .af-lyric-primary,
        .af-lyric-translation {
          display: block;
          max-width: min(100%, 640px);
          overflow-wrap: anywhere;
        }

        .af-lyric-primary {
          font-size: 16px;
          line-height: 1.48;
          font-weight: 500;
        }

        .af-lyric-translation {
          font-family: var(--af-lyric-translation-font-stack);
          font-size: 13px;
          line-height: 1.42;
          font-weight: 500;
          color: var(--af-text-tertiary);
          opacity: 0.82;
        }

        .af-lyric-line.af-current .af-lyric-primary {
          font-size: 24px;
          line-height: 1.34;
          font-weight: 600;
          color: var(--af-accent-primary);
        }

        .af-lyric-line.af-current .af-lyric-translation {
          font-size: 15px;
          line-height: 1.42;
          color: var(--af-text-secondary);
          opacity: 0.9;
        }

        .af-queue-list {
          flex: 1;
          overflow-y: auto;
        }

        .af-queue-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 16px;
          border-radius: var(--af-radius-md);
          cursor: pointer;
          transition: background 0.2s;
        }

        .af-queue-item:hover {
          background: var(--af-bg-hover);
        }

        .af-queue-item.af-playing {
          background: rgba(var(--af-accent-primary-rgb), 0.1);
        }

        .af-queue-index {
          width: 24px;
          text-align: center;
          font-size: 14px;
          color: var(--af-text-secondary);
          font-variant-numeric: tabular-nums;
        }

        .af-queue-item.af-playing .af-queue-index {
          color: var(--af-accent-primary);
          font-weight: 600;
        }

        .af-queue-info {
          flex: 1;
          min-width: 0;
        }

        .af-queue-name {
          font-size: 14px;
          font-weight: 500;
          color: var(--af-text-primary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .af-queue-artist {
          font-size: 12px;
          color: var(--af-text-secondary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .af-player-controls-bar {
          background: var(--af-bg-elevated);
          border-top: 1px solid var(--af-border-secondary);
          padding: 20px 48px;
        }

        .af-player-controls-container {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .af-player-progress {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .af-player-time {
          font-size: 12px;
          color: var(--af-text-secondary);
          font-variant-numeric: tabular-nums;
          min-width: 45px;
          text-align: center;
        }

        .af-player-progress-track {
          flex: 1;
          height: 6px;
          background: var(--af-bg-hover);
          border-radius: 3px;
          position: relative;
          cursor: pointer;
        }

        .af-player-progress-fill {
          height: 100%;
          background: var(--af-accent-primary);
          border-radius: 3px;
          transition: width 0.1s linear;
          pointer-events: none;
        }

        .af-player-progress-input {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          opacity: 0;
          cursor: pointer;
          margin: 0;
        }

        .af-player-controls-buttons {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
        }

        .af-player-control-btn {
          min-width: 40px;
          height: 40px;
          padding: 0 10px;
          border: 1px solid transparent;
          background: transparent;
          color: var(--af-text-secondary);
          border-radius: var(--af-button-radius);
          cursor: pointer;
          transition: all var(--af-transition-fast);
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .af-player-control-btn:hover {
          border-color: var(--af-border-primary);
          background: var(--af-bg-surface-hover);
          color: var(--af-text-primary);
        }

        .af-player-control-btn.af-active {
          border-color: rgba(var(--af-accent-primary-rgb), 0.32);
          color: var(--af-accent-primary);
          background: rgba(var(--af-accent-primary-rgb), 0.12);
        }

        .af-player-control-btn.af-liked {
          border-color: rgba(var(--af-accent-primary-rgb), 0.32);
          background: rgba(var(--af-accent-primary-rgb), 0.12);
          color: var(--af-accent-primary);
        }

        .af-player-play-btn {
          width: 56px;
          height: 56px;
          border-radius: 18px;
          background: linear-gradient(180deg, rgba(var(--af-accent-primary-rgb), 0.96), rgba(var(--af-accent-primary-rgb), 0.82));
          color: var(--af-text-on-accent);
          border: 1px solid rgba(var(--af-accent-primary-rgb), 0.42);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all var(--af-transition-fast);
          box-shadow: 0 10px 24px rgba(var(--af-accent-primary-rgb), 0.26);
        }

        .af-player-play-btn:hover {
          background: var(--af-accent-gradient-hover);
          transform: translateY(-1px);
          box-shadow: 0 12px 28px rgba(var(--af-accent-primary-rgb), 0.3);
        }

        .af-player-play-btn:active {
          transform: translateY(0) scale(0.98);
        }

        .af-player-volume-control {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-left: 12px;
        }

        .af-player-volume-slider {
          width: 100px;
          height: 4px;
          background: var(--af-bg-hover);
          border-radius: 2px;
          position: relative;
          cursor: pointer;
        }

        .af-player-volume-fill {
          height: 100%;
          background: var(--af-text-secondary);
          border-radius: 2px;
          transition: width 0.1s;
          pointer-events: none;
        }

        .af-player-volume-input {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          opacity: 0;
          cursor: pointer;
          margin: 0;
        }

        .af-progress-row {
          display: flex;
          align-items: center;
          gap: 16px;
          margin-bottom: 20px;
        }

        .af-controls-row {
          display: grid;
          grid-template-columns: 1fr 2fr 1fr;
          gap: 24px;
          align-items: center;
        }

        .af-controls-left,
        .af-controls-right {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .af-controls-right {
          justify-content: flex-end;
        }

        .af-share-status {
          min-width: 44px;
          color: var(--af-text-secondary);
          font-size: 12px;
          white-space: nowrap;
        }

        .af-controls-center {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 16px;
        }

        .af-speed-control {
          position: relative;
        }

        .af-sound-control {
          position: relative;
        }

        .af-player-popover-backdrop {
          position: fixed;
          inset: 0;
          z-index: 19;
          background: transparent;
        }

        .af-sound-popover {
          position: absolute;
          left: 0;
          bottom: calc(100% + 12px);
          width: min(440px, calc(100vw - 32px));
          max-height: min(70vh, 620px);
          overflow: auto;
          z-index: 20;
        }

        .af-sound-panel {
          padding: 16px;
          border: 1px solid var(--af-border-secondary);
          border-radius: var(--af-radius-lg);
          background: var(--af-bg-elevated);
          box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28);
        }

        .af-sound-panel-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 16px;
        }

        .af-sound-panel-title {
          color: var(--af-text-primary);
          font-size: 15px;
          font-weight: 700;
        }

        .af-sound-panel-group {
          margin-bottom: 16px;
        }

        .af-sound-panel-group:last-child {
          margin-bottom: 0;
        }

        .af-speed-label {
          font-size: 11px;
          margin-left: 4px;
          font-weight: 600;
        }

        .af-speed-menu {
          position: absolute;
          bottom: 100%;
          left: 0;
          margin-bottom: 8px;
          background: var(--af-bg-elevated);
          border: 1px solid var(--af-border-secondary);
          border-radius: var(--af-radius-md);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
          padding: 8px;
          display: flex;
          flex-direction: column;
          gap: 4px;
          min-width: 80px;
          z-index: 10;
        }

        .af-speed-option {
          padding: 8px 12px;
          border: 1px solid transparent;
          background: transparent;
          color: var(--af-text-primary);
          text-align: left;
          border-radius: var(--af-radius-sm);
          cursor: pointer;
          font-size: 14px;
          transition: background 0.2s;
        }

        .af-speed-option:hover {
          background: var(--af-bg-hover);
        }

        .af-speed-option.af-active {
          border-color: rgba(var(--af-accent-primary-rgb), 0.32);
          background: rgba(var(--af-accent-primary-rgb), 0.12);
          color: var(--af-accent-primary);
        }

        @media (max-width: 760px) {
          .af-player-controls-bar {
            padding: 16px 20px;
          }

          .af-controls-row {
            grid-template-columns: 1fr;
            gap: 14px;
          }

          .af-controls-left,
          .af-controls-right,
          .af-controls-center {
            justify-content: center;
          }

          .af-sound-popover {
            position: fixed;
            left: 16px;
            right: 16px;
            bottom: 96px;
            width: auto;
            max-height: min(68vh, 560px);
          }
        }

        .af-comments-section {
          height: 100%;
          overflow-y: auto;
          padding: 0 24px;
        }

        .af-comments-loading {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 200px;
          color: var(--af-text-secondary);
          font-size: 14px;
        }

        .af-comments-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px 0;
          border-bottom: 1px solid var(--af-border-secondary);
          font-size: 15px;
          font-weight: 600;
          color: var(--af-text-primary);
        }

        .af-comments-count {
          font-size: 13px;
          font-weight: 400;
          color: var(--af-text-secondary);
        }

        .af-comments-list {
          padding: 16px 0;
        }

        .af-comment-item {
          display: flex;
          gap: 12px;
          padding: 16px 0;
          border-bottom: 1px solid var(--af-border-secondary);
        }

        .af-comment-item:last-child {
          border-bottom: none;
        }

        .af-comment-avatar {
          flex-shrink: 0;
          width: 40px;
          height: 40px;
          border-radius: 50%;
          overflow: hidden;
          background: var(--af-bg-secondary);
        }

        .af-comment-avatar img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .af-avatar-placeholder {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--af-accent-primary);
          color: white;
          font-size: 16px;
          font-weight: 600;
        }

        .af-comment-content {
          flex: 1;
          min-width: 0;
        }

        .af-comment-user {
          font-size: 14px;
          font-weight: 600;
          color: var(--af-text-primary);
          margin-bottom: 8px;
        }

        .af-comment-text {
          font-size: 14px;
          color: var(--af-text-primary);
          line-height: 1.6;
          margin-bottom: 8px;
          word-wrap: break-word;
        }

        .af-comment-meta {
          display: flex;
          align-items: center;
          gap: 16px;
          font-size: 12px;
          color: var(--af-text-secondary);
        }

        .af-comment-likes {
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .af-comment-replies {
          margin-top: 12px;
          padding: 12px;
          background: var(--af-bg-hover);
          border-radius: var(--af-radius-sm);
        }

        .af-comment-reply {
          font-size: 13px;
          color: var(--af-text-primary);
          line-height: 1.6;
          margin-bottom: 8px;
        }

        .af-comment-reply:last-child {
          margin-bottom: 0;
        }

        .af-reply-user {
          color: var(--af-accent-primary);
          font-weight: 600;
        }
      `}</style>
    </div>
  );
}
