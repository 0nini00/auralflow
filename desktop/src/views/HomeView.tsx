import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Radio, Search } from "lucide-react";
import type { PlaylistInfo } from "@lx/core";
import { useWyAccountStore } from "@/stores/wyAccountStore";
import { useDiscoverFeedStore } from "@/stores/discoverFeedStore";
import { usePlayerStore } from "@/stores/playerStore";
import { MusicCard } from "@/components/MusicCard";
import { SectionHeader } from "@/components/SectionHeader";
import { SongAddMenuButton } from "@/components/SongAddMenuButton";
import { CARD_COVER_CSS_SIZE, coverSrc } from "@/utils/imageReferrerPolicy";
import { buildPlaylistDetailPath } from "@/utils/playlistRoute";

/**
 * 发现页。
 *
 * 版式与移动端首页对齐：推荐歌单 + 排行榜。两块数据都来自网易云公开接口
 * （`wyDiscoverService`），与账号无关——未登录进来也有内容可点。
 *
 * 原来的「最近播放」区块已撤掉：播放历史是「我要回到刚才那首」的功能，
 * 不是「发现」；它有自己的页面（歌单页里进得去），放在发现页顶部只会把
 * 真正的推荐内容挤到首屏之外。
 */
export function HomeView() {
  const navigate = useNavigate();
  // 未登录网易云时不渲染依赖账号的入口（私人 FM / 每日推荐由网易云账号提供）
  const account = useWyAccountStore((s) => s.account);
  const playQueue = usePlayerStore((s) => s.playQueue);

  const recommended = useDiscoverFeedStore((s) => s.recommended);
  const recommendedStatus = useDiscoverFeedStore((s) => s.recommendedStatus);
  const recommendedError = useDiscoverFeedStore((s) => s.recommendedError);
  const previewSongs = useDiscoverFeedStore((s) => s.previewSongs);
  const previewBoardName = useDiscoverFeedStore((s) => s.previewBoardName);
  const previewStatus = useDiscoverFeedStore((s) => s.previewStatus);
  const previewError = useDiscoverFeedStore((s) => s.previewError);
  const load = useDiscoverFeedStore((s) => s.load);

  useEffect(() => {
    void load();
  }, [load]);

  const openPlaylist = (playlist: PlaylistInfo) => {
    navigate(buildPlaylistDetailPath(playlist), { state: { playlist } });
  };

  return (
    <div className="af-home-view af-animate-slide-in">
      <section className="af-home-hero">
        <div className="af-home-hero-copy">
          <span className="af-home-eyebrow">AuralFlow</span>
          <h1 className="af-heading-1">发现音乐</h1>
          <p className="af-text-body">
            热门歌单与榜单试读都在这里，点开就是完整的歌单；想听什么也可以直接搜索。
          </p>
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
          title="推荐歌单"
          action={{ label: "更多", onClick: () => navigate("/playlist-square") }}
        />
        {recommendedStatus === "loading" && recommended.length === 0 ? (
          <div className="af-discover-loading" role="status">正在加载推荐歌单…</div>
        ) : recommendedStatus === "error" ? (
          <div className="af-discover-notice" role="status">
            {recommendedError}
            <button
              type="button"
              className="af-btn-secondary"
              style={{ marginLeft: 12 }}
              onClick={() => { void load({ force: true }); }}
            >
              重试
            </button>
          </div>
        ) : (
          <div className="af-discover-grid">
            {recommended.map((playlist) => (
              <MusicCard
                key={`${playlist.source}:${playlist.id}`}
                title={playlist.name}
                subtitle={playlist.author}
                coverUrl={playlist.picUrl ? coverSrc(playlist.picUrl, CARD_COVER_CSS_SIZE) : undefined}
                onClick={() => openPlaylist(playlist)}
              />
            ))}
          </div>
        )}
      </section>

      <section className="af-home-section">
        <SectionHeader
          title={previewBoardName ? `排行榜 · ${previewBoardName}` : "排行榜"}
          action={{ label: "更多", onClick: () => navigate("/charts") }}
        />
        {previewStatus === "loading" && previewSongs.length === 0 ? (
          <div className="af-discover-loading" role="status">正在加载榜单…</div>
        ) : previewStatus === "error" ? (
          <div className="af-discover-notice" role="status">
            {previewError}
            <button
              type="button"
              className="af-btn-secondary"
              style={{ marginLeft: 12 }}
              onClick={() => { void load({ force: true }); }}
            >
              重试
            </button>
          </div>
        ) : (
          <div className="af-discover-grid">
            {previewSongs.map((track, index) => (
              <MusicCard
                key={`${track.source}:${track.id}`}
                title={track.name}
                subtitle={track.singer}
                coverUrl={coverSrc(track.img || track.picUrl, CARD_COVER_CSS_SIZE)}
                onPlay={() => { void playQueue(previewSongs, index); }}
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
