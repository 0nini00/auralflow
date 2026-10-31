import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Headphones, LayoutGrid, RefreshCw } from "lucide-react";
import {
  formatPlayCount,
  WY_PLAYLIST_CATEGORIES,
  type PlaylistInfo,
} from "@lx/core";
import { fetchWyPlaylistsByCategory } from "@/services/wyDiscoverService";
import { coverSrc, CARD_COVER_CSS_SIZE } from "@/utils/imageReferrerPolicy";
import { buildPlaylistDetailPath } from "@/utils/playlistRoute";

/** 每页歌单数。桌面宽度下一行能放 5–6 张，24 张约四行，滚一轮就到下一批。 */
const PAGE_SIZE = 24;

type PageStatus = "idle" | "loading" | "ready" | "error";

/**
 * 歌单广场。
 *
 * 与移动端的口径一致：内置分类（`@lx/core` 的 `WY_PLAYLIST_CATEGORIES`，
 * `/api/playlist/catlist` 已下线）、固定热门排序、滚动到底自动续页。
 *
 * 分页偏移按**请求页大小**推进，而不是按已渲染条目数：接口的 offset 是它自己的
 * 序号空间，万一映射层过滤掉脏数据，用渲染数推进就会重复拉同一批、甚至原地打转。
 */
export function PlaylistSquareView() {
  const navigate = useNavigate();
  const [category, setCategory] = useState<string>(WY_PLAYLIST_CATEGORIES[0]);
  const [playlists, setPlaylists] = useState<PlaylistInfo[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [status, setStatus] = useState<PageStatus>("idle");
  const [error, setError] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState("");

  // 代次：切分类/切排序会让在途请求作废，避免旧分类的响应覆盖新分类的列表。
  const generation = useRef(0);
  const offset = useRef(0);
  const loadingMoreRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const loadPage = useCallback(async (
    nextCategory: string,
    mode: "reset" | "more",
  ) => {
    const reset = mode === "reset";
    if (!reset && loadingMoreRef.current) return;
    const requestGeneration = ++generation.current;
    if (reset) {
      setStatus("loading");
      setError("");
      setMoreError("");
      offset.current = 0;
      setHasMore(true);
    } else {
      loadingMoreRef.current = true;
      setLoadingMore(true);
      setMoreError("");
    }

    const requestOffset = reset ? 0 : offset.current;
    try {
      const page = await fetchWyPlaylistsByCategory(nextCategory, "hot", PAGE_SIZE, requestOffset);
      if (requestGeneration !== generation.current) return;
      offset.current = requestOffset + PAGE_SIZE;
      setPlaylists((previous) => (reset ? page.playlists : [...previous, ...page.playlists]));
      setHasMore(page.hasMore);
      setStatus("ready");
    } catch (loadError) {
      if (requestGeneration !== generation.current) return;
      const message = loadError instanceof Error ? loadError.message : "歌单加载失败";
      if (reset) {
        setStatus("error");
        setError(message);
      } else {
        // 续页失败不动已有列表：用户还能听已经看到的那些歌单。
        setMoreError(message);
      }
    } finally {
      if (requestGeneration === generation.current) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadPage(category, "reset");
  }, [category, loadPage]);

  // 触底自动续页。没有 IntersectionObserver（测试环境、极老内核）时按钮仍在，
  // 手动点一样能加载，只是少了「滚到底就长出来」的顺滑。
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      if (status !== "ready" || !hasMore || loadingMoreRef.current || moreError) return;
      void loadPage(category, "more");
    }, { rootMargin: "400px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [category, status, hasMore, moreError, loadPage]);

  const openPlaylist = (playlist: PlaylistInfo) => {
    navigate(buildPlaylistDetailPath(playlist), { state: { playlist } });
  };

  const canLoadMore = hasMore && status === "ready" && !loadingMore;

  return (
    <div className="af-discover-page af-animate-slide-in">
      <header className="af-discover-head">
        <div className="af-discover-head-copy">
          <span className="af-home-eyebrow">网易云音乐</span>
          <h1 className="af-heading-1">歌单广场</h1>
          <p className="af-text-body">
            按分类翻公开歌单，挑中的直接进详情页播放或加入队列。
          </p>
        </div>
        <button
          type="button"
          className="af-btn-secondary af-discover-refresh"
          onClick={() => { void loadPage(category, "reset"); }}
          disabled={status === "loading"}
        >
          <RefreshCw size={16} className={status === "loading" ? "af-spin" : undefined} />
          {status === "loading" ? "刷新中" : "刷新"}
        </button>
      </header>

      <div className="af-square-toolbar">
        <div className="af-chip-group" role="group" aria-label="歌单分类">
          {WY_PLAYLIST_CATEGORIES.map((item) => (
            <button
              key={item}
              type="button"
              className={`af-chip ${item === category ? "af-chip-active" : ""}`}
              aria-pressed={item === category}
              onClick={() => { if (item !== category) setCategory(item); }}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      {status === "error" ? (
        <div className="af-empty-state af-discover-empty">
          <LayoutGrid size={28} />
          <p>歌单加载失败</p>
          <span>{error}</span>
          <button
            type="button"
            className="af-btn-secondary"
            onClick={() => { void loadPage(category, "reset"); }}
          >
            重试
          </button>
        </div>
      ) : status === "loading" && playlists.length === 0 ? (
        <div className="af-discover-loading" role="status">正在加载歌单…</div>
      ) : playlists.length === 0 ? (
        <div className="af-empty-state af-discover-empty">
          <LayoutGrid size={28} />
          <p>这个分类下没有取到歌单</p>
          <span>换个分类或稍后再试。</span>
        </div>
      ) : (
        <>
          <div className="af-playlist-square-grid">
            {playlists.map((playlist) => {
              const cover = playlist.picUrl;
              const countText = formatPlayCount(playlist.playCount);
              return (
                <button
                  key={`${playlist.source}:${playlist.id}`}
                  type="button"
                  className="af-playlist-square-card"
                  onClick={() => openPlaylist(playlist)}
                  aria-label={`打开歌单 ${playlist.name}`}
                >
                  <span className="af-playlist-square-cover">
                    {cover ? (
                      <img src={coverSrc(cover, CARD_COVER_CSS_SIZE)} alt="" loading="lazy" />
                    ) : (
                      <span className="af-cover-placeholder" aria-hidden="true" />
                    )}
                    {countText ? (
                      <span className="af-playlist-square-count">
                        <Headphones size={12} aria-hidden="true" />
                        {countText}
                      </span>
                    ) : null}
                  </span>
                  <span className="af-playlist-square-name" title={playlist.name}>{playlist.name}</span>
                  {playlist.author ? (
                    <span className="af-playlist-square-author" title={playlist.author}>
                      {playlist.author}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          <div className="af-square-footer" ref={sentinelRef}>
            {moreError ? (
              <>
                <span className="af-square-footer-error">{moreError}</span>
                <button
                  type="button"
                  className="af-btn-secondary"
                  onClick={() => { void loadPage(category, "more"); }}
                >
                  重试
                </button>
              </>
            ) : canLoadMore ? (
              <button
                type="button"
                className="af-btn-secondary"
                onClick={() => { void loadPage(category, "more"); }}
                disabled={loadingMore}
              >
                {loadingMore ? "加载中…" : "加载更多"}
              </button>
            ) : (
              <span className="af-square-footer-end">
                {hasMore ? "滚动到底自动加载" : "没有更多歌单了"}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
