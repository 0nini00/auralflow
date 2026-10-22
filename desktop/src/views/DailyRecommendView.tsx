import { useEffect } from 'react';
import { useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useDiscoveryStore } from '@/stores/discoveryStore';
import { useWyAccountStore } from '@/stores/wyAccountStore';
import { usePlayerStore } from '@/stores/playerStore';
import { SongAddMenuButton } from '@/components/SongAddMenuButton';
import { DownloadQualityButton } from '@/components/DownloadQualityButton';
import { formatDuration } from '@/lib/utils';
import { DETAIL_COVER_CSS_SIZE, coverSrc } from '@/utils/imageReferrerPolicy';
import { fisherYatesShuffle } from '@/utils/shared';
import { Calendar, Play, Shuffle, RefreshCw, Clock, Loader2, CornerDownRight, ChevronDown, Check } from 'lucide-react';

/** 菜单与触发器之间的间距 */
const MENU_GAP = 6;
/** 菜单距视口边缘的留白 */
const MENU_MARGIN = 8;
/** 菜单最高这么多，超出后改为内部滚动 —— 日期一多不能把底部顶到屏幕外 */
const MENU_MAX_HEIGHT = 320;
/** 单项高度（.af-dropdown-menu button 实测 42px），只用于估算要不要翻面 */
const MENU_ITEM_HEIGHT = 42;

type PendingPlayAction = 'play-all' | 'shuffle' | `track:${number}` | null;

/**
 * 推荐日期下拉。
 *
 * 原本是原生 <select>：展开的列表由系统绘制，深色封面上会出现一块系统白列表，跟界面完全不搭，
 * 而且触发器用的是主题色，浅色主题下等于「深底上放一个白底控件 + 深灰标签」。
 * 这里换成自绘菜单（与「添加到」「下载音质」「歌单卡片」同一套 portal + backdrop 做法）。
 */
