import { useEffect } from "react";
import { Layers } from "lucide-react";
import { useBiliAccountStore } from "@/stores/biliAccountStore";
import { getBiliCookie } from "@/services/biliAccountService";
import { getImageReferrerPolicy, toCoverSrc } from "@/utils/imageReferrerPolicy";
import { VirtualList } from "@/components/VirtualList";

/** B站合集管理列表每行固定高度（行高 78 + 行间距 10）。 */
const BILI_ROW_HEIGHT = 88;

export function BiliCollectionsView() {
  const biliAccount = useBiliAccountStore((s) => s.account);
  const biliPlaylists = useBiliAccountStore((s) => s.playlists);
  const hiddenBiliCollectionIds = useBiliAccountStore((s) => s.hiddenCollectionIds);
  const newBiliCollectionIds = useBiliAccountStore((s) => s.newCollectionIds);
  const autoShowNewBiliCollections = useBiliAccountStore((s) => s.autoShowNewCollections);
  const setBiliCollectionVisible = useBiliAccountStore((s) => s.setCollectionVisible);
  const setAutoShowNewBiliCollections = useBiliAccountStore((s) => s.setAutoShowNewCollections);
  const clearNewBiliCollectionState = useBiliAccountStore((s) => s.clearNewCollectionState);
  const biliLoading = useBiliAccountStore((s) => s.isLoading);
  const biliLoaded = useBiliAccountStore((s) => s.isLoaded);
  const biliError = useBiliAccountStore((s) => s.error);
  const biliLoad = useBiliAccountStore((s) => s.load);

  const hiddenBiliIdSet = new Set(hiddenBiliCollectionIds);
  const newBiliIdSet = new Set(newBiliCollectionIds);
  const visibleCount = biliPlaylists.filter((p) => !hiddenBiliIdSet.has(p.id)).length;

  useEffect(() => {
    clearNewBiliCollectionState();
    if (biliLoaded || biliLoading) return;
    getBiliCookie().then((cookie) => {
      if (cookie) void biliLoad(cookie);
    });
  }, [biliLoad, biliLoaded, biliLoading, clearNewBiliCollectionState]);

  return (
    <div className="af-bili-collections-view">
      <div className="af-bili-collections-header">
        <div>
          <span className="af-page-kicker">B站</span>
          <h1>合集管理</h1>
          <p>
            {biliAccount
              ? `${biliAccount.nickname} · 显示 ${visibleCount}/${biliPlaylists.length} 个合集`
              : "在设置里保存 B站 Cookie 后同步"}
          </p>
        </div>
      </div>

      <label className="af-bili-auto-row">
        <input
          type="checkbox"
          checked={autoShowNewBiliCollections}
          onChange={(event) => setAutoShowNewBiliCollections(event.target.checked)}
        />
        <span className="af-bili-visibility-switch" aria-hidden="true" />
        <span>
          <strong>新合集自动显示</strong>
          <small>关闭后，新收藏的合集会先进入管理列表，确认后再显示。</small>
        </span>
      </label>

      {biliLoading && (
        <div className="af-inline-state">正在加载 B站收藏合集...</div>
      )}

      {!biliLoading && biliError && (
        <div className="af-inline-state af-inline-error">{biliError}</div>
      )}

      {!biliLoading && !biliError && biliLoaded && biliPlaylists.length === 0 && (
        <div className="af-inline-state">还没有同步到 B站收藏合集</div>
      )}

      {!biliLoading && !biliError && biliPlaylists.length > 0 && (
        <VirtualList
          items={biliPlaylists}
          rowHeight={BILI_ROW_HEIGHT}
          className="af-bili-collection-list"
          scrollRootSelector=".af-content-scroll"
          renderItem={(playlist) => {
            const visible = !hiddenBiliIdSet.has(playlist.id);
            const isNew = newBiliIdSet.has(playlist.id);
            return (
              <div className="af-bili-collection-row">
                <BiliCollectionCover src={playlist.picUrl} name={playlist.name} />
                <div className="af-bili-collection-info">
                  <div className="af-bili-collection-title-row">
                    <h3>{playlist.name}</h3>
                    {isNew && <span className="af-bili-new-badge">新发现</span>}
                  </div>
                  <p>{playlist.trackCount ?? 0} 个视频 · {playlist.author || "哔哩哔哩"}</p>
                </div>
                <label className="af-bili-row-toggle">
                  <input
                    type="checkbox"
                    checked={visible}
                    onChange={(event) => setBiliCollectionVisible(playlist.id, event.target.checked)}
                    aria-label={`${visible ? "隐藏" : "显示"} ${playlist.name}`}
                  />
                  <span className="af-bili-visibility-switch" aria-hidden="true" />
                  <span>{visible ? "显示" : "隐藏"}</span>
                </label>
              </div>
            );
          }}
        />
      )}
    </div>
  );
}

function BiliCollectionCover({ src, name }: { src?: string; name: string }) {
  const imageSrc = toCoverSrc(src);
  return (
    <div className="af-playlist-cover">
      {imageSrc ? (
        <img src={imageSrc} alt={name} referrerPolicy={getImageReferrerPolicy(imageSrc)} />
      ) : (
        <div className="af-playlist-cover-placeholder">
          <Layers size={38} />
        </div>
      )}
    </div>
  );
}
