import { Play, Heart, Trash2 } from "lucide-react";
import { useState } from "react";
import { useFavoritesStore } from "@/stores/favoritesStore";
import { usePlayerStore } from "@/stores/playerStore";
import { IconButton } from "@/components/IconButton";
import { SectionHeader } from "@/components/SectionHeader";
import { DownloadQualityButton } from "@/components/DownloadQualityButton";
import { formatDuration } from "@/lib/utils";

type PendingPlayAction = 'play-all' | `track:${number}` | null;

export function FavoritesView() {
  const favorites = useFavoritesStore((s) => s.favorites);
  const removeFavorite = useFavoritesStore((s) => s.removeFavorite);
  const clearFavorites = useFavoritesStore((s) => s.clearFavorites);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const [pendingPlayAction, setPendingPlayAction] = useState<PendingPlayAction>(null);
  const isPlayAllPending = pendingPlayAction === 'play-all';

  const runPlayQueueAction = async (action: Exclude<PendingPlayAction, null>, queueToPlay: typeof favorites, startIndex = 0) => {
    if (pendingPlayAction) return;
    setPendingPlayAction(action);
    try {
      await playQueue(queueToPlay, startIndex);
    } finally {
      setPendingPlayAction(null);
    }
  };

  function handlePlayAll() {
    if (favorites.length > 0) {
      runPlayQueueAction('play-all', favorites, 0);
    }
  }

  function handleClearAll() {
    if (confirm(`确定要清空我的喜欢吗？共 ${favorites.length} 首歌曲。`)) {
      clearFavorites();
    }
  }

  if (favorites.length === 0) {
    return (
      <div className="af-favorites-view">
        <SectionHeader title="我的喜欢" />
        <div className="af-empty-state">
          <Heart size={64} strokeWidth={1.5} />
          <p>还没有喜欢的歌曲</p>
          <span>在歌曲的添加菜单中选择“添加到我的喜欢”</span>
        </div>
      </div>
    );
  }

  return (
    <div className="af-favorites-view">
      <SectionHeader
        title="我的喜欢"
        action={
          <div style={{ display: "flex", gap: "8px" }}>
            <button className="af-section-action" onClick={handlePlayAll}>
              {isPlayAllPending ? '加载中…' : '播放全部'}
            </button>
            <button
              className="af-section-action"
              onClick={handleClearAll}
              style={{ color: "var(--af-error)" }}
            >
              清空
            </button>
          </div>
        }
      />

      <div className="af-favorites-stats">
        共 {favorites.length} 首歌曲
      </div>

      <ol className="af-favorites-list">
        {favorites.map((track, index) => (
          <li
            key={`${track.source}:${track.id}:${index}`}
            className="af-favorites-item"
            onClick={() => playQueue(favorites, index)}
            title="单击播放"
          >
            <span className="af-result-index">{index + 1}</span>

            <div className="af-result-cover">
              {track.img || track.picUrl ? (
                <img src={track.img || track.picUrl} alt="" />
              ) : (
                <div className="af-cover-placeholder">♪</div>
              )}
            </div>

            <div className="af-result-info">
              <div className="af-result-title">{track.name}</div>
              <div className="af-result-subtitle">{track.singer}</div>
            </div>

            <span className="af-result-source">{track.source}</span>

            <span className="af-result-duration">
              {formatDuration(track.interval)}
            </span>

            <div className="af-result-actions">
              <IconButton
                icon={Play}
                ariaLabel="播放"
                size="sm"
                onClick={(e) => { e.stopPropagation(); runPlayQueueAction(`track:${index}`, favorites, index); }}
              />
              <DownloadQualityButton
                song={track}
                iconSize={16}
                title="下载"
              />
              <IconButton
                icon={Trash2}
                ariaLabel="从我的喜欢移除"
                size="sm"
                onClick={(e) => { e.stopPropagation(); removeFavorite(track); }}
              />
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
