import { useMemo, useState } from "react";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  History,
  Play,
  Shuffle,
  ListPlus,
  Download,
  CornerDownRight,
} from "lucide-react";
import { DownloadQualityMenu } from "@/components/DownloadQualityButton";
import { HistoryCalendar } from "@/components/HistoryCalendar";
import { SongAddMenu } from "@/components/SongAddMenuButton";
import { VirtualList } from "@/components/VirtualList";
import { EmptyState } from "@/components/ui";
import { formatDuration } from "@/lib/utils";
import { useHistoryStore } from "@/stores/historyStore";
import { usePlayerStore } from "@/stores/playerStore";
import {
  addDays,
  dayStartOf,
  filterEntriesByDay,
  formatHistoryDayTitle,
  isUsablePlayedAt,
  shuffleItems,
  type MusicInfo,
} from "@lx/core";
import { DETAIL_COVER_CSS_SIZE, ROW_COVER_CSS_SIZE, coverSrc } from "@/utils/imageReferrerPolicy";

/** 时间未知的条目不是任何一天，用 0 作为哨兵（日期时间戳不会为 0）。 */
const UNKNOWN_DAY = 0;

export function HistoryView() {
  const entries = useHistoryStore((s) => s.entries);
  const playNext = usePlayerStore((s) => s.playNext);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const [selectedDay, setSelectedDay] = useState(() => dayStartOf(Date.now()));
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [addMenu, setAddMenu] = useState<{ song: MusicInfo; anchor: HTMLElement } | null>(null);
  const [downloadMenu, setDownloadMenu] = useState<{ song: MusicInfo; anchor: HTMLElement } | null>(null);

  const todayStart = dayStartOf(Date.now());
  const recordedDays = useMemo(
    () => entries.filter((entry) => isUsablePlayedAt(entry.playedAt)).map((entry) => dayStartOf(entry.playedAt)),
    [entries],
  );
  const unknownEntries = useMemo(
    () => entries.filter((entry) => !isUsablePlayedAt(entry.playedAt)),
    [entries],
  );
  const dayEntries = useMemo(
    () => (selectedDay === UNKNOWN_DAY
      ? unknownEntries
      : filterEntriesByDay(entries, selectedDay)),
    [entries, selectedDay, unknownEntries],
  );
  const songs = useMemo(() => dayEntries.map((entry) => entry.song), [dayEntries]);
  const historyCover = coverSrc(
    entries[0]?.song.img || entries[0]?.song.picUrl || "",
    DETAIL_COVER_CSS_SIZE,
  );

  const isUnknownDay = selectedDay === UNKNOWN_DAY;
  const canGoNext = !isUnknownDay && selectedDay < todayStart;
  const dayTitle = isUnknownDay ? "时间未知" : formatHistoryDayTitle(selectedDay);

  const goPrev = () => {
    if (isUnknownDay) return;
    setSelectedDay((day) => addDays(day, -1));
  };
  const goNext = () => {
    if (!canGoNext) return;
    setSelectedDay((day) => addDays(day, 1));
  };

  return (
    <div className="af-playlist-detail-view af-history-view">
      <div className="af-playlist-detail-header">
        <div className="af-playlist-detail-info">
          <div className="af-playlist-detail-cover af-history-cover">
            {historyCover ? (
              <img src={historyCover} alt="" />
            ) : (
              <div className="af-cover-placeholder">
                <History size={64} strokeWidth={1.5} />
              </div>
            )}
          </div>

          <div className="af-playlist-detail-meta">
            <h1>播放历史</h1>
            <p className="af-playlist-stats">
              {entries.length} 条记录
              {!isUnknownDay && songs.length > 0 ? ` · 当天 ${songs.length} 首` : ""}
            </p>
            <div className="af-playlist-actions">
              <button
                className="af-btn-primary"
                onClick={() => songs.length > 0 && void playQueue(songs, 0)}
                disabled={songs.length === 0}
              >
                <Play size={16} fill="currentColor" />
                <span>播放全部</span>
              </button>
              <button
                className="af-btn-secondary"
                onClick={() => songs.length > 0 && void playQueue(shuffleItems(songs), 0)}
                disabled={songs.length === 0}
              >
                <Shuffle size={16} />
                <span>随机播放</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="af-playlist-songs">
        {entries.length === 0 ? (
          <EmptyState
            icon={History}
            title="还没有播放历史"
            description="播放歌曲后，这里会按天记录最近听过的内容。"
          />
        ) : (
          <>
            <div className="af-history-daybar">
              <div className="af-history-daynav">
                <button
                  type="button"
                  className="af-history-daystep"
                  aria-label="前一天"
                  disabled={isUnknownDay}
                  onClick={goPrev}
                >
                  <ChevronLeft size={18} />
                </button>
                <div className="af-history-daypicker">
                  <button
                    type="button"
                    className="af-history-daytitle"
                    aria-haspopup="dialog"
                    aria-expanded={calendarOpen}
                    onClick={() => setCalendarOpen((open) => !open)}
                  >
                    <CalendarDays size={16} />
                    <span>{dayTitle}</span>
                    <ChevronDown size={14} />
                  </button>
                  {calendarOpen && (
                    <HistoryCalendar
                      recordedDays={recordedDays}
                      selectedDay={selectedDay}
                      onSelect={(day) => setSelectedDay(day)}
                      onClose={() => setCalendarOpen(false)}
                    />
                  )}
                </div>
                <button
                  type="button"
                  className="af-history-daystep"
                  aria-label="后一天"
                  disabled={!canGoNext}
                  onClick={goNext}
                >
                  <ChevronRight size={18} />
                </button>
              </div>

              {unknownEntries.length > 0 && (
                <button
                  type="button"
                  className={`af-history-unknown${isUnknownDay ? " is-active" : ""}`}
                  aria-pressed={isUnknownDay}
                  onClick={() => setSelectedDay(isUnknownDay ? todayStart : UNKNOWN_DAY)}
                >
                  时间未知 {unknownEntries.length}
                </button>
              )}
            </div>

            {songs.length === 0 ? (
              <EmptyState
                icon={History}
                title={isUnknownDay ? "没有时间未知的记录" : "当天没有播放记录"}
                description={isUnknownDay ? "所有记录都带真实播放时间。" : "换一天看看，或继续播放歌曲。"}
              />
            ) : (
              <>
                <div className="af-song-list-header">
                  <div className="af-col-index">#</div>
                  <div className="af-col-title">标题</div>
                  <div className="af-col-artist">艺术家</div>
                  <div className="af-col-album">专辑</div>
                  <div className="af-col-duration">
                    <Clock size={16} />
                  </div>
                  <div className="af-col-actions" />
                </div>
                <div className="af-song-list-body">
                  {/* 定高行（封面 40 + 上下内边距 20）：单日最多 2000 条，只挂可见区 + overscan */}
                  <VirtualList
                    items={songs}
                    rowHeight={52}
                    className="af-song-list-virtual"
                    scrollRootSelector=".af-content-scroll"
                    getItemKey={(song, index) => `${song.source}-${song.id}-${index}`}
                    onScroll={() => {
                      setAddMenu(null);
                      setDownloadMenu(null);
                    }}
                    renderItem={(song, index) => (
                      <div
                        className="af-song-list-row"
                        onClick={() => { void playQueue(songs, index); }}
                      >
                        <div className="af-col-index">{index + 1}</div>
                        <div className="af-col-title">
                          <div className="af-song-cover">
                            {song.img || song.picUrl ? (
                              <img
                                src={coverSrc(song.img || song.picUrl || "", ROW_COVER_CSS_SIZE)}
                                alt=""
                                loading="lazy"
                              />
                            ) : (
                              <div className="af-cover-placeholder" />
                            )}
                          </div>
                          <span>{song.name}</span>
                        </div>
                        <div className="af-col-artist">{song.singer || "-"}</div>
                        <div className="af-col-album">{song.albumName || "-"}</div>
                        <div className="af-col-duration">{formatDuration(song.interval || 0)}</div>
                        <div className="af-col-actions" onClick={(event) => event.stopPropagation()}>
                          <button
                            className="af-action-btn"
                            onClick={() => playNext(song)}
                            title="下一首播放"
                            aria-label="下一首播放"
                          >
                            <CornerDownRight size={14} />
                          </button>
                          <button
                            className="af-action-btn"
                            onClick={(event) => {
                              event.stopPropagation();
                              setAddMenu({ song, anchor: event.currentTarget });
                            }}
                            title="添加到我的喜欢或歌单"
                            aria-label="添加到我的喜欢或歌单"
                            aria-haspopup="menu"
                            aria-expanded={addMenu?.song === song}
                          >
                            <ListPlus size={14} />
                          </button>
                          <button
                            className="af-action-btn"
                            onClick={(event) => {
                              event.stopPropagation();
                              setDownloadMenu({ song, anchor: event.currentTarget });
                            }}
                            title="下载"
                            aria-label="下载"
                            aria-haspopup="menu"
                            aria-expanded={downloadMenu?.song === song}
                          >
                            <Download size={14} />
                          </button>
                        </div>
                      </div>
                    )}
                  />
                </div>
              </>
            )}
          </>
        )}
      </div>

      {addMenu && (
        <SongAddMenu
          key={`${addMenu.song.source}:${addMenu.song.id}`}
          song={addMenu.song}
          anchor={addMenu.anchor}
          onClose={() => setAddMenu(null)}
        />
      )}

      {downloadMenu && (
        <DownloadQualityMenu
          key={`${downloadMenu.song.source}:${downloadMenu.song.id}`}
          song={downloadMenu.song}
          anchor={downloadMenu.anchor}
          onClose={() => setDownloadMenu(null)}
        />
      )}
    </div>
  );
}
