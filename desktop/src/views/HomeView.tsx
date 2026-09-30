import { Play, Radio, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useWyAccountStore } from "@/stores/wyAccountStore";
import { MusicCard } from "@/components/MusicCard";
import { SectionHeader } from "@/components/SectionHeader";
import { SongAddMenuButton } from "@/components/SongAddMenuButton";
import { toCoverSrc } from "@/utils/imageReferrerPolicy";
import { usePlayerStore } from "@/stores/playerStore";
import { useHistoryStore } from "@/stores/historyStore";

export function HomeView() {
  const navigate = useNavigate();
  const recent = useHistoryStore((s) => s.history);
  // 未登录网易云时不渲染依赖账号的入口（私人 FM / 每日推荐由网易云账号提供）
  const account = useWyAccountStore((s) => s.account);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const recentPreview = recent.slice(0, 10);

  return (
    <div className="af-home-view af-animate-slide-in">
      <section className="af-home-hero">
        <div className="af-home-hero-copy">
          <span className="af-home-eyebrow">AuralFlow</span>
          <h1 className="af-heading-1">发现音乐</h1>
          <p className="af-text-body">从搜索和本地曲库开始，把想听的歌快速接到播放队列里。</p>
        </div>
        <div className="af-home-hero-actions">
          {account ? (
            <button type="button" className="af-home-primary-action" onClick={() => navigate("/fm")}>
              <Radio size={18} />
              私人 FM
            </button>
          ) : null}
          <button type="button" className="af-home-secondary-action" onClick={() => navigate("/search")}>
            <Search size={18} />
            搜索音乐
          </button>
        </div>
      </section>

      <section className="af-home-section">
        <SectionHeader
          title="最近播放"
          action={
            recent.length > 0
              ? {
                  label: "播放全部",
                  onClick: () => { void playQueue(recent, 0); },
                }
              : undefined
          }
        />

        {recentPreview.length === 0 ? (
          <div className="af-empty-state af-home-empty-state">
            <Play size={28} />
            <p>还没有播放过歌曲</p>
            <span>搜索并播放一些音乐后，这里会显示你的最近播放。</span>
          </div>
        ) : (
          <div className="af-home-recent-grid">
            {recentPreview.map((track, index) => (
              <MusicCard
                key={`${track.source}:${track.id}`}
                title={track.name}
                subtitle={`${track.singer}${track.albumName ? ` / ${track.albumName}` : ""}`}
                coverUrl={toCoverSrc(track.img || track.picUrl)}
                onPlay={() => { void playQueue(recent, index); }}
                actions={
                  <SongAddMenuButton
                    song={track}
                    className="af-music-card-action-btn"
                    iconSize={15}
                    title="添加到我的喜欢或歌单"
                  />
                }
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
