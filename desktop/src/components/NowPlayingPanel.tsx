import { useState } from "react";
import { Download, MoreHorizontal, Music2, X } from "lucide-react";
import { usePlayerStore } from "@/stores/playerStore";
import { useUiStore } from "@/stores/uiStore";
import { useLyrics } from "@/hooks/useLyrics";
import { coverSrc, NP_COVER_CSS_SIZE, ROW_COVER_CSS_SIZE } from "@/utils/imageReferrerPolicy";
import { formatTime } from "@/utils/formatTime";
import { SongAddMenuButton } from "@/components/SongAddMenuButton";

/**
 * 「正在播放」右栏。
 *
 * 队列从弹层挪到这里：弹层一开就盖住内容、且切歌时看不到下一首。
 * 封面与歌词复用播放条已有的数据源，不额外发请求。
 */
export function NowPlayingPanel() {
  const close = useUiStore((s) => s.setNowPlayingOpen);
  const [tab, setTab] = useState<"queue" | "lyrics">("queue");
  const current = usePlayerStore((s) => s.current);
  const queueLength = usePlayerStore((s) => s.queue.length);

  const coverUrl = current ? coverSrc(current.img || current.picUrl || "", NP_COVER_CSS_SIZE) : "";

  return (
    <aside className="af-now-playing" aria-label="正在播放">
      <div className="af-np-head">
        <span className="af-np-title">正在播放</span>
        <button type="button" className="af-icon-btn af-icon-btn-sm" onClick={() => close(false)} aria-label="收起正在播放面板">
          <X size={16} strokeWidth={1.8} />
        </button>
      </div>

      <div className="af-np-tabs" role="tablist" aria-label="正在播放视图">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "queue"}
          className={`af-np-tab ${tab === "queue" ? "af-active" : ""}`}
          onClick={() => setTab("queue")}
        >
          播放队列
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "lyrics"}
          className={`af-np-tab ${tab === "lyrics" ? "af-active" : ""}`}
          onClick={() => setTab("lyrics")}
        >
          歌词
        </button>
      </div>

      {current ? (
        <>
          <div className="af-np-cover">
            {coverUrl ? (
              <img src={coverUrl} alt="" className="af-np-cover-img" />
            ) : (
              <div className="af-np-cover-placeholder" aria-hidden="true">
                <Music2 size={28} strokeWidth={1.5} />
              </div>
            )}
          </div>
          <div className="af-np-song" title={current.name}>{current.name}</div>
          <div className="af-np-artist" title={current.singer}>{current.singer}</div>
          <div className="af-np-tools">
            <SongAddMenuButton song={current} className="af-icon-btn af-icon-btn-sm" iconSize={16} title="添加到我的喜欢或歌单" />
            <button type="button" className="af-icon-btn af-icon-btn-sm" aria-label="下载" title="下载">
              <Download size={16} strokeWidth={1.8} />
            </button>
            <button type="button" className="af-icon-btn af-icon-btn-sm" aria-label="更多" title="更多">
              <MoreHorizontal size={16} strokeWidth={1.8} />
            </button>
          </div>
        </>
      ) : (
        <div className="af-np-empty">还没有正在播放的歌曲</div>
      )}

      {tab === "queue" ? <QueueList /> : <LyricsPane />}

      {tab === "queue" && queueLength === 0 && <div className="af-np-hint">队列是空的，从任意列表播放一首就会出现在这里</div>}
    </aside>
  );
}

function QueueList() {
  const queue = usePlayerStore((s) => s.queue);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const playByIndex = usePlayerStore((s) => s.playByIndex);
  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue);

  const upcoming = queue.length - currentIndex - 1;

  return (
    <div className="af-np-body">
      <div className="af-np-queue-label">
        <span>{upcoming > 0 ? `接下来 ${upcoming} 首` : "队列"}</span>
        <span>{queue.length} 首</span>
      </div>
      {queue.map((song, index) => {
        const active = index === currentIndex;
        return (
          <div
            key={`${song.source}:${song.id}:${index}`}
            className={`af-np-row ${active ? "af-active" : ""}`}
            onDoubleClick={() => playByIndex(index)}
          >
            <span className="af-np-row-index">
              {active ? (
                <span className="af-playing-bars" aria-label="正在播放">
                  <i /><i /><i />
                </span>
              ) : (
                index + 1
              )}
            </span>
            <button type="button" className="af-np-row-main" onClick={() => playByIndex(index)} title={song.name}>
              <span className="af-np-row-cover">
                {song.img || song.picUrl ? (
                  <img src={coverSrc(song.img || song.picUrl, ROW_COVER_CSS_SIZE)} alt="" />
                ) : null}
              </span>
              <span className="af-np-row-text">
                <span className="af-np-row-name">{song.name}</span>
                <span className="af-np-row-artist">{song.singer}</span>
              </span>
            </button>
            <span className="af-np-row-dur">{formatTime(song.interval ?? 0)}</span>
            <button
              type="button"
              className="af-np-row-remove af-icon-btn af-icon-btn-sm"
              aria-label={`从队列移除 ${song.name}`}
              onClick={() => removeFromQueue(index)}
            >
              <X size={13} strokeWidth={2} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function LyricsPane() {
  const current = usePlayerStore((s) => s.current);
  const progress = usePlayerStore((s) => s.progress);
  const { lyrics, currentLine, isLoading } = useLyrics(current, progress);

  if (!current) return <div className="af-np-hint">还没有正在播放的歌曲</div>;
  if (isLoading && lyrics.length === 0) return <div className="af-np-hint">正在加载歌词…</div>;
  if (lyrics.length === 0) return <div className="af-np-hint">这首歌没有歌词</div>;

  return (
    <div className="af-np-lyrics">
      {lyrics.map((line, index) => (
        <p
          key={`${line.time}-${index}`}
          className={`af-np-lyric ${index === currentLine ? "af-active" : ""}`}
        >
          {line.text || "♪"}
        </p>
      ))}
    </div>
  );
}