function DailyDatePicker({
  dates,
  value,
  today,
  disabled,
  onSelect,
}: {
  dates: string[];
  value: string;
  today: string;
  disabled: boolean;
  onSelect: (date: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);

  const openMenu = (event: ReactMouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const width = Math.max(180, Math.round(rect.width));
    const wanted = Math.min(dates.length * MENU_ITEM_HEIGHT + 16, MENU_MAX_HEIGHT);
    const spaceBelow = window.innerHeight - rect.bottom - MENU_GAP - MENU_MARGIN;
    const spaceAbove = rect.top - MENU_GAP - MENU_MARGIN;
    // 下方放不下想要的完整高度时，翻到空间更大的一侧，并把高度压进该侧的可用空间
    const openUp = spaceBelow < wanted && spaceAbove > spaceBelow;
    const maxHeight = Math.max(120, Math.min(wanted, openUp ? spaceAbove : spaceBelow));
    setPosition({
      top: openUp ? Math.max(MENU_MARGIN, rect.top - MENU_GAP - maxHeight) : rect.bottom + MENU_GAP,
      left: Math.max(MENU_MARGIN, Math.min(rect.left, window.innerWidth - width - MENU_MARGIN)),
      width,
      maxHeight,
    });
    setOpen(true);
  };

  // 菜单固定定位在 body 上，不会随内容滚动，所以 Esc / 点空白 / 滚动三条路都要能关；
  // 但它自己超长时内部要能滚，那种滚动不能把菜单关掉。
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    const onScroll = (event: Event) => {
      const target = event?.target as HTMLElement | null;
      if (target?.closest?.('.af-dropdown-menu')) return;
      close();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  const format = (date: string) => (date === today ? `今日 · ${date}` : date);

  return (
    <>
      <button
        type="button"
        className="af-daily-date-trigger"
        onClick={openMenu}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`推荐日期：${format(value)}`}
      >
        <span>{format(value)}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>

      {open && position && createPortal(
        <>
          <div className="af-add-menu-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />
          <div
            className="af-dropdown-menu"
            role="menu"
            style={{
              position: 'fixed',
              top: position.top,
              left: position.left,
              marginTop: 0,
              width: position.width,
              maxHeight: position.maxHeight,
              overflowY: 'auto',
              overscrollBehavior: 'contain',
              zIndex: 9999,
            }}
          >
            {dates.map((date) => {
              const selected = date === value;
              return (
                <button
                  key={date}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  autoFocus={selected}
                  className="af-daily-date-option"
                  onClick={() => {
                    onSelect(date);
                    setOpen(false);
                  }}
                >
                  <span>{format(date)}</span>
                  {selected && <Check size={14} aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </>,
        document.body
      )}
    </>
  );
}

export function DailyRecommendView() {
  const navigate = useNavigate();
  const account = useWyAccountStore((s) => s.account);
  const isWyLoaded = useWyAccountStore((s) => s.isLoaded);
  const daily = useDiscoveryStore((s) => s.daily);
  const dailyLoading = useDiscoveryStore((s) => s.dailyLoading);
  const dailyError = useDiscoveryStore((s) => s.dailyError);
  const dailyDate = useDiscoveryStore((s) => s.dailyDate);
  const dailyHistory = useDiscoveryStore((s) => s.dailyHistory);
  const dailySelectedDate = useDiscoveryStore((s) => s.dailySelectedDate);
  const initializeDaily = useDiscoveryStore((s) => s.initializeDaily);
  const refreshDaily = useDiscoveryStore((s) => s.refreshDaily);
  const selectDailyDate = useDiscoveryStore((s) => s.selectDailyDate);
  const selectToday = useDiscoveryStore((s) => s.selectToday);

  const playNext = usePlayerStore((s) => s.playNext);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const [pendingPlayAction, setPendingPlayAction] = useState<PendingPlayAction>(null);
  const isPlayAllPending = pendingPlayAction === 'play-all';
  const isShufflePending = pendingPlayAction === 'shuffle';
  const dailyCoverUrl = coverSrc(daily[0]?.img || daily[0]?.picUrl || "", DETAIL_COVER_CSS_SIZE);
  const today = (() => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  })();
  const isViewingHistory = Boolean(dailySelectedDate && dailySelectedDate !== today);

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
    void initializeDaily(account?.uid ?? '');
  }, [account?.uid, initializeDaily]);

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
            {dailyCoverUrl ? (
              <img src={dailyCoverUrl} alt={daily[0]?.name || "每日推荐封面"} />
            ) : (
              <div className="af-cover-placeholder" style={{ background: 'var(--af-accent-gradient)' }}>
                <Calendar size={64} color="white" />
              </div>
            )}
          </div>

          <div className="af-playlist-detail-meta">
            <h1>每日歌曲推荐</h1>
            <p className="af-playlist-description">
              根据你的口味，每日 6:00 更新 · {dailyDate || '今日'}
            </p>
            <p className="af-playlist-stats">
              {daily.length} 首歌曲
            </p>

            <div className="af-daily-history-controls">
              <span className="af-daily-history-label">推荐日期</span>
              <DailyDatePicker
                dates={dailyHistory.map((snapshot) => snapshot.date)}
                value={dailySelectedDate}
                today={today}
                disabled={dailyHistory.length === 0 || dailyLoading}
                onSelect={selectDailyDate}
              />
              {isViewingHistory && (
                <button className="af-btn-secondary" type="button" onClick={selectToday}>
                  返回今日
                </button>
              )}
            </div>

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
                onClick={() => isViewingHistory ? selectToday() : refreshDaily()}
                disabled={dailyLoading}
                title={isViewingHistory ? '返回今日推荐' : '重新获取每日推荐'}
              >
                <RefreshCw size={16} className={dailyLoading ? 'af-spin' : ''} />
                <span>{dailyLoading ? '刷新中' : isViewingHistory ? '今日推荐' : '刷新'}</span>
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
                onClick={() => runPlayQueueAction(`track:${index}`, daily, index)}
                title="单击播放"
              >
                <div className="af-col-index">{index + 1}</div>

                <div className="af-col-title">
                  <div className="af-song-cover">
                    {song.img ? (
                      <img src={song.img} alt={song.name} />
                    ) : (
                      <div className="af-cover-placeholder">暂无封面</div>
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
                    onClick={() => playNext(song as any)}
                    title="下一首播放"
                    aria-label="下一首播放"
                  >
                    <CornerDownRight size={14} />
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
