import { useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Music2, RefreshCw, Trophy } from "lucide-react";
import { groupLeaderboards, type PlaylistInfo, type WyLeaderboardBoard } from "@lx/core";
import { SectionHeader } from "@/components/SectionHeader";
import { useDiscoverFeedStore } from "@/stores/discoverFeedStore";
import { coverSrc } from "@/utils/imageReferrerPolicy";
import { buildPlaylistDetailPath } from "@/utils/playlistRoute";

/** 官方榜大卡封面边长。 */
const BOARD_COVER_CSS_SIZE = 96;
/** 其余分组的网格封面边长。 */
const TILE_COVER_CSS_SIZE = 120;

/**
 * 榜单 → 歌单。榜单在接口层面就是歌单，详情页不需要知道「这是榜单」。
 *
 * trackCount 给 100 是因为榜单接口固定回 100 条；这里不为了显示一个数字再去请求
 * 详情，列表页不展示曲目数，它只用于详情页在加载前的占位。
 */
function boardToPlaylist(board: WyLeaderboardBoard): PlaylistInfo {
  return {
    id: board.id,
    name: board.name,
    author: "网易云音乐",
    picUrl: board.coverUrl,
    trackCount: 100,
    source: "wy",
  };
}

/**
 * 排行榜页。
 *
 * 分级展示：官方榜（飙升/新歌/原创/热歌）是大多数人的入口，给大卡 + TOP3 试读；
 * 语种/流派/场景是「知道自己在找什么」才会去的地方，给紧凑网格。
 *
 * 榜单清单来自内置表（`@lx/core`），接口失败时也不会空页面——此时只少了封面、
 * 更新频率和 TOP3，`boardsDegraded` 会把这个降级说出来，而不是假装一切正常。
 */
export function LeaderboardView() {
  const navigate = useNavigate();
  const boards = useDiscoverFeedStore((state) => state.boards);
  const status = useDiscoverFeedStore((state) => state.boardsStatus);
  const error = useDiscoverFeedStore((state) => state.boardsError);
  const degraded = useDiscoverFeedStore((state) => state.boardsDegraded);
  const load = useDiscoverFeedStore((state) => state.load);

  useEffect(() => {
    void load();
  }, [load]);

  const openBoard = useCallback((board: WyLeaderboardBoard) => {
    navigate(buildPlaylistDetailPath({ id: board.id, source: "wy" }), {
      state: { playlist: boardToPlaylist(board) },
    });
  }, [navigate]);

  const sections = groupLeaderboards(boards);
  const loading = status === "loading" && boards.length === 0;

  return (
    <div className="af-discover-page af-animate-slide-in">
      <header className="af-discover-head">
        <div className="af-discover-head-copy">
          <span className="af-home-eyebrow">网易云音乐</span>
          <h1 className="af-heading-1">排行榜</h1>
          <p className="af-text-body">
            榜单就是歌单：点进去就是完整曲目，可以直接播放、加入队列或收藏。
          </p>
        </div>
        <button
          type="button"
          className="af-btn-secondary af-discover-refresh"
          onClick={() => { void load({ force: true }); }}
          disabled={status === "loading"}
        >
          <RefreshCw size={16} className={status === "loading" ? "af-spin" : undefined} />
          {status === "loading" ? "刷新中" : "刷新"}
        </button>
      </header>

      {degraded ? (
        <div className="af-discover-notice" role="status">
          榜单封面与更新频率暂时取不到，榜单内容仍可正常打开。
        </div>
      ) : null}

      {status === "error" ? (
        <div className="af-empty-state af-discover-empty">
          <Trophy size={28} />
          <p>排行榜加载失败</p>
          <span>{error}</span>
          <button type="button" className="af-btn-secondary" onClick={() => { void load({ force: true }); }}>
            重试
          </button>
        </div>
      ) : loading ? (
        <div className="af-discover-loading" role="status">正在加载榜单…</div>
      ) : (
        sections.map((section) => (
          <section className="af-home-section" key={section.key}>
            <SectionHeader title={section.title} />
            {section.key === "official" ? (
              <div className="af-board-list">
                {section.boards.map((board) => (
                  <button
                    key={board.id}
                    type="button"
                    className="af-board-card"
                    onClick={() => openBoard(board)}
                    aria-label={`打开榜单 ${board.name}`}
                  >
                    <span className="af-board-card-cover">
                      {board.coverUrl ? (
                        <img
                          src={coverSrc(board.coverUrl, BOARD_COVER_CSS_SIZE)}
                          alt=""
                          loading="lazy"
                        />
                      ) : (
                        <span className="af-cover-placeholder" aria-hidden="true">
                          <Music2 size={24} />
                        </span>
                      )}
                    </span>
                    <span className="af-board-card-body">
                      <span className="af-board-card-title-row">
                        <span className="af-board-card-title">{board.name}</span>
                        {board.updateFrequency ? (
                          <span className="af-board-card-badge">{board.updateFrequency}</span>
                        ) : null}
                      </span>
                      {board.topSongs && board.topSongs.length > 0 ? (
                        <span className="af-board-card-songs">
                          {board.topSongs.slice(0, 3).map((song, index) => (
                            <span className="af-board-card-song" key={`${song.title}-${index}`}>
                              <span className="af-board-card-rank">{index + 1}</span>
                              <span className="af-board-card-song-name">{song.title}</span>
                              <span className="af-board-card-artist">{song.artist}</span>
                            </span>
                          ))}
                        </span>
                      ) : (
                        <span className="af-board-card-hint">查看完整榜单</span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="af-board-grid">
                {section.boards.map((board) => (
                  <button
                    key={board.id}
                    type="button"
                    className="af-board-tile"
                    onClick={() => openBoard(board)}
                    aria-label={`打开榜单 ${board.name}`}
                  >
                    <span className="af-board-tile-cover">
                      {board.coverUrl ? (
                        <img
                          src={coverSrc(board.coverUrl, TILE_COVER_CSS_SIZE)}
                          alt=""
                          loading="lazy"
                        />
                      ) : (
                        <span className="af-cover-placeholder" aria-hidden="true" />
                      )}
                    </span>
                    <span className="af-board-tile-name" title={board.name}>{board.name}</span>
                    {board.updateFrequency ? (
                      <span className="af-board-tile-freq">{board.updateFrequency}</span>
                    ) : null}
                  </button>
                ))}
              </div>
            )}
          </section>
        ))
      )}
    </div>
  );
}
